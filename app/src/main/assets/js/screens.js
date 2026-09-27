/* ═══════════════════════════════════════════════════════════════════
   SplitPay — screens.js  (v2)
   Step 1 (Payee), Step 2 (Amount), Step 3 (Plan launch).

   v2 changes:
     • All validation goes through Validator (Result type)
     • UPI history autocomplete dropdown from Storage
     • FSM.go() replaces direct goTo() calls
     • EventBus emits canonical events (EV.*) instead of calling
       runner.js / camera.js directly
     • Storage saves last amount and UPI on every successful step
   ═══════════════════════════════════════════════════════════════════ */

// ─── STEP 1: PAYEE / UPI ──────────────────────────────────────────

function upiTab(t) {
  haptic('light');
  ['scan', 'type'].forEach(x => {
    toggleClass('t-' + x, 'on', x === t);
    toggleClass('tp-' + x, 'on', x === t);
  });
  if (t === 'type') _renderUpiHistory();
  renderPayeeNote();
}

// ─── MULTI-ACCOUNT MERCHANT NOTE ──────────────────────────────────

/**
 * Keep S.payees honest and show / hide the "split-ready merchant" note.
 *
 * S.payees (length > 1) only makes sense while the UPI field still holds
 * that merchant's primary ID. If the user pastes, types, or picks a
 * different ID, the scanned list is stale → drop it, so we never split
 * a payment across accounts the user is no longer looking at.
 */
function renderPayeeNote() {
  const cur = getValue('iupi').trim().toLowerCase();
  if (S.payees.length > 1 && S.payees[0].toLowerCase() !== cur) S.payees = [];

  const multi = S.payees.length > 1;
  toggleVis('multi-note', multi, 'block');
  if (!multi) return;
  setText('mn-count', S.payees.length + ' accounts');
  setHtml('mn-list', S.payees.map((v, i) =>
    `<span class="mn-chip${i === 0 ? ' pri' : ''}">${esc(v)}</span>`).join(''));
}

document.addEventListener('input', e => {
  if (e.target && e.target.id === 'iupi') renderPayeeNote();
}, { passive: true });

async function pasteUPI() {
  haptic('light');
  let text = '';
  try {
    if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
    else text = prompt('Paste UPI ID or link:') || '';
  } catch { text = prompt('Paste UPI ID:') || ''; }
  if (!text?.trim()) return;
  text = text.trim();
  if (text.includes('pa=') || text.startsWith('upi://')) handleScan(text);
  else { setValue('iupi', text); upiTab('type'); }
}

function toStep2() {
  const upiRaw  = getValue('iupi');
  const nameRaw = getValue('iname');

  const upiR  = Validator.upi(upiRaw);
  const nameR = Validator.name(nameRaw);

  if (!upiR.ok) { shakeEl('iupi'); toast(upiR.msg, true); return; }

  S.upi  = upiR.value;
  S.name = nameR.value; // always Ok — name is optional

  // Multi-account merchant? (drops a stale scanned list if the field changed)
  renderPayeeNote();
  if (S.payees.length < 2) S.payees = [S.upi];
  const multi = S.payees.length > 1;

  // Update payee badge on step 2
  const first = S.upi.split('@')[0];
  const dName = S.name || (first.charAt(0).toUpperCase() + first.slice(1));
  setTexts({
    'pb-name':    dName,
    'pb-upi-val': multi ? S.payees.length + ' accounts · split-ready' : S.upi,
    'pb-av':      dName.charAt(0).toUpperCase(),
  });

  // Pre-fill amount from history
  const lastAmt = Storage.lastAmount;
  if (lastAmt > 0 && !getValue('iamt')) {
    setValue('iamt', String(lastAmt));
    syncChips();
  }

  FSM.go(FSM.ST.AMOUNT);
  haptic('medium');
}

// ─── UPI HISTORY AUTOCOMPLETE ─────────────────────────────────────

/** Render the history dropdown when the UPI tab is active. */
function _renderUpiHistory() {
  const hist = Storage.upiHistory;
  const box  = $('upi-history');
  if (!box) return;

  if (!hist.length) { hide('upi-history'); return; }

  const items = hist.slice(0, 5).map(h => `
    <div class="hist-item" onclick="_selectUpi(${esc(JSON.stringify(h.upi))},${esc(JSON.stringify(h.name))})" role="option" tabindex="0">
      <div class="hist-av">${esc(h.upi.charAt(0).toUpperCase())}</div>
      <div class="hist-body">
        <div class="hist-upi">${esc(h.upi)}</div>
        ${h.name ? `<div class="hist-name">${esc(h.name)}</div>` : ''}
      </div>
      <button class="hist-del" onclick="event.stopPropagation();_removeHistUpi(${esc(JSON.stringify(h.upi))})" aria-label="Remove">×</button>
    </div>`).join('');

  setHtml('upi-history', items);
  show('upi-history');
}

