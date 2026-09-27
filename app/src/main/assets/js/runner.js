/* ═══════════════════════════════════════════════════════════════════
   SplitPay — runner.js  (v2)
   Auto-mode runner, manual-mode runner, QR overlay, finish screen.

   v2 changes:
     • DOM writes go through dom.js (setText, show, hide, etc.)
     • FSM.go() drives screen transitions instead of raw goTo()
     • EventBus emits PAY_START, PAY_PART_DONE, PAY_COMPLETE
     • Storage saves UPI + amount on sequence completion
     • Validator.splitPlan() guards startPay() pre-flight check
     • Native bridge reports events via AndroidBridge if available
   ═══════════════════════════════════════════════════════════════════ */

// ─── UPI LINK ─────────────────────────────────────────────────────

/**
 * @param part  1-based part number. The receiving UPI ID comes from
 *              payeeFor() so multi-account merchants get each part
 *              sent to its own assigned account.
 */
function mkLink(amt, part, ref) {
  return 'upi://pay?' + new URLSearchParams({
    pa: payeeFor(part - 1),
    pn: S.name || 'Merchant',
    am: amt.toFixed(2),
    cu: 'INR',
    tn: (S.note || 'Ledger') + ' P' + part + '/' + S.splits.length,
    tr: ref,
  });
}

/**
 * PAY (fraud-warning fix).
 *
 * Open a UPI link through the native bridge whenever it's available.
 * The native side launches the chosen UPI app with an explicit package
 * name (when a default app is set in Settings → UPI App) and AWAITS the
 * transaction result — the exact combination Google's UPI integration
 * guide requires, and the only one that stops GPay / PhonePe / Paytm /
 * BHIM showing the red "possible fraud / third-party app" warning.
 *
 * Falls back to an <a> click in a plain browser / PWA context.
 */
function payUpi(link) {
  if (window.AndroidBridge && window.AndroidBridge.payWithUpi) {
    try { AndroidBridge.payWithUpi(link); return true; } catch (e) { /* fall through */ }
  }
  const a = Object.assign(document.createElement('a'), { href: link });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  return false;
}

/**
 * Runner pay-button label.
 *
 * Shows the UPI app that will actually open — "Pay with Google Pay" —
 * when a default app is chosen in Settings → UPI App for Payments, and
 * the generic "Open UPI App" when set to Ask every time (the system
 * chooser decides there). Falls back silently in a browser/PWA.
 *
 * Called from runPart() (each part), startPay() (plan → runner), and
 * bridge.js after the user changes their default app in Settings so an
 * already-visible button never shows a stale app name.
 */
function refreshPayBtnLabel() {
  const el = document.getElementById('a-link-txt');
  if (!el) return;
  let name = '';
  const bridge = window.AndroidBridge;
  if (bridge && bridge.getPreferredUpiAppName) {
    try { name = bridge.getPreferredUpiAppName() || ''; } catch (e) { name = ''; }
  }
  el.textContent = name ? 'Pay with ' + name : 'Open UPI App';
}

// ─── START ────────────────────────────────────────────────────────

function startPay() {
  const r = Validator.splitPlan(S.splits, S.total, S.splitMode);
  if (!r.ok) { toast(r.msg, true); return; }
  if (!FSM.can(S.mode === 'auto' ? FSM.ST.AUTO : FSM.ST.MANUAL)) {
    toast('Sequence already running', true); return;
  }

  syncAssign();                       // multi-account: guarantee a valid part → account map
  haptic('heavy');
  S.turbo    = $('turbo-chk')?.checked ?? true;
  S.cur      = 0;
  S.running  = true;
  S.awaiting = false;
  S.paid     = S.splits.map(() => false);
  S.failed   = S.splits.map(() => false);
  S.refs     = S.splits.map((_, i) => makeRef(i + 1));

  EventBus.emit(EV.PAY_START, {
    total: S.total, parts: S.splits.length, mode: S.mode,
  });

  // Notify native layer
  if (window.AndroidBridge?.onPaymentStarted) {
    try { AndroidBridge.onPaymentStarted(S.total, S.splits.length, S.mode); }
    catch (_) {}
  }

  if (S.mode === 'auto') {
    setText('a-lbl', S.turbo ? 'Turbo Sequence' : 'Auto Progress');
    FSM.go(FSM.ST.AUTO);
    buildDots('a-dots');
    refreshPayBtnLabel();
    runPart(0);
  } else {
    FSM.go(FSM.ST.MANUAL);
    buildDots('m-dots');
    buildManualList();
    setText('mr-count', '0/' + S.splits.length);
  }
}

