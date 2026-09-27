/* ═══════════════════════════════════════════════════════════════════
   SplitPay — split.js
   Pure split-math + plan-screen UI.

   Key fixes vs original:
     • distinctBounds()  — O(1) closed-form instead of O(n) loop
     • randomSplit()     — Math.floor (uniform) replaces Math.round (biased)
                           last slot receives exact remainder (no float drift)
                           Fisher-Yates shuffle produces truly random ORDER
     • renderPreview()   — uses requestAnimationFrame for smooth DOM paint
   ═══════════════════════════════════════════════════════════════════ */

// ─── BOUNDS HELPERS ───────────────────────────────────────────────

/**
 * Minimum number of parts so Σ ≤ MAX_PART:
 *   = ceil(total / MAX_PART)  — already in state.js as getMin()
 *
 * For DISTINCT mode, the feasible part-count band [nMin, nMax]:
 *   nMax: n(n+1)/2 ≤ total  →  n = floor((-1+√(1+8·total))/2)
 *   nMin: n(3999-n)/2 ≥ total  →  solve n² - 3999n + 2·total ≤ 0
 *         smaller root = (3999 - √(3999²-8·total)) / 2  then ceil
 *
 * @returns {[number, number]} [lo, hi] inclusive
 */
function distinctBounds(total) {
  // nMax: minimum sum of n distinct parts = n(n+1)/2 must be ≤ total
  const nMax = Math.min(200, Math.floor((-1 + Math.sqrt(1 + 8 * total)) / 2));

  // nMin: maximum sum of n distinct parts in [1,MAX_PART] must be ≥ total
  //       max sum = (MAX_PART-n+1)+…+MAX_PART = n(3999-n)/2
  //       quadratic: n²-3999n+2·total ≤ 0 → smaller root gives nMin
  const disc = 3999 * 3999 - 8 * total;
  let nMin;
  if (disc < 0) {
    // total is so large no feasible split exists — caller should catch via nMax<nMin
    nMin = 200;
  } else {
    // Subtract tiny epsilon before ceiling to handle float-point near-integers
    nMin = Math.max(1, Math.ceil((3999 - Math.sqrt(disc)) / 2 - 1e-9));
  }

  const lo = Math.min(nMin, nMax);
  const hi = Math.max(nMin, nMax);
  return [lo, hi];
}

function clampPartCount(total, n) {
  const min = getMin(total);
  const max = getMaxParts(total);
  n = Math.floor(Number(n) || min);
  return Math.max(min, Math.min(max, n));
}

function clampPartsForMode(total, n, mode) {
  if (mode === 'random') {
    const [a, b] = distinctBounds(total);
    return Math.max(a, Math.min(b, Math.floor(Number(n) || a)));
  }
  return clampPartCount(total, n);
}

// ─── EQUAL SPLIT ──────────────────────────────────────────────────

/**
 * Distribute `rem` into k integer parts.
 * Leftover ₹1s spread over the first parts so no cent is lost.
 * e.g. 100/3 → [34, 33, 33]  not [33, 33, 34]
 */
function evenParts(rem, k) {
  const base = Math.floor(rem / k);
  let   left = rem - base * k;
  return Array.from({ length: k }, () => {
    const v = base + (left > 0 ? 1 : 0);
    if (left > 0) left--;
    return v;
  });
}

function equalSplit(total, n) {
  n = clampPartCount(total, n);
  if (n <= 1) return [total];
  return evenParts(total, n);
}

// ─── RANDOM SPLIT (FIXED) ─────────────────────────────────────────
/**
 * Produce n DISTINCT integer amounts in [1, MAX_PART] summing to total.
 *
 * Construction (O(n), always valid, no retries):
 *   part_i = i + 1 + x_i   where x is a NON-DECREASING composition of
 *   E = total − n(n+1)/2   with every x_i ≤ C = MAX_PART − n.
 *   Non-decreasing x ⟹ strictly increasing parts ⟹ all UNIQUE.
 *   x_n ≤ MAX_PART−n  ⟹ part_n ≤ MAX_PART;  part_1 ≥ 1.
 *   Σparts = total exactly (last slot takes the exact remainder).
 *
 * Fixes vs original:
 *   • Math.floor + uniform range replaces biased Math.round
 *   • xs[n-1] = rem guarantees Σxs === E (no floating-point drift)
 *   • Safety guard when lo > hi (should never fire but is defensive)
 *   • Fisher-Yates shuffle gives RANDOM ORDER (not always ascending)
 */
