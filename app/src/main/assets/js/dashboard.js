/* ═══════════════════════════════════════════════════════════════════
   SplitPay — dashboard.js
   Read-only Dashboard: on-device history for both Pay and Receive
   modes, built entirely from Storage.payHistory / Storage.receiveHistory.

   This module only *renders* — it never writes a history record itself.
   Records are written where the event actually happens:
     • runner.js's finish()        → Storage.addPayRecord()
     • merchant.js's merchantGenerate() → Storage.addReceiveRecord()

   Everything here is on-device only (same as the rest of the app — no
   backend, no network). Deleting a record or clearing history only
   edits localStorage; it can't affect a payment that already happened.
   ═══════════════════════════════════════════════════════════════════ */

let _dashTab    = 'pay';   // 'pay' | 'receive'
let _dashOpenId = null;    // id of the currently expanded row, or null
let _dashQuery  = '';      // active filter text, lower-cased

// ─── OPEN / CLOSE / TABS ────────────────────────────────────────────

function openDashboard() {
  haptic('light');
  _dashTab    = 'pay';
  _dashOpenId = null;
  _dashQuery  = '';
  const box = $('dash-search');
  if (box) box.value = '';
  syncDashTabs();
  renderDashboard();
  openFullModal('dash-modal');   // focus in, Escape/Tab handled in nav.js
}

/**
 * @param {boolean} [restoreFocus=true]  Pass false when the Dashboard is
 *        being closed to continue the pay flow (Repeat), so focus isn't
 *        dragged back to the topbar button the user has moved on from.
 */
function closeDashboard(restoreFocus = true) {
  closeFullModal('dash-modal', restoreFocus);
}

function dashTab(tab) {
  if (tab !== 'pay' && tab !== 'receive') return;
  if (tab === _dashTab) return;
  haptic('light');
  _dashTab    = tab;
  _dashOpenId = null;
  syncDashTabs();
  renderDashboard();
}

function syncDashTabs() {
  toggleClass('dt-pay',  'on', _dashTab === 'pay');
  toggleClass('dt-recv', 'on', _dashTab === 'receive');
  setAttr('dt-pay',  'aria-selected', String(_dashTab === 'pay'));
  setAttr('dt-recv', 'aria-selected', String(_dashTab === 'receive'));
  toggleVis('dash-pay-panel',  _dashTab === 'pay',     'block');
  toggleVis('dash-recv-panel', _dashTab === 'receive', 'block');
}

function dashToggleRow(id) {
  _dashOpenId = _dashOpenId === id ? null : id;
  renderDashboard();
}

function renderDashboard() {
  // One filter box serves both tabs, and only earns its space once there
  // is something to search.
  toggleVis('dash-search-wrap',
    Storage.payHistory.length + Storage.receiveHistory.length > 0, 'flex');
  if (_dashTab === 'pay') renderPayDash(); else renderRecvDash();
}

/**
 * Shared text filter for both tabs: matches a payee/merchant name, a UPI
 * ID, a note, an amount, or a part's destination account.
 */
function _dashMatch(rec) {
  if (!_dashQuery) return true;
  const hay = [
    rec.name, rec.upi, rec.note, rec.total, rec.partsPaidAmount,
    ...(rec.parts || []).map(p => p && p.to),
    ...(rec.accounts || []),
  ].filter(v => v !== null && v !== undefined && v !== '').join(' ').toLowerCase();
  return hay.includes(_dashQuery);
}

/** oninput for the dashboard search box. */
function dashSearch(q) {
  _dashQuery  = String(q || '').trim().toLowerCase();
  _dashOpenId = null;
  renderDashboard();
}

/** Empty state shown when the filter hides every record. */
function _dashNoMatch() {
  return `<div class="dash-empty">No records match “${esc(_dashQuery)}”.<br>` +
    `Try a name, UPI ID, note or amount.</div>`;
}

/** "Today · 4:05 pm" / "Yesterday · 9:12 am" / "3 Sep · 6:40 pm". */
function _dashWhen(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today · ' + time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday · ' + time;
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts) + ' · ' + time;
}

