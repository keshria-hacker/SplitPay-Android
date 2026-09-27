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

function toast(msg, err = false) {
  haptic(err ? 'error' : 'light');
  const el   = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const icn   = el.querySelector('.icn use');
  clearTimeout(_toastTimer);
  msgEl.textContent = msg;
  icn.setAttribute('href', err ? '#ic-x' : '#ic-check');
  el.style.background   = err ? 'var(--surf2)' : 'var(--ink)';
  el.style.color        = err ? 'var(--ink)'   : 'var(--bg)';
  el.style.borderColor  = err ? 'var(--err)'   : 'var(--bdr)';
  el.classList.add('show');
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
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