function randomSplit(total, n) {
  const [loN, hiN] = distinctBounds(total);
  n = Math.max(loN, Math.min(hiN, Math.floor(Number(n) || loN)));
  if (n <= 1) return [total];

  const E  = total - n * (n + 1) / 2;   // total excess above minimum sequence
  const C  = MAX_PART - n;               // max excess per slot
  const xs = new Array(n).fill(0);
  let   rem = E;

  // Fill first n-1 slots uniformly in their feasible range
  for (let i = 0; i < n - 1; i++) {
    const left = n - i;
    const lo = Math.max(0, rem - (left - 1) * C);  // must leave enough
    const hi = Math.min(C, rem);                     // can't exceed cap or rem
    if (lo > hi) { xs[i] = lo; rem -= lo; continue; } // safety (unfeasible corner)
    // Uniform integer in [lo, hi] — Math.floor gives unbiased distribution
    xs[i] = lo + Math.floor(Math.random() * (hi - lo + 1));
    rem  -= xs[i];
  }
  // Last slot takes exact remainder → Σxs === E is guaranteed
  xs[n - 1] = rem;

  xs.sort((a, b) => a - b); // non-decreasing → parts become strictly increasing
  const parts = xs.map((x, i) => i + 1 + x);

  // Fisher-Yates shuffle: randomise ORDER while preserving uniqueness
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts;
}

// ─── MULTI-ACCOUNT ASSIGNMENT ─────────────────────────────────────
//
// When the payee is a SplitPay merchant QR (S.payees.length > 1) every
// part is paid to ONE of the merchant's accounts. Default assignment is
// "balanced by amount": biggest parts first, each going to whichever
// account has received the least so far (ties → earliest account).
//   • equal parts  → plain round-robin  (A B C A B …)
//   • random parts → totals stay close across accounts
// The user can override any part; overrides survive amount edits but
// are discarded whenever the number of parts changes.

function payeeCount() { return Math.max(1, S.payees.length); }