const _DASH_ICON = id =>
  `<svg class="icn icn-sm" style="display:inline-block;" aria-hidden="true"><use href="#${id}"></use></svg>`;

// ─── PAY TAB ─────────────────────────────────────────────────────

function renderPayDash() {
  const all  = Storage.payHistory;
  const hist = _dashQuery ? all.filter(_dashMatch) : all;

  // Headline figures stay lifetime figures — they are the reason the
  // Dashboard exists, and a filter should not silently redefine them.
  setHtml('dash-pay-stats', !all.length ? '' : (() => {
    const sent  = all.reduce((a, r) => a + (r.partsPaidAmount || 0), 0);
    const saved = all.reduce((a, r) => a + (r.mdrSaved || 0), 0);
    return `
      <div class="dstat"><div class="dstat-v">₹${sent.toLocaleString('en-IN')}</div><div class="dstat-l">Total sent</div></div>
      <div class="dstat"><div class="dstat-v">${all.length}</div><div class="dstat-l">Split payments</div></div>
      <div class="dstat"><div class="dstat-v">₹${saved.toFixed(0)}</div><div class="dstat-l">Est. MDR saved</div></div>`;
  })());

  // Clear / share stay bound to the FULL history, so they never vanish
  // just because a filter happens to hide every row.
  toggleVis('dash-pay-clear', all.length > 0, 'inline-flex');
  toggleVis('dash-pay-share', all.length > 0, 'inline-flex');

  if (!all.length) {
    setHtml('dash-pay-list',
      `<div class="dash-empty">No payments yet.<br>Completed split payments show up here.</div>`);
    return;
  }
  if (!hist.length) {
    setHtml('dash-pay-list', _dashNoMatch());
    return;
  }

  setHtml('dash-pay-list', hist.map(r => {
    const open     = _dashOpenId === r.id;
    const complete = r.partsPaid === r.partsPlanned;
    const badge    = complete ? 'ok' : r.partsPaid > 0 ? 'warn' : 'fail';
    const label    = complete ? 'Complete' : r.partsPaid > 0 ? 'Partial' : 'Failed';
    return `
    <div class="dash-item${open ? ' open' : ''}" role="listitem">
      <button class="dash-row" onclick="dashToggleRow('${r.id}')" aria-expanded="${open}">
        <div class="dr-main">
          <div class="dr-title">${esc(r.name || r.upi || 'Unknown payee')}</div>
          <div class="dr-sub">${_dashWhen(r.ts)} · ${r.partsPlanned} part${r.partsPlanned > 1 ? 's' : ''}${r.multiAccount ? ' · multi-account' : ''}</div>
        </div>
        <div class="dr-end">
          <div class="dr-amt">₹${(r.partsPaidAmount || 0).toLocaleString('en-IN')}</div>
          <span class="dr-badge ${badge}">${label}</span>
        </div>
      </button>
      ${!open ? '' : `
        <div class="dash-detail">
          ${(r.parts || []).map((p, i) => `
            <div class="receipt-row">
              <span class="label">Part ${i + 1}${p.to ? `<span class="receipt-to">→ ${esc(p.to)}</span>` : ''}</span>
              <span class="val">₹${p.amount.toLocaleString('en-IN')}&thinsp;${p.status === 'paid' ? '✓' : p.status === 'failed' ? '✕' : '—'}</span>
            </div>`).join('')}
          <button class="btn btn-pri btn-sm btn-full" style="margin-top:12px;"
                  onclick="dashRepeat('${r.id}')">
            ${_DASH_ICON('ic-repeat')} Repeat this payment
          </button>
          <button class="btn btn-ghost btn-sm btn-full" style="margin-top:8px;color:var(--err);border-color:var(--err-bdr);"
                  onclick="dashDeletePay('${r.id}', event)">
            ${_DASH_ICON('ic-trash')} Delete record
          </button>
        </div>`}
    </div>`;
  }).join(''));
}

