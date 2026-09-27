/* ═══════════════════════════════════════════════════════════════════
   SplitPay — upiqr.js   (load after validator.js, before storage.js)
   Build + parse UPI QR payloads, including the multi-account
   "SplitPay merchant QR".

   ── The multi-account QR format ─────────────────────────────────────
   A SplitPay merchant QR is an ordinary UPI deep link with ONE extra
   query parameter:

     upi://pay?pa=<primary>&pn=<name>&cu=INR&spx=<acct2>~<acct3>~…

     pa   the merchant's FIRST (primary) UPI ID. Because this is a
          perfectly normal UPI link, any other UPI app that scans the
          code still works — it simply pays the primary account.
     spx  the remaining UPI IDs, separated by "~" (an RFC 3986
          unreserved character, so it needs no escaping and can never
          appear inside a UPI ID). Each ID is percent-encoded, which
          only matters for "+" (→ %2B): UPI IDs may contain "+", and
          form-style decoding would otherwise turn it into a space.

   SplitPay reads pa + spx → the full account list (max 12), then
   spreads the split parts across those accounts.

   No DOM access in this file, so it can be unit-tested in Node.
   ═══════════════════════════════════════════════════════════════════ */

const UpiQr = (() => {

  const EXTRA_PARAM = 'spx';
  const SEP         = '~';
  const MAX_ENCODED_NAME = 120;  // ≈13 Devanagari letters; stops non-Latin names bloating the QR

  // ─── helpers ──────────────────────────────────────────────────────

  function _validVpa(v) {
    return typeof v === 'string' && Validator.upi(v).ok;
  }

  /**
   * Trim, validate, de-duplicate (case-insensitive — UPI IDs are not
   * case-sensitive) and cap a list of UPI IDs. First occurrence wins,
   * so order — and therefore "which account is primary" — is preserved.
   */
  function cleanList(list, max = MAX_MERCHANT_UPIS) {
    const seen = new Set();
    const out  = [];
    for (const item of Array.isArray(list) ? list : []) {
      const v = String(item == null ? '' : item).trim();
      const k = v.toLowerCase();
      if (!_validVpa(v) || seen.has(k)) continue;
      seen.add(k);
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Percent-encode a UPI ID, but leave "@" readable (saves QR density). */
  function _encVpa(v) {
    return encodeURIComponent(v).replace(/%40/g, '@');
  }

  /**
   * Clean a merchant/business name for the `pn` field: collapse
   * whitespace, cap at 50 code points (NPCI limit), and trim until the
   * percent-encoded form is short enough. Lone surrogates (which make
   * encodeURIComponent throw) are dropped.
   */
  function fitName(raw) {
    let cps = Array.from(String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim());
    cps = cps.filter(ch => { try { encodeURIComponent(ch); return true; } catch { return false; } });
    cps = cps.slice(0, 50);
    while (cps.length && encodeURIComponent(cps.join('')).length > MAX_ENCODED_NAME) cps.pop();
    return cps.join('').trim();
  }

  /** Split a query string into {key: rawValue} — first occurrence wins, keys lower-cased. */
  function _queryMap(qs) {
    const map = Object.create(null);
    for (const pair of String(qs).split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = (i < 0 ? pair : pair.slice(0, i)).toLowerCase();
      if (k in map) continue;
      map[k] = i < 0 ? '' : pair.slice(i + 1);
    }
    return map;
  }

  /** decodeURIComponent that returns '' instead of throwing on bad %-sequences. */
  function _dec(raw, plusIsSpace) {
    try { return decodeURIComponent(plusIsSpace ? String(raw).replace(/\+/g, ' ') : String(raw)); }
    catch { return ''; }
  }

  // ─── build ────────────────────────────────────────────────────────

  /**
   * Build the merchant QR payload.
   * @param {{name?:string, accounts:string[]}} m
   * @returns {string|null}  null when there is no valid account
   */
  function build(m) {
    const list = cleanList(m && m.accounts);
    if (!list.length) return null;

    const q = ['pa=' + _encVpa(list[0])];
    const pn = fitName(m && m.name);
    if (pn) q.push('pn=' + encodeURIComponent(pn));
    q.push('cu=INR');
    if (list.length > 1) q.push(EXTRA_PARAM + '=' + list.slice(1).map(_encVpa).join(SEP));
    return 'upi://pay?' + q.join('&');
  }

  // ─── parse ────────────────────────────────────────────────────────

  /**
   * Parse anything a UPI QR / clipboard can contain:
   *   • a SplitPay merchant QR         → accounts.length may be > 1
   *   • a standard upi://pay?… link    → accounts.length === 1
   *   • a bare VPA ("name@bank")       → accounts.length === 1
   *   • free text containing a VPA     → first VPA found
   *
   * @returns {{accounts:string[], pa:string, pn:string, am:string, multi:boolean}|null}
   */
  function parse(data) {
    const t = String(data == null ? '' : data).trim();
    if (!t) return null;

    // 1 — URL-style payload
    if (/^upi:\/\//i.test(t) || /(^|[?&])pa=/i.test(t)) {
      const qi   = t.indexOf('?');
      const qs   = (qi >= 0 ? t.slice(qi + 1) : t).split('#')[0];
      const q    = _queryMap(qs);
      const pa   = q.pa != null ? _dec(q.pa, false).trim() : '';
      const extra = q[EXTRA_PARAM] != null
        ? _dec(q[EXTRA_PARAM], false).split(SEP) : [];
      const accounts = cleanList([pa, ...extra]);
      if (accounts.length) {
        return {
          accounts,
          pa: accounts[0],
          pn: q.pn != null ? _dec(q.pn, true).trim().slice(0, 50) : '',
          am: q.am != null ? _dec(q.am, true).trim() : '',
          multi: accounts.length > 1,
        };
      }
    }

    // 2 — bare VPA
    if (_validVpa(t)) return { accounts: [t], pa: t, pn: '', am: '', multi: false };

    // 3 — a VPA buried in free text
    const m = t.match(/[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+/);
    if (m && _validVpa(m[0])) return { accounts: [m[0]], pa: m[0], pn: '', am: '', multi: false };

    return null;
  }

  return Object.freeze({ build, parse, cleanList, fitName, EXTRA_PARAM, SEP });
})();