/** Pure: part index → account index, balanced by amount. */
function defaultAssign(splits, n) {
  const totals = new Array(n).fill(0);
  const out    = new Array(splits.length).fill(0);
  const order  = splits.map((a, i) => [a, i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [amt, i] of order) {
    let best = 0;
    for (let k = 1; k < n; k++) if (totals[k] < totals[best]) best = k;
    out[i] = best;
    totals[best] += amt;
  }
  return out;
}

/** Make S.assign valid for the current S.splits / S.payees. */
function syncAssign() {
  const n   = payeeCount();
  const bad = S.assign.length !== S.splits.length ||
              S.assign.some(v => !(Number.isInteger(v) && v >= 0 && v < n));
  if (bad) S.assignManual = false;
  if (bad || !S.assignManual) S.assign = defaultAssign(S.splits, n);
}

/** UPI ID that part `i` (0-based) is paid to. */
function payeeFor(i) {
  if (S.payees.length > 1) {
    const v = S.payees[S.assign[i]];
    if (v) return v;
  }
  return S.upi;
}

/** Per-account totals for the current plan: [{upi, amount, parts}] */
function accountTotals() {
  const rows = S.payees.map(upi => ({ upi, amount: 0, parts: 0 }));
  S.splits.forEach((a, i) => {
    const r = rows[S.assign[i]];
    if (r) { r.amount += a; r.parts++; }
  });
  return rows;
}

/** <select> onchange — user hand-picks the account for one part. */
function setPartPayee(i, v) {
  const k = parseInt(v, 10);
  if (!(k >= 0 && k < payeeCount())) return;
  haptic('light');
  S.assign[i]    = k;
  S.assignManual = true;
  renderPreview();
}

/** "One part per account" shortcut. */
function spreadParts() {
  haptic('medium');
  const want = clampPartsForMode(S.total, S.payees.length, S.splitMode);
  S.customParts = want;
  S.splits = S.splitMode === 'random' ? randomSplit(S.total, want) : equalSplit(S.total, want);
  S.refs   = S.splits.map((_, i) => makeRef(i + 1));
  setText('sc-val', String(want));
  renderPreview();
  toast(want >= S.payees.length
    ? 'Spread across ' + S.payees.length + ' accounts'
    : 'Only ' + want + ' parts possible for ₹' + S.total.toLocaleString('en-IN'), want < S.payees.length);
}

// ─── PLAN SCREEN UI ───────────────────────────────────────────────

/** ± button on the part counter. */
function adjParts(d) {
  haptic('light');
  const min = getMin(S.total);
  let   max = getMaxParts(S.total);
  if (S.splitMode === 'random') {
    const [, b] = distinctBounds(S.total);
    max = Math.max(min, b);
  }
  let cur = (S.customParts || min) + d;
  if (cur < min) { toast(`Minimum ${min} parts required`, true); cur = min; }
  if (cur > max) { toast(`Maximum ${max} parts for ₹${S.total.toLocaleString('en-IN')}`, true); cur = max; }
  S.customParts = cur;
  document.getElementById('sc-val').textContent = cur;
  S.splits = S.splitMode === 'random'
    ? randomSplit(S.total, cur)
    : equalSplit(S.total, cur);
  S.refs = S.splits.map((_, i) => makeRef(i + 1));
  renderPreview();
}

/** Equal / Random toggle. */
function setSplitMode(m) {
  haptic('light');
  S.splitMode   = m;
  S.customParts = clampPartsForMode(S.total, S.customParts || getMin(S.total), m);
  document.getElementById('sc-val').textContent = S.customParts;
  document.getElementById('st-eq').classList.toggle('on', m === 'equal');
  document.getElementById('st-rnd').classList.toggle('on', m === 'random');
  document.getElementById('reshuffle-btn').style.display = m === 'random' ? '' : 'none';
  S.splits = m === 'equal'
    ? equalSplit(S.total, S.customParts)
    : randomSplit(S.total, S.customParts);
  renderPreview();
}

/** Re-roll the random plan without changing part count. */
function reshuffle() {
  haptic('medium');
  S.customParts = clampPartsForMode(S.total, S.customParts || getMin(S.total), 'random');
  S.splits      = randomSplit(S.total, S.customParts);
  document.getElementById('sc-val').textContent = S.customParts;
  renderPreview();
  toast('Amounts reshuffled');
}

/**
 * Render the split preview list.
 * Uses requestAnimationFrame to batch DOM writes for smooth paint.
 */
function renderPreview() {
  syncAssign();          // synchronous: runner reads S.assign straight after
  // Multi-account chrome is toggled synchronously (not inside the rAF below) so a
  // previous merchant's account card / pickers never flash on a new plan screen.
  const box0 = document.getElementById('split-preview');
  if (box0) box0.classList.toggle('multi', S.payees.length > 1);
  renderAcctSummary();
  requestAnimationFrame(() => {
    const max   = Math.max(...S.splits);
    const multi = S.payees.length > 1;
    const html  = S.splits.map((a, i) => `
      <div class="spi">
        <div class="spi-n">${i + 1}</div>
        <div class="spi-amt">
          <input type="tel" inputmode="numeric" value="${a}"
                 onchange="editPart(${i},this.value)"
                 style="border-color:${(a > MAX_PART || a < 1) ? 'var(--err)' : 'var(--bdr)'}">
        </div>
        <div class="spi-bar-wrap">
          <div class="spi-bar" style="width:${(a / max * 100).toFixed(1)}%"></div>
        </div>
        ${multi ? `
        <label class="spi-acct">
          <span class="spi-to" aria-hidden="true">→</span>
          <select onchange="setPartPayee(${i},this.value)" aria-label="Account for part ${i + 1}">
            ${S.payees.map((u, k) =>
              `<option value="${k}"${S.assign[i] === k ? ' selected' : ''}>${k + 1}. ${esc(u)}</option>`
            ).join('')}
          </select>
        </label>` : ''}
      </div>`).join('');
    const box = document.getElementById('split-preview');
    box.innerHTML = html;
    box.classList.toggle('multi', multi);

    const sum = S.splits.reduce((a, v) => a + v, 0);
    const dup = S.splitMode === 'random' && new Set(S.splits).size !== S.splits.length;
    const ok  = sum === S.total && S.splits.every(p => p >= 1 && p <= MAX_PART) && !dup;
    const el  = document.getElementById('sum-check');
    el.className = 'sum-check ' + (ok ? 'ok' : 'err');
    if (ok) {
      el.innerHTML = `<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg>
        ₹${S.total.toLocaleString('en-IN')} via ${S.splits.length} parts`;
    } else if (dup) {
      el.innerHTML = `<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg>
        Duplicate amounts — every part must be unique`;
    } else {
      el.innerHTML = `<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg>
        Sum mismatch: ₹${sum.toLocaleString('en-IN')} (need ₹${S.total.toLocaleString('en-IN')})`;
    }
  });
}

/** "Receiving accounts" card on the plan screen (multi-account merchants only). */
function renderAcctSummary() {
  const multi = S.payees.length > 1;
  toggleVis('acct-card', multi);
  if (!multi) return;
  const rows = accountTotals();
  const top  = Math.max(1, ...rows.map(r => r.amount));
  setText('acct-tag', String(rows.length));
  setHtml('acct-sum', rows.map((r, k) => `
    <div class="asum${r.parts ? '' : ' idle'}">
      <div class="asum-n">${k + 1}</div>
      <div class="asum-body">
        <div class="asum-upi">${esc(r.upi)}</div>
        <div class="asum-bar"><div style="width:${(r.amount / top * 100).toFixed(1)}%"></div></div>
      </div>
      <div class="asum-amt">
        ₹${r.amount.toLocaleString('en-IN')}
        <span>${r.parts ? r.parts + (r.parts > 1 ? ' parts' : ' part') : 'unused'}</span>
      </div>
    </div>`).join(''));
}

/**
 * Inline edit of a single part.
 * Auto-adjusts the LAST part so the total always reconciles;
 * the sum-check indicator flags any remaining imbalance.
 */
function editPart(idx, raw) {
  const v = Math.max(1, parseInt(raw) || 0);
  S.splits[idx] = v;
  if (idx !== S.splits.length - 1) {
    const others = S.splits.reduce((a, x, i) =>
      i === S.splits.length - 1 ? a : a + x, 0);
    S.splits[S.splits.length - 1] = S.total - others;
    const inputs = document.getElementById('split-preview').querySelectorAll('input');
    const lastInput = inputs[S.splits.length - 1];
    if (lastInput) lastInput.value = S.splits[S.splits.length - 1];
  }
  renderPreview();
}