function dashDeletePay(id, ev) {
  if (ev) ev.stopPropagation();
  haptic('light');
  const removed = Storage.removePayRecord(id);
  if (_dashOpenId === id) _dashOpenId = null;
  renderDashboard();
  if (!removed) { toast('Record deleted'); return; }
  // Deleting history is the one irreversible-feeling action in the app,
  // so it now offers a way back that costs nothing if ignored.
  toast('Record deleted', false, {
    label: 'Undo',
    fn: () => {
      Storage.restorePayRecord(removed.rec, removed.index);
      renderDashboard();
      toast('Record restored');
    },
  });
}

async function dashClearPay() {
  const ok = window.appConfirm
    ? await appConfirm('Clear Pay History', 'Delete all saved pay records on this device? This can\u2019t be undone.', 'Clear', 'Cancel')
    : confirm('Delete all saved pay records on this device?');
  if (!ok) return;
  Storage.clearPayHistory();
  _dashOpenId = null;
  toast('Pay history cleared');
  renderDashboard();
}

// ─── RECEIVE TAB ─────────────────────────────────────────────────

function renderRecvDash() {
  const all  = Storage.receiveHistory;
  const hist = _dashQuery ? all.filter(_dashMatch) : all;

  setHtml('dash-recv-stats', !all.length ? '' : `
    <div class="dstat"><div class="dstat-v">${all.length}</div><div class="dstat-l">QR codes generated</div></div>
    <div class="dstat"><div class="dstat-v">${Storage.merchant.accounts.length}</div><div class="dstat-l">Accounts saved now</div></div>`);

  toggleVis('dash-recv-clear', all.length > 0, 'inline-flex');
  toggleVis('dash-recv-share', all.length > 0, 'inline-flex');

  if (!all.length) {
    setHtml('dash-recv-list',
      `<div class="dash-empty">No merchant QR codes generated yet.<br>Every QR you generate in Receive mode is logged here — this app has no backend, so it can't show whether a payer actually paid it.</div>`);
    return;
  }
  if (!hist.length) {
    setHtml('dash-recv-list', _dashNoMatch());
    return;
  }

  setHtml('dash-recv-list', hist.map(r => {
    const open = _dashOpenId === r.id;
    const n    = (r.accounts || []).length;
    return `
    <div class="dash-item${open ? ' open' : ''}" role="listitem">
      <button class="dash-row" onclick="dashToggleRow('${r.id}')" aria-expanded="${open}">
        <div class="dr-main">
          <div class="dr-title">${esc(r.name || 'Unnamed merchant')}</div>
          <div class="dr-sub">${_dashWhen(r.ts)} · ${n} account${n > 1 ? 's' : ''}</div>
        </div>
        <div class="dr-end"><span class="dr-badge ok">QR</span></div>
      </button>
      ${!open ? '' : `
        <div class="dash-detail">
          ${(r.accounts || []).map((v, i) => `
            <div class="receipt-row">
              <span class="label">${i === 0 ? 'Primary' : 'Account ' + (i + 1)}</span>
              <span class="val">${esc(v)}</span>
            </div>`).join('')}
          <button class="btn btn-ghost btn-sm btn-full" style="margin-top:12px;color:var(--err);border-color:var(--err-bdr);"
                  onclick="dashDeleteRecv('${r.id}', event)">
            ${_DASH_ICON('ic-trash')} Delete record
          </button>
        </div>`}
    </div>`;
  }).join(''));
}

function dashDeleteRecv(id, ev) {
  if (ev) ev.stopPropagation();
  haptic('light');
  const removed = Storage.removeReceiveRecord(id);
  if (_dashOpenId === id) _dashOpenId = null;
  renderDashboard();
  if (!removed) { toast('Record deleted'); return; }
  toast('Record deleted', false, {
    label: 'Undo',
    fn: () => {
      Storage.restoreReceiveRecord(removed.rec, removed.index);
      renderDashboard();
      toast('Record restored');
    },
  });
}

