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
