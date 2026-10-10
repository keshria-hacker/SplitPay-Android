/* ═══════════════════════════════════════════════════════════════════
   SplitPay — utils.js
   Pure helpers: haptics, toast, shake, escape, UPI validation,
   reference generation, and theme toggle.
   No DOM dependencies beyond the toast element.
   ═══════════════════════════════════════════════════════════════════ */

// ─── HAPTICS ──────────────────────────────────────────────────────
const HAPTIC_PATTERNS = { light: 15, medium: 30, heavy: [40, 30, 40], error: [50, 50, 50] };

function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  navigator.vibrate(HAPTIC_PATTERNS[type] || 15);
}

// ─── TOAST ────────────────────────────────────────────────────────
let _toastTimer;
let _toastSweep;
let _toastAction = null;

/**
 * Show a transient message.
 *
 * The optional third argument adds an action button — the Dashboard's
 * "Undo" after a delete is the only user so far. An actionable toast
 * stays on screen noticeably longer, because the user has to read it
 * *and* decide, and because a 3-second undo is not a real undo.
 *
 * @param {string} msg
 * @param {boolean} [err=false]
 * @param {{label?: string, fn: Function}} [action]
 */
function toast(msg, err = false, action = null) {
  haptic(err ? 'error' : 'light');
  const el = document.getElementById('toast');
  if (!el) return;                       // never let a missing toast break a flow
  const msgEl = document.getElementById('toast-msg');
  const icn   = el.querySelector('.icn use');
  clearTimeout(_toastTimer);
  clearTimeout(_toastSweep);

  _toastAction = action && typeof action.fn === 'function' ? action : null;
  const actEl = document.getElementById('toast-act');
  if (actEl) {
    actEl.textContent   = _toastAction ? (_toastAction.label || 'Undo') : '';
    actEl.style.display = _toastAction ? '' : 'none';
  }
  el.classList.toggle('has-act', !!_toastAction);

  msgEl.textContent = msg;
  if (icn) icn.setAttribute('href', err ? '#ic-x' : '#ic-check');
  el.style.background   = err ? 'var(--surf2)' : 'var(--ink)';
  el.style.color        = err ? 'var(--ink)'   : 'var(--bg)';
  el.style.borderColor  = err ? 'var(--err)'   : 'var(--bdr)';
  el.classList.add('show');
  _toastTimer = setTimeout(_toastHide, _toastAction ? 6000 : 3200);
}

/** Slide the toast out, then drop any action it was still offering. */
function _toastHide() {
  const el = document.getElementById('toast');
  if (el) el.classList.remove('show');
  clearTimeout(_toastTimer);
  clearTimeout(_toastSweep);
  _toastSweep = setTimeout(() => {
    _toastAction = null;
    const actEl = document.getElementById('toast-act');
    if (actEl) { actEl.textContent = ''; actEl.style.display = 'none'; }
    const t = document.getElementById('toast');
    if (t) t.classList.remove('has-act');
  }, 300);
}

/** Run the toast's action (wired to the toast button in index.html). */
function toastAction() {
  const fn = _toastAction && _toastAction.fn;
  _toastAction = null;
  _toastHide();
  if (fn) { try { fn(); } catch (e) { console.error('[toast] action failed:', e); } }
}

// ─── DEBOUNCE ─────────────────────────────────────────────────────
/**
 * Trailing-edge debounce. Returns a wrapper that only runs `fn` once
 * `ms` have passed without another call. Used to keep expensive DOM
 * work (e.g. re-rendering the MDR hint) off every keystroke.
 */
function debounce(fn, ms = 120) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ─── SHAKE ────────────────────────────────────────────────────────
function shakeEl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;          // force reflow to restart animation
  el.classList.add('shake');
  haptic('error');
}

// ─── SECURITY ─────────────────────────────────────────────────────
/**
 * HTML-escape user-controlled strings before they touch innerHTML.
 * Blocks script injection via malicious QR codes or clipboard data.
 */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

// ─── UPI VALIDATION ───────────────────────────────────────────────
/** Standard UPI VPA format: localpart@provider */
function validateUPI(v) {
  return /^[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+$/.test(v.trim());
}

// ─── REFERENCE IDs ────────────────────────────────────────────────
/** Generates a short ledger reference like LGR4F2AP1 for audit trails. */
function makeRef(part) {
  return 'LGR' + Date.now().toString(36).slice(-4).toUpperCase() + 'P' + part;
}

// ─── THEME ────────────────────────────────────────────────────────
function toggleTheme() {
  haptic('light');
  const root    = document.documentElement;
  const current = root.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  // Persist the choice — without this the picked theme only lasted for
  // the current session and reverted on next launch/reload, since boot()
  // in index.html restores from Storage.theme, which this never wrote to.
  try { Storage.theme = next; } catch (_) {}
}