async function dashClearRecv() {
  const ok = window.appConfirm
    ? await appConfirm('Clear Receive History', 'Delete all saved QR-generation records on this device? This can\u2019t be undone.', 'Clear', 'Cancel')
    : confirm('Delete all saved QR records on this device?');
  if (!ok) return;
  Storage.clearReceiveHistory();
  _dashOpenId = null;
  toast('Receive history cleared');
  renderDashboard();
}

// ─── REPEAT & SHARE ──────────────────────────────────────────────

/**
 * Prefill a fresh payment from a past run and land on the Amount screen
 * ready to continue. Only fields the record carries are restored (payee,
 * name, total, note); a multi-account merchant's full account list isn't
 * stored, so such a run restarts against its primary account and the pack
 * can be re-scanned if the payer needs every account again.
 */
function dashRepeat(id) {
  const rec = Storage.payHistory.find(r => r.id === id);
  if (!rec) { toast('That record is no longer available', true); return; }
  if (FSM.isRunning) { toast('Finish or cancel the current payment first', true); return; }
  haptic('medium');
  closeDashboard(false);   // keep focus with the pay flow, not the topbar
  if (typeof _appMode !== 'undefined' && _appMode !== 'pay' && typeof setAppMode === 'function') {
    setAppMode('pay');
  }
  FSM.reset();
  setValue('iupi', rec.upi || '');
  setValue('iname', rec.name || '');
  setValue('iamt', rec.total ? String(rec.total) : '');
  setValue('inote', rec.note || '');
  S.upiParams = {};
  S.payees = [];
  upiTab('type');
  renderPayeeNote();
  toStep2();                 // validates the payee and moves to Amount (prefilled)
  toast('Details restored — review and continue');
}

/** One share path for both export actions: native sheet → Web Share → WhatsApp. */
function _dashShare(text, title) {
  try {
    if (window.AndroidBridge && window.AndroidBridge.shareText) {
      window.AndroidBridge.shareText(text);
      return;
    }
    if (navigator.share) { navigator.share({ title, text }).catch(() => {}); return; }
  } catch (e) { /* fall through */ }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

function dashSharePay() {
  const hist = Storage.payHistory;
  if (!hist.length) { toast('No pay history to share', true); return; }
  haptic('light');
  const lines = hist.slice(0, 25).map(r => {
    const amt  = (r.partsPaidAmount || 0).toLocaleString('en-IN');
    const part = r.partsPaid === r.partsPlanned ? '' : ` (${r.partsPaid}/${r.partsPlanned} paid)`;
    return `• ${_dashWhen(r.ts)} — ${r.name || r.upi || 'Unknown'} — ₹${amt}${part}`;
  });
  const total = hist.reduce((a, r) => a + (r.partsPaidAmount || 0), 0);
  const text = 'SplitPay — Pay history\n───────────────\n' +
    `Total sent: ₹${total.toLocaleString('en-IN')} across ${hist.length} split payment${hist.length > 1 ? 's' : ''}\n` +
    '───────────────\n' + lines.join('\n') +
    '\n───────────────\nOn-device record — not a bank statement.';
  _dashShare(text, 'SplitPay Pay history');
}

function dashShareRecv() {
  const hist = Storage.receiveHistory;
  if (!hist.length) { toast('No receive history to share', true); return; }
  haptic('light');
  const lines = hist.slice(0, 25).map(r => {
    const n = (r.accounts || []).length;
    return `• ${_dashWhen(r.ts)} — ${r.name || 'Unnamed merchant'} — ${n} account${n > 1 ? 's' : ''}`;
  });
  const text = 'SplitPay — Receive history\n───────────────\n' +
    lines.join('\n') + '\n───────────────\nQR-generation log (on-device).';
  _dashShare(text, 'SplitPay Receive history');
}

// ─── HARDWARE BACK ───────────────────────────────────────────────

/** Called from onAppBack() in runner.js, same pattern as merchantBack(). */
function dashBack() {
  const m = $('dash-modal');
  if (m && !m.classList.contains('hide')) { closeDashboard(); return true; }
  return false;
}