// ─── DOT PROGRESS ─────────────────────────────────────────────────

function buildDots(id) {
  const c = $(id);
  if (!c) return;
  c.innerHTML = '';
  const frag = document.createDocumentFragment();
  S.splits.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'dot' + (i === 0 ? ' cur' : '');
    d.id = id + '-d' + i;
    frag.appendChild(d);
  });
  c.appendChild(frag);
}

function refreshDots(id) {
  S.splits.forEach((_, i) => {
    const d = $(id + '-d' + i);
    if (!d) return;
    d.className = 'dot';
    if      (S.paid[i])   d.classList.add('ok');
    else if (S.failed[i]) d.classList.add('fail');
    else if (i === S.cur)  d.classList.add('cur');
  });
}

// ─── QR ───────────────────────────────────────────────────────────

function drawQR(link) {
  const box = $('qr-box');
  if (!box) return;
  box.innerHTML = '';
  new QRCode(box, {
    text: link, width: 200, height: 200,
    colorDark: '#000000', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
  openModal('qr-modal');
}

function openCurQR()     { haptic('light'); drawQR(mkLink(S.splits[S.cur], S.cur + 1, S.refs[S.cur])); }
function showManualQR(i) { haptic('light'); drawQR(mkLink(S.splits[i], i + 1, S.refs[i])); }

// ─── AUTO MODE ────────────────────────────────────────────────────

function runPart(i) {
  if (i >= S.splits.length) { finish(); return; }
  S.cur = i;
  const amt = S.splits[i];
  const ref = S.refs[i];

  setTexts({
    'a-count': (i + 1) + '/' + S.splits.length,
    'a-ppart': 'Part ' + (i + 1) + ' of ' + S.splits.length,
    'a-pamt':  '₹' + amt.toLocaleString('en-IN'),
    'a-psub':  'of ₹' + S.total.toLocaleString('en-IN') + ' total',
  });
  setHref('a-link', mkLink(amt, i + 1, ref));
  toggleVis('a-pto', S.payees.length > 1);
  setText('a-pto-val', payeeFor(i));
  refreshPayBtnLabel();

  show('a-paybig'); hide('a-retry'); hide('a-cd'); hide('a-ts');
  refreshDots('a-dots');
  S.awaiting = true;
}

function onOpen()        { haptic('light'); S.awaiting = true; }
function markCurDone()   { haptic('medium'); doAutoConfirm(true); }
function retryCur() {
  haptic('light');
  // FIX: route through the bridge (explicit package + awaited result)
  payUpi(mkLink(S.splits[S.cur], S.cur + 1, S.refs[S.cur]));
  S.awaiting = true;
  show('a-retry', 'flex');
}

/** Called when the user returns from a UPI app (visibility / focus). */
function onVisReturn() {
  if (!S.awaiting || !S.running) return;
  S.awaiting = false;
  clearInterval(S.cdTimer);

  if (S.mode === 'auto') {
    hide('a-cd'); hide('a-ts'); show('a-paybig');
    if (S.turbo && S.cur > 0) {
      setTimeout(() => {
        // FIX: this branch marked the part paid directly, bypassing
        // doAutoConfirm(true) — so no EV.PAY_PART_DONE was emitted and
        // AndroidBridge.onPartResult() never fired for any turbo part
        // except the last one. Route through the same confirm path the
        // non-turbo flow uses so events stay consistent.
        doAutoConfirm(true);
      }, 350);
    } else {
      setTimeout(() => showConfirmSheet(
        'Part ' + (S.cur + 1) + ' done?',
        'Did ₹' + S.splits[S.cur].toLocaleString('en-IN') + ' process successfully?',
        'auto'
      ), 450);
    }
  } else {
    if (S.mPendingIdx >= 0) {
      const idx = S.mPendingIdx;
      S.mPendingIdx = -1;
      setTimeout(() => showConfirmSheet(
        'Part ' + (idx + 1) + ' done?',
        'Did ₹' + S.splits[idx].toLocaleString('en-IN') + ' process successfully?',
        'manual'
      ), 450);
    }
  }
}

// Passive listeners for maximum scroll performance
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onVisReturn(); else closeCam();
}, { passive: true });
window.addEventListener('focus', onVisReturn, { passive: true });

