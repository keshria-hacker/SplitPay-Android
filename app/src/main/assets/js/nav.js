/* ═══════════════════════════════════════════════════════════════════
   SplitPay — nav.js
   Screen navigation (goTo), modal open/close, confirm bottom-sheet.
   Reads S.confirmFor to dispatch onConfirm() to the right handler.
   ═══════════════════════════════════════════════════════════════════ */

/** Last active step number — used to pick slide direction. */
let _lastStep = 1;

/**
 * Activate a screen by ID suffix (1 | 2 | 3 | 4a | 4b | 5).
 * Applies slide-fwd / slide-back animations based on flow direction.
 */
function goTo(n) {
  const nStr   = String(n);
  // 'm1' / 'm2' are the Receive-mode (merchant) screens; the step bar is
  // hidden there, the numbers only drive the slide direction.
  const stepNum = { '1': 1, '2': 2, '3': 3, '4a': 4, '4b': 4, '5': 5, 'm1': 1, 'm2': 2 }[nStr] || +n;
  const fwd     = stepNum >= _lastStep;
  _lastStep     = stepNum;

  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'slide-fwd', 'slide-back');
  });

  const el = document.getElementById('sc' + n);
  if (!el) return;
  el.classList.add('active', fwd ? 'slide-fwd' : 'slide-back');

  // Scroll the new screen to top
  const w = el.querySelector('.wrap');
  if (w) w.scrollTop = 0;

  // Update step-bar indicators
  [1, 2, 3, 4].forEach(i => {
    const dot  = document.getElementById('sd' + i);
    const line = document.getElementById('sl' + i + (i + 1));
    if (!dot) return;
    dot.classList.remove('act', 'done');
    const isDone = i < stepNum || (stepNum === 5 && i === 4);
    if (isDone)       dot.classList.add('done');
    else if (i === stepNum) dot.classList.add('act');
    if (line) line.classList.toggle('done', isDone || stepNum === 5);
  });
}

// ─── MODALS ───────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).classList.add('hide');
}

/**
 * Close a modal when the user taps the dark backdrop (not the sheet).
 * Accepts the event explicitly; falls back to window.event for older
 * call-sites that pass nothing.
 */
function bgClickModal(id, ev) {
  const t = ev || window.event;
  if (t && t.target && t.target.id === id) closeModal(id);
}

/**
 * Open (or re-open) a bottom-sheet modal.
 * Forces a reflow between hiding and showing so the slide-up animation
 * replays every time rather than popping in on the second open.
 */
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hide');
  const sheet = m.querySelector('.msheet');
  if (sheet) {
    sheet.style.animation = 'none';
    void sheet.offsetWidth;
    sheet.style.animation = '';
  }
}

// ─── CONFIRM SHEET ────────────────────────────────────────────────

/**
 * Show the "Did this part succeed?" bottom sheet.
 * @param {string} forMode  'auto' | 'manual' — routes onConfirm()
 */
function showConfirmSheet(title, sub, forMode) {
  S.confirmFor = forMode;
  document.getElementById('sh-title').textContent = title;
  document.getElementById('sh-sub').textContent   = sub;
  openModal('confirm-modal');
  haptic('medium');
}

/** Called by the Paid / Failed buttons inside the confirm sheet. */
function onConfirm(ok) {
  closeModal('confirm-modal');
  if (S.confirmFor === 'manual') doManualConfirm(ok);
  else                           doAutoConfirm(ok);
}

// ─── FULL-SCREEN DIALOGS: FOCUS, ESCAPE, TAB TRAP ────────────────
//
// Dashboard and Settings are blocking dialogs (role="dialog"
// aria-modal="true"). A dialog a keyboard user cannot leave — or that
// lets Tab wander into the page behind it — isn't really modal, so both
// get the treatment About already had:
//   • focus moves inside on open and returns to the opener on close
//   • Escape closes the topmost dialog (never the "exit app?" prompt)
//   • Tab / Shift+Tab cycle within the open dialog only

/** Dialogs that behave as full-screen modal pages (focus-trapped). */
const FULL_MODALS = ['dash-modal', 'settings-modal'];

const MODAL_FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Every dialog Escape (or hardware back) should be able to dismiss. */
const ALL_DIALOGS = [
  'cam-modal', 'qr-modal', 'confirm-modal', 'dash-modal', 'settings-modal', 'about-modal',
];

let _modalPrevFocus = null;

/** True when the given dialog exists and is not hidden. */
function modalOpen(id) {
  const m = $(id);
  return !!m && !m.classList.contains('hide');
}

function anyDialogOpen() {
  return ALL_DIALOGS.some(modalOpen);
}

/**
 * Open a full-screen dialog, remembering what had focus beforehand.
 * @param {string} id
 */
function openFullModal(id) {
  const m = $(id);
  if (!m) return;
  _modalPrevFocus = document.activeElement;
  m.classList.remove('hide');
  document.body.style.overflow = 'hidden';
  // Focus after paint, once the dialog is laid out and queryable.
  requestAnimationFrame(() => {
    const first = m.querySelector(MODAL_FOCUSABLE);
    if (first && document.activeElement !== first) first.focus();
  });
}

/**
 * Close a full-screen dialog.
 * @param {string}  id
 * @param {boolean} [restoreFocus=true]  Hand focus back to the opener.
 *        Skipped by callers that immediately navigate elsewhere (e.g.
 *        Dashboard → Repeat), where the old opener is the wrong target.
 */
function closeFullModal(id, restoreFocus = true) {
  const m = $(id);
  if (!m) return;
  const hadFocus = m.contains(document.activeElement);
  m.classList.add('hide');
  document.body.style.overflow = '';
  const prev = _modalPrevFocus;
  _modalPrevFocus = null;
  if (!restoreFocus || !prev || typeof prev.focus !== 'function') return;
  // Only pull focus back if the dialog actually held it (or focus was lost
  // to <body> when its content was hidden) — never steal it from something
  // the user has since focused.
  if (!hadFocus && document.activeElement && document.activeElement !== document.body) return;
  try { prev.focus(); } catch (_) { /* element may be gone */ }
}

/**
 * Escape mirrors hardware back exactly — it closes the topmost dialog and
 * stops there. With no dialog open it is ignored, so it can never raise
 * the native "exit SplitPay?" prompt the way back-at-the-start does.
 */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!anyDialogOpen()) return;
    e.preventDefault();
    if (typeof onAppBack === 'function') onAppBack();
    return;
  }

  if (e.key !== 'Tab') return;
  const openId = FULL_MODALS.slice().reverse().find(modalOpen);
  if (!openId) return;
  const m = $(openId);
  // offsetParent filters out the hidden panel of the inactive tab.
  const items = Array.from(m.querySelectorAll(MODAL_FOCUSABLE))
    .filter(el => el.offsetParent !== null);
  if (items.length < 2) return;
  const first = items[0];
  const last  = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, { passive: false });