function _selectUpi(upi, name) {
  haptic('light');
  setValue('iupi', upi);
  if (name) setValue('iname', name);
  hide('upi-history');
  renderPayeeNote();
  EventBus.emit(EV.UPI_SELECTED, { upi, name });
}

function _removeHistUpi(upi) {
  haptic('light');
  Storage.removeUpi(upi);
  _renderUpiHistory();
}

// Dismiss history when tapping outside
document.addEventListener('click', e => {
  const box = $('upi-history');
  if (box && !box.contains(e.target) && e.target.id !== 'iupi') hide('upi-history');
}, { passive: true });

// Show history on focus of UPI input
document.addEventListener('focusin', e => {
  if (e.target && e.target.id === 'iupi') _renderUpiHistory();
}, { passive: true });

// ─── STEP 2: AMOUNT ───────────────────────────────────────────────

function sanitizeAmount(el) {
  const r = Validator.amount(el.value);
  if (!r.ok && el.value !== '') {
    if (parseFloat(el.value) > AMT_MAX) el.value = AMT_MAX;
  }
  syncChips();
  if (typeof updateMdrHint === 'function') updateMdrHint(el.value);
}

function sa(v) { haptic('light'); setValue('iamt', v); syncChips(); if (typeof updateMdrHint === 'function') updateMdrHint(v); }

function syncChips() {
  const v = parseFloat(getValue('iamt')) || 0;
  [2000, 3000, 5000, 7500, 10000].forEach((amt, i) => {
    const chips = $$('.chip');
    if (chips[i]) chips[i].classList.toggle('on', amt === v);
  });
}

// ─── STEP 3: PLAN SETUP ───────────────────────────────────────────

function toStep3() {
  const amtR = Validator.amount(getValue('iamt'));
  if (!amtR.ok) { shakeEl('iamt'); toast(amtR.msg, true); return; }

  S.total      = amtR.value;
  S.note       = getValue('inote').trim();
  S.customParts = getMin(S.total);
  S.splitMode  = Storage.splitMode;
  S.splits     = S.splitMode === 'equal'
    ? equalSplit(S.total, S.customParts)
    : randomSplit(S.total, S.customParts);
  S.paid   = S.splits.map(() => false);
  S.failed = S.splits.map(() => false);
  S.refs   = S.splits.map((_, i) => makeRef(i + 1));
  S.assign = [];              // multi-account: rebuilt by renderPreview()
  S.assignManual = false;

  // Restore turbo default from storage
  const tc = $('turbo-chk');
  if (tc) tc.checked = Storage.turboDefault;

  // Sync the toggle buttons to match S.splitMode
  toggleClass('st-eq',  'on', S.splitMode === 'equal');
  toggleClass('st-rnd', 'on', S.splitMode === 'random');
  toggleVis('reshuffle-btn', S.splitMode === 'random');
  setText('sc-val', String(S.customParts));

  renderPreview();
  EventBus.emit(EV.SPLIT_READY, { splits: S.splits, total: S.total, mode: S.splitMode });
  FSM.go(FSM.ST.PLAN);
  haptic('medium');
}

// ─── MODE PICKER ──────────────────────────────────────────────────

function pickMode(k) {
  haptic('light');
  S.mode = k;
  toggleClass('mc-auto', 'on', k === 'auto');
  toggleClass('mc-man',  'on', k === 'manual');
  toggleVis('turbo-row', k === 'auto', 'flex');
}

// ─── RESET ────────────────────────────────────────────────────────

function reset() {
  // Save current session data before wiping
  if (S.upi)   Storage.addUpi(S.upi, S.name);
  if (S.total) Storage.addAmount(S.total);

  resetState();
  FSM.reset();

  // Save turbo pref before clearing
  const tc = $('turbo-chk');
  if (tc) { Storage.turboDefault = tc.checked; tc.checked = Storage.turboDefault; }

  ['iamt', 'iupi', 'iname', 'inote'].forEach(id => setValue(id, ''));
  pickMode('auto');
  syncChips();
  upiTab('scan');
  EventBus.emit(EV.RESET);
  // FSM.reset() already put the machine in PAYEE; FSM.go(PAYEE) would be an
  // illegal PAYEE→PAYEE transition (silently ignored), leaving the user
  // stranded on the Done screen. Navigate directly instead.
  goTo(FSM.screen);
  haptic('medium');
}