function doAutoConfirm(ok) {
  const i = S.cur;
  S.paid[i]   = ok;
  S.failed[i] = !ok;

  EventBus.emit(EV.PAY_PART_DONE, { idx: i, amount: S.splits[i], success: ok });
  if (window.AndroidBridge?.onPartResult) {
    try { AndroidBridge.onPartResult(i, S.splits[i], ok); } catch (_) {}
  }

  if (!ok) {
    show('a-retry', 'flex');
    toast('Marked as failed', true); haptic('error'); return;
  }
  haptic('medium');
  refreshDots('a-dots');
  const n = i + 1;
  if (n >= S.splits.length) { finish(); return; }
  if (S.turbo) launchTurbo(n); else startCountdown(n);
}

function launchTurbo(nextI) {
  hide('a-paybig');
  show('a-ts');
  setText('ts-ttl', 'Part ' + (nextI + 1) + ' launching');
  const fill = $('ts-fill');
  if (fill) { fill.style.animation = 'none'; fill.offsetHeight; fill.style.animation = ''; }
  setTimeout(() => {
    runPart(nextI);
    // FIX: route through the bridge (explicit package + awaited result)
    payUpi(mkLink(S.splits[nextI], nextI + 1, S.refs[nextI]));
  }, 850);
}

function startCountdown(nextI) {
  hide('a-paybig'); show('a-cd');
  let v = 3;
  setText('a-cdnum', String(v));
  S.cdTimer = setInterval(() => {
    v--;
    setText('a-cdnum', String(v));
    if (v <= 0) { clearInterval(S.cdTimer); runPart(nextI); }
  }, 1000);
}

function pauseAuto() {
  haptic('light'); clearInterval(S.cdTimer);
  hide('a-cd'); show('a-paybig');
  S.awaiting = true; toast('Sequence paused');
}

// ─── MANUAL MODE ──────────────────────────────────────────────────

function buildManualList() {
  const list = $('mlist');
  if (!list) return;
  const frag = document.createDocumentFragment();
  S.splits.forEach((amt, i) => {
    const div = document.createElement('div');
    div.className = 'mi' + (i === 0 ? ' cur' : '');
    div.id = 'mi' + i;
    div.style.setProperty('--i', Math.min(i, 10));
    const link = mkLink(amt, i + 1, S.refs[i]);
    div.innerHTML = `
      <div class="mi-num" id="mn${i}">${i + 1}</div>
      <div class="mi-body">
        <div class="mi-amt">₹${amt.toLocaleString('en-IN')}</div>
        ${S.payees.length > 1 ? `<div class="mi-to">→ ${esc(payeeFor(i))}</div>` : ''}
        <div class="mi-ref">Ref: ${esc(S.refs[i])}</div>
      </div>
      <div id="mia${i}" style="display:flex;gap:8px;">
        ${i === 0 ? _mActions(i, link) : '<span style="opacity:.3;padding:12px 16px;font-size:.9rem;">Wait</span>'}
      </div>`;
    frag.appendChild(div);
  });
  list.innerHTML = '';
  list.appendChild(frag);
}

function _mActions(i, link) {
  return `<button class="btn btn-ghost btn-sm" style="padding:12px;" onclick="showManualQR(${i})">
    <svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-qr"></use></svg>
  </button>
  <a href="${link}" class="btn btn-pri btn-sm" style="padding:12px 16px;" onclick="mPayLink(event, ${i})">Pay</a>
  <button class="btn btn-ghost btn-sm" style="padding:12px;color:var(--ok);border-color:var(--ok);" onclick="mDone(${i})">
    <svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg>
  </button>`;
}

/**
 * Manual-mode Pay tap.
 * FIX (fraud warning): the old <a href="upi://…"> fired an implicit,
 * unawaited intent — the exact pattern that triggers the fraud warning
 * in GPay/PhonePe/Paytm/BHIM. Intercept the tap and hand the SAME link
 * to the native bridge so it launches explicitly + awaits the result.
 */
function mPayLink(ev, i) {
  if (ev) ev.preventDefault();
  mPay(i);
  const link = mkLink(S.splits[i], i + 1, S.refs[i]);
  if (!payUpi(link)) {
    // Browser/PWA fallback: re-arm the anchor so the default <a> nav runs.
    const a = ev && ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (a && a.href) { const tmp = Object.assign(document.createElement('a'), { href: link }); document.body.appendChild(tmp); tmp.click(); document.body.removeChild(tmp); }
  }
}

