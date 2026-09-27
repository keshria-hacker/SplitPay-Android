/* ═══════════════════════════════════════════════════════════════════
   SplitPay — validator.js
   Result<T> type + centralised validation rules.

   Pattern: every validator returns Ok(value) or Err(message, code).
   Callers pattern-match on .ok to branch without throwing:

     const r = Validator.upi(raw);
     if (!r.ok) { shakeEl('iupi'); toast(r.msg, true); return; }
     S.upi = r.value;

   Keeping all rules here means:
     - a single place to update limits (MAX_PART, AMT_MAX, UPI regex)
     - tests can import and call without a DOM
     - error messages are consistent across auto and manual modes
   ═══════════════════════════════════════════════════════════════════ */

// ─── RESULT TYPE ──────────────────────────────────────────────────
/** @returns {Ok<T>} */
function Ok(value) {
  return Object.freeze({ ok: true, value });
}

/**
 * @param {string} msg   Human-readable message (shown in toast / UI)
 * @param {string} code  Machine-readable code  (used by tests)
 * @returns {Err}
 */
function Err(msg, code = 'INVALID') {
  return Object.freeze({ ok: false, msg, code });
}

// ─── VALIDATORS ───────────────────────────────────────────────────
const Validator = Object.freeze({

  /**
   * UPI Virtual Payment Address.
   * Standard format: localpart@provider
   * Caps at 100 chars to block absurdly long crafted payloads from QR codes.
   */
  upi(raw) {
    const v = String(raw || '').trim();
    if (!v)          return Err('Enter or scan a UPI ID', 'EMPTY');
    if (v.length > 100) return Err('UPI ID is too long', 'TOO_LONG');
    if (!/^[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+$/.test(v))
      return Err('Invalid UPI format — should look like name@bank', 'FORMAT');
    return Ok(v);
  },

  /**
   * Rupee amount — integers only (no paise).
   * Fractional amounts cause floating-point split rounding errors,
   * so we floor before validation.
   */
  amount(raw) {
    const v = Math.floor(parseFloat(raw) || 0);
    if (!v || v <= 0)    return Err('Enter a valid amount', 'EMPTY');
    if (v > AMT_MAX)     return Err(`Max amount is ₹${AMT_MAX.toLocaleString('en-IN')}`, 'TOO_LARGE');
    return Ok(v);
  },

  /**
   * Payee display name — optional, cosmetic only.
   * Strips whitespace; returns empty string if blank (not an error).
   */
  name(raw) {
    const v = String(raw || '').trim().slice(0, 80);
    return Ok(v);
  },

  /**
   * Full split plan readiness check.
   * Returns Ok if the plan is safe to execute; Err with the first
   * violation found.
   *
   * @param {number[]} parts  Array of integer rupee amounts
   * @param {number}   total  Expected sum
   * @param {string}   mode   'equal' | 'random'
   */
  splitPlan(parts, total, mode) {
    if (!parts || !parts.length)
      return Err('No parts defined', 'EMPTY');

    const tooSmall = parts.findIndex(p => p < 1);
    if (tooSmall >= 0)
      return Err(`Part ${tooSmall + 1} is below ₹1 minimum`, 'PART_TOO_SMALL');

    const tooLarge = parts.findIndex(p => p > MAX_PART);
    if (tooLarge >= 0)
      return Err(`Part ${tooLarge + 1} exceeds ₹${MAX_PART} limit`, 'PART_TOO_LARGE');

    const sum = parts.reduce((a, v) => a + v, 0);
    if (sum !== total)
      return Err(
        `Parts sum to ₹${sum.toLocaleString('en-IN')}, need ₹${total.toLocaleString('en-IN')}`,
        'SUM_MISMATCH'
      );

    if (mode === 'random') {
      const hasDupes = new Set(parts).size !== parts.length;
      if (hasDupes)
        return Err('Random mode: every part must have a unique amount', 'DUPLICATE_PARTS');
    }

    return Ok(parts);
  },

  /**
   * Part count for the plan screen ± buttons.
   * Validates within the feasible band for the chosen mode.
   *
   * @param {number} n      Proposed count
   * @param {number} total  Payment total (rupees)
   * @param {string} mode   'equal' | 'random'
   * @returns {Ok<number>}  Clamped valid count, always succeeds with
   *                        a clamped value and an error to show the user
   */
  partCount(n, total, mode) {
    const min = getMin(total);
    let   max = getMaxParts(total);

    if (mode === 'random') {
      const [, b] = distinctBounds(total);
      max = Math.max(min, b);
    }

    const clamped = Math.max(min, Math.min(max, Math.floor(Number(n) || min)));
    if (clamped !== n) {
      const msg = clamped === min
        ? `Minimum ${min} part${min > 1 ? 's' : ''} required`
        : `Maximum ${max} parts for ₹${total.toLocaleString('en-IN')}`;
      return { ok: true, value: clamped, warning: msg }; // soft clamp — still Ok
    }
    return Ok(clamped);
  },

  /**
   * UPI link (upi:// or UPI deeplink from a QR code).
   * Checks it is at minimum parseable before handing to handleScan.
   */
  upiLink(raw) {
    if (!raw || !raw.trim())   return Err('Empty QR content', 'EMPTY');
    const t = raw.trim();
    // Either a raw UPI ID or a upi:// link (also covers https://upi links)
    if (/^[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+$/.test(t)) return Ok(t);
    if (t.startsWith('upi://') || t.includes('pa='))   return Ok(t);
    return Err('QR code does not contain a UPI ID', 'NOT_UPI');
  },
});
