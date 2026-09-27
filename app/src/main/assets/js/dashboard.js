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

// ─── OPEN / CLOSE / TABS ────────────────────────────────────────────

function openDashboard() {
  haptic('light');
  _dashTab    = 'pay';
  _dashOpenId = null;
  syncDashTabs();
  renderDashboard();
  const m = $('dash-modal');
  if (m) m.classList.remove('hide');
}

function closeDashboard() {
  const m = $('dash-modal');
  if (m) m.classList.add('hide');
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
  if (_dashTab === 'pay') renderPayDash(); else renderRecvDash();
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
  const hist = Storage.payHistory;

  setHtml('dash-pay-stats', !hist.length ? '' : (() => {
    const sent  = hist.reduce((a, r) => a + (r.partsPaidAmount || 0), 0);
    const saved = hist.reduce((a, r) => a + (r.mdrSaved || 0), 0);
    return `
      <div class="dstat"><div class="dstat-v">₹${sent.toLocaleString('en-IN')}</div><div class="dstat-l">Total sent</div></div>
      <div class="dstat"><div class="dstat-v">${hist.length}</div><div class="dstat-l">Split payments</div></div>
      <div class="dstat"><div class="dstat-v">₹${saved.toFixed(0)}</div><div class="dstat-l">Est. MDR saved</div></div>`;
  })());

  toggleVis('dash-pay-clear', hist.length > 0, 'inline-flex');

  if (!hist.length) {
    setHtml('dash-pay-list',
      `<div class="dash-empty">No payments yet.<br>Completed split payments show up here.</div>`);
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
          <button class="btn btn-ghost btn-sm btn-full" style="margin-top:12px;color:var(--err);border-color:var(--err-bdr);"
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
  Storage.removePayRecord(id);
  if (_dashOpenId === id) _dashOpenId = null;
  toast('Record deleted');
  renderPayDash();
}

async function dashClearPay() {
  const ok = window.appConfirm
    ? await appConfirm('Clear Pay History', 'Delete all saved pay records on this device? This can\u2019t be undone.', 'Clear', 'Cancel')
    : confirm('Delete all saved pay records on this device?');
  if (!ok) return;
  Storage.clearPayHistory();
  _dashOpenId = null;
  toast('Pay history cleared');
  renderPayDash();
}

// ─── RECEIVE TAB ─────────────────────────────────────────────────

function renderRecvDash() {
  const hist = Storage.receiveHistory;

  setHtml('dash-recv-stats', !hist.length ? '' : `
    <div class="dstat"><div class="dstat-v">${hist.length}</div><div class="dstat-l">QR codes generated</div></div>
    <div class="dstat"><div class="dstat-v">${Storage.merchant.accounts.length}</div><div class="dstat-l">Accounts saved now</div></div>`);

  toggleVis('dash-recv-clear', hist.length > 0, 'inline-flex');

  if (!hist.length) {
    setHtml('dash-recv-list',
      `<div class="dash-empty">No merchant QR codes generated yet.<br>Every QR you generate in Receive mode is logged here — this app has no backend, so it can't show whether a payer actually paid it.</div>`);
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
  Storage.removeReceiveRecord(id);
  if (_dashOpenId === id) _dashOpenId = null;
  toast('Record deleted');
  renderRecvDash();
}

async function dashClearRecv() {
  const ok = window.appConfirm
    ? await appConfirm('Clear Receive History', 'Delete all saved QR-generation records on this device? This can\u2019t be undone.', 'Clear', 'Cancel')
    : confirm('Delete all saved QR records on this device?');
  if (!ok) return;
  Storage.clearReceiveHistory();
  _dashOpenId = null;
  toast('Receive history cleared');
  renderRecvDash();
}

// ─── HARDWARE BACK ───────────────────────────────────────────────

/** Called from onAppBack() in runner.js, same pattern as merchantBack(). */
function dashBack() {
  const m = $('dash-modal');
  if (m && !m.classList.contains('hide')) { closeDashboard(); return true; }
  return false;
}