function mPay(i)  { haptic('light');  S.mPendingIdx = i; S.awaiting = true; }
function mDone(i) { haptic('medium'); S.mPendingIdx = i; doManualConfirm(true); }

function doManualConfirm(ok) {
  const i = S.mPendingIdx >= 0 ? S.mPendingIdx : S.cur;
  S.mPendingIdx = -1;
  S.paid[i]   = ok;
  S.failed[i] = !ok;
  haptic(ok ? 'medium' : 'error');

  EventBus.emit(EV.PAY_PART_DONE, { idx: i, amount: S.splits[i], success: ok });

  const item   = $('mi' + i);
  const numEl  = $('mn' + i);
  if (item) { item.classList.remove('cur'); item.classList.add(ok ? 'ok' : 'fail'); }
  if (numEl) setHtml('mn' + i, ok
    ? '<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-check"></use></svg>'
    : '<svg class="icn icn-sm" style="display:inline-block;"><use href="#ic-x"></use></svg>');

  const done = S.paid.filter(Boolean).length;
  // FIX: this and the setText() call above used to target id="m-count",
  // which was ALSO the id of the "Receiving accounts" count badge in the
  // Receive-mode markup (merchant.js). Two elements sharing one id means
  // getElementById() always returns whichever comes first in the document
  // — the Manual Ledger progress counter in this screen — so merchant.js's
  // own setText('m-count', ...) was silently writing into this progress
  // counter instead of the Receive-mode badge, which then never updated
  // past its static "0 / 12" placeholder. Renamed to the unique id
  // "mr-count" ("manual runner count") here; merchant.js keeps "m-count".
  setText('mr-count', done + '/' + S.splits.length);
  refreshDots('m-dots');

  const next = i + 1;
  if (next >= S.splits.length) { setTimeout(finish, 350); return; }

  const ni = $('mi' + next);
  if (ni) { ni.classList.add('cur'); ni.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  const nl = mkLink(S.splits[next], next + 1, S.refs[next]);
  setHtml('mia' + next, _mActions(next, nl));
  toast(ok ? 'Next unlocked' : 'Marked failed', !ok);
}

// ─── SKIP & CANCEL ────────────────────────────────────────────────

async function skipCur() {
  const ok = window.appConfirm
    ? await appConfirm('Skip Part', 'Skip part ' + (S.cur + 1) + '?', 'Skip', 'Keep')
    : confirm('Skip part ' + (S.cur + 1) + '?');
  if (!ok) return;
  S.failed[S.cur] = true; S.awaiting = false;
  clearInterval(S.cdTimer);
  const n = S.cur + 1;
  if (n >= S.splits.length) finish();
  else if (S.turbo) launchTurbo(n); else runPart(n);
}

async function cancelAll() {
  const ok = window.appConfirm
    ? await appConfirm('Cancel Sequence', 'Cancel the entire payment sequence?', 'Cancel', 'Keep Going')
    : confirm('Cancel entire sequence?');
  if (!ok) return;
  S.running = false; S.awaiting = false;
  clearInterval(S.cdTimer);
  EventBus.emit(EV.PAY_CANCEL);
  FSM.go(FSM.ST.PLAN);
}

function onAppBack() {
  try {
    if ($('cam-modal') && !$('cam-modal').classList.contains('hide')) { closeCam(); return true; }
    if ($('qr-modal') && !$('qr-modal').classList.contains('hide'))  { closeModal('qr-modal'); return true; }
    if ($('confirm-modal') && !$('confirm-modal').classList.contains('hide')) { closeModal('confirm-modal'); return true; }
    if (typeof dashBack === 'function' && dashBack()) return true;
    // FIX: the About modal was never closed by hardware back — pressing
    // back while it was open triggered the native exit dialog instead.
    const aboutM = $('about-modal');
    if (aboutM && !aboutM.classList.contains('hide')) { closeAbout(); return true; }
    // Settings modal — same treatment as About (hardware back closes it).
    const settingsM = $('settings-modal');
    if (settingsM && !settingsM.classList.contains('hide')) { closeSettings(); return true; }
    if (typeof merchantBack === 'function' && merchantBack()) return true;
    if (S.running) { if (S.mode === 'manual' || S.awaiting) { cancelAll(); return true; } return false; }
    return false;
  } catch { return false; }
}

// ─── FINISH ───────────────────────────────────────────────────────

function calcMdrSavings(total) {
  return total <= 2000 ? 0 : Math.min(total * 0.004, 300);
}

function finish() {
  haptic('heavy');
  S.running = false; S.awaiting = false;
  clearInterval(S.cdTimer);

  const pn = S.paid.filter(Boolean).length;
  const pa = S.splits.filter((_, i) => S.paid[i]).reduce((a, v) => a + v, 0);
  const fn = S.failed.filter(Boolean).length;

  setTexts({
    'd-total': '₹' + pa.toLocaleString('en-IN'),
    'd-parts': pn + '/' + S.splits.length,
    'd-title': pn === S.splits.length ? 'Payment Complete' : 'Partial Payment',
    'd-sub':   pn === S.splits.length
      ? 'Sequence finished successfully.'
      : pn + ' of ' + S.splits.length + ' parts completed.',
  });

  const savings = calcMdrSavings(S.total);
  toggleVis('d-savings-card', savings > 0);
  if (savings > 0) setText('d-savings-val', '₹' + savings.toFixed(2));

  // Persist UPI + amount for future autocomplete
  if (S.upi) Storage.addUpi(S.upi, S.name);
  if (S.total) Storage.addAmount(S.total);
  Storage.incrementPaymentCount();

  // Log this run for the Dashboard's Pay tab. Recorded whether the run
  // finished clean or partial — a failed/partial run is still useful
  // to see later, e.g. to know which parts still need retrying.
  Storage.addPayRecord({
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    upi: S.upi,
    name: S.name,
    total: S.total,
    runMode: S.mode,            // 'auto' | 'manual'
    splitMode: S.splitMode,     // 'equal' | 'random'
    multiAccount: S.payees.length > 1,
    partsPlanned: S.splits.length,
    partsPaid: pn,
    partsFailed: fn,
    partsPaidAmount: pa,
    mdrSaved: savings,
    parts: S.splits.map((amt, i) => ({
      amount: amt,
      status: S.paid[i] ? 'paid' : S.failed[i] ? 'failed' : 'pending',
      to: S.payees.length > 1 ? payeeFor(i) : null,
    })),
  });

  // Emit events
  EventBus.emit(EV.PAY_COMPLETE, { paid: pn, failed: fn, totalPaid: pa });
  if (window.AndroidBridge?.onSequenceFinished) {
    try { AndroidBridge.onSequenceFinished(pn, fn, pa); } catch (_) {}
  }

  // Defer receipt HTML to idle time
  const buildReceipt = () => {
    setHtml('d-receipt',
      `<div class="receipt-row"><span class="label">Payee</span><span class="val">${esc(S.name || S.upi)}</span></div>
       <div class="receipt-row"><span class="label">Total</span><span class="val">₹${S.total.toLocaleString('en-IN')}</span></div>
       ${S.splits.map((a, i) =>
         `<div class="receipt-row"><span class="label">Part ${i + 1}${S.payees.length > 1
              ? `<span class="receipt-to">→ ${esc(payeeFor(i))}</span>` : ''}</span>
          <span class="val">₹${a.toLocaleString('en-IN')}&thinsp;${S.paid[i] ? '✓' : S.failed[i] ? '✕' : '—'}</span></div>`
       ).join('')}`
    );
  };
  if (window.requestIdleCallback) requestIdleCallback(buildReceipt, { timeout: 400 });
  else setTimeout(buildReceipt, 0);

  FSM.go(FSM.ST.DONE);
}

// ─── RECEIPT / SHARE ──────────────────────────────────────────────

function buildReceiptText() {
  const pn = S.paid.filter(Boolean).length;
  return `SplitPay Ledger\n───────────────\n` +
    `Payee: ${S.name || S.upi}\n` +
    (S.payees.length > 1 ? `Accounts: ${S.payees.length}\n` : `UPI: ${S.upi}\n`) +
    `Total: ₹${S.total.toLocaleString('en-IN')}\n` +
    `Parts: ${pn}/${S.splits.length}\n` +
    S.splits.map((a, i) =>
      ` [${i + 1}] ₹${a.toLocaleString('en-IN')} ${S.paid[i] ? '✓' : S.failed[i] ? '✕' : '—'}` +
      (S.payees.length > 1 ? ` → ${payeeFor(i)}` : '')
    ).join('\n') + '\n───────────────';
}

function shareWA() {
  const txt = S.total > 0 ? buildReceiptText() : 'SplitPay — Smart UPI Installment Splitter';
  window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
}

function copyReceipt() {
  const text = buildReceiptText();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Record copied')).catch(() => toast('Copy failed', true));
  } else { toast('Copy not supported', true); }
}
