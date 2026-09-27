/* ═══════════════════════════════════════════════════════════════════
   SplitPay — state.js
   Single source of truth: all mutable state + app-wide constants.
   Other modules READ from S and call resetState() to wipe it.
   ═══════════════════════════════════════════════════════════════════ */

/** Maximum allowed amount per single UPI part (MDR threshold). */
const MAX_PART = 1999;

/** Hard cap per transaction (product decision; keeps sequences short). */
const AMT_MAX = 10000;

/** Max UPI IDs a merchant can bundle into one SplitPay QR. */
const MAX_MERCHANT_UPIS = 12;

/**
 * Global application state (S).
 * Mutated in-place across modules; never replaced by reference.
 */
const S = {
  // ── Payment target ─────────────────────────────────────────────
  total:     0,       // integer rupees
  upi:       '',      // validated UPI ID (primary account when payees > 1)
  name:      '',      // payee display name
  note:      '',      // optional payment note
  payees:    [],      // every receiving UPI ID (length > 1 = multi-account merchant QR)

  // ── Split plan ─────────────────────────────────────────────────
  splits:      [],    // integer rupee amounts (Σ === total)
  splitMode:   'equal',
  customParts: null,  // user-chosen part count (null = use minimum)
  refs:        [],    // reference IDs per part
  assign:      [],    // payee index per part (multi-account merchants)
  assignManual: false, // true once the user hand-picks an account for a part

  // ── Execution ─────────────────────────────────────────────────
  mode:      'auto',
  turbo:     true,
  cur:       0,       // index of current part being processed
  running:   false,
  awaiting:  false,   // waiting for user to return from UPI app

  // ── Confirmation ──────────────────────────────────────────────
  confirmFor:   'auto',     // 'auto' | 'manual'
  cdTimer:      null,       // countdown interval handle
  mPendingIdx:  -1,         // pending manual confirmation index

  // ── Outcome ───────────────────────────────────────────────────
  paid:   [],   // boolean per part
  failed: [],   // boolean per part
};

/** Minimum number of parts to keep every part ≤ MAX_PART. */
function getMin(total) {
  return Math.max(1, Math.ceil(total / MAX_PART));
}

/** Maximum number of parts (floor of total, capped at 200). */
function getMaxParts(total) {
  return Math.max(1, Math.min(200, Math.floor(total)));
}

/**
 * Wipe state back to defaults without replacing the S reference
 * (other modules hold a direct reference to the object).
 */
function resetState() {
  Object.assign(S, {
    total: 0, upi: '', name: '', note: '', payees: [],
    splits: [], splitMode: 'equal', customParts: null, refs: [],
    assign: [], assignManual: false,
    mode: 'auto', turbo: true, cur: 0, running: false, awaiting: false,
    confirmFor: 'auto', cdTimer: null, mPendingIdx: -1,
    paid: [], failed: [],
  });
}
