/* ═══════════════════════════════════════════════════════════════════
   SplitPay — settings.js
   Settings modal: default UPI app picker + app preferences.

   The UPI app picker reads the installed-app list from the native
   bridge (AndroidBridge.getUpiApps) and saves the choice via
   AndroidBridge.setPreferredUpiApp.

   WHY A DEFAULT APP MATTERS (fraud-warning fix):
     When a default UPI app is set, every payment is launched with an
     explicit package name and an awaited result (Google's documented
     pattern) — the combination that stops GPay / PhonePe / Paytm /
     BHIM from showing the red "possible fraud / third-party app"
     warning sheet. "Ask every time" uses the system chooser, which
     still works with every UPI app but cannot suppress that warning.
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const ASK_EVERY_TIME = '__ask__';   // must match UpiAppCatalog.UPI_APP_NONE

let _settingsOpen = false;

/* ── open / close ──────────────────────────────────────────────────── */

function openSettings() {
  haptic('light');
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  _settingsOpen = true;
  modal.classList.remove('hide');
  renderUpiAppPicker();
  renderSettingsInfo();
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hide');
  _settingsOpen = false;
}

/**
 * Hardware-back hook — called from MainActivity's back handler before
 * onAppBack(). Returns true when the settings modal was open (and is
 * now closed), telling the back handler the press was consumed.
 */
function closeSettingsIfOpen() {
  if (!_settingsOpen) return false;
  closeSettings();
  return true;
}

/* ── default UPI app picker ────────────────────────────────────────── */

/**
 * Render the radio list of installed UPI apps + "Ask every time".
 * Falls back to a graceful notice in a plain browser (no bridge).
 */
function renderUpiAppPicker() {
  const listEl = document.getElementById('upi-app-list');
  if (!listEl) return;

  const bridge = window.AndroidBridge;
  const isNative = !!(bridge && bridge.getUpiApps);

  let apps = [];
  let current = ASK_EVERY_TIME;

  if (isNative) {
    try {
      apps = JSON.parse(bridge.getUpiApps() || '[]');
      current = bridge.getPreferredUpiApp() || ASK_EVERY_TIME;
    } catch (e) { apps = []; }
  }

  let html = '';

  // "Ask every time" — the safe universal default
  html += `
    <label class="upa${current === ASK_EVERY_TIME ? ' on' : ''}" onclick="chooseUpiApp('__ask__', event)">
      <span class="upa-radio${current === ASK_EVERY_TIME ? ' on' : ''}"></span>
      <span class="upa-body">
        <span class="upa-name">Ask every time</span>
        <span class="upa-sub">System chooser — works with every UPI app</span>
      </span>
    </label>`;

  if (!apps.length) {
    html += `
      <div class="upa-empty">
        <svg class="icn icn-sm" style="display:inline-block;" aria-hidden="true"><use href="#ic-info"/></svg>
        No UPI apps detected on this device. Install Google Pay, PhonePe, Paytm or BHIM to pay.
      </div>`;
  } else {
    html += apps.map(app => {
      const pkg  = esc(app.packageName || '');
      const name = esc(app.displayName || app.packageName || 'UPI app');
      const on   = current === app.packageName;
      return `
      <label class="upa${on ? ' on' : ''}" onclick="chooseUpiApp('${pkg}', event)">
        <span class="upa-radio${on ? ' on' : ''}"></span>
        <span class="upa-body">
          <span class="upa-name">${name}</span>
          <span class="upa-sub">Opens ${name} directly for every payment</span>
        </span>
      </label>`;
    }).join('');
  }

  listEl.innerHTML = html;
}

/**
 * Select a default UPI app.
 * @param {string} pkg  package name, or '__ask__' for "Ask every time"
 */
function chooseUpiApp(pkg, ev) {
  if (ev) ev.preventDefault();
  haptic('light');

  const bridge = window.AndroidBridge;
  if (!bridge || !bridge.setPreferredUpiApp) {
    toast('Available only in the app', true);
    return;
  }
  try {
    bridge.setPreferredUpiApp(pkg === ASK_EVERY_TIME ? '' : pkg);
  } catch (e) {
    toast('Could not save choice', true);
    return;
  }

  // Re-render so the saved choice is reflected from the source of truth
  renderUpiAppPicker();
  renderSettingsInfo();

  toast(pkg === ASK_EVERY_TIME
    ? 'Will ask every time'
    : 'Default UPI app saved');
}

/* ── informational rows ────────────────────────────────────────────── */

function renderSettingsInfo() {
  // Payment count — same source the dashboard uses
  let count = 0;
  try { count = Storage.paymentCount || 0; } catch (e) {}

  // Default app name for the summary line
  let defaultName = 'Ask every time';
  const bridge = window.AndroidBridge;
  if (bridge && bridge.getPreferredUpiApp) {
    try {
      const pkg = bridge.getPreferredUpiApp();
      if (pkg && pkg !== ASK_EVERY_TIME) {
        const apps = (() => { try { return JSON.parse(bridge.getUpiApps() || '[]'); } catch (e) { return []; } })();
        const found = apps.find(a => a.packageName === pkg);
        defaultName = found ? found.displayName : pkg;
      }
    } catch (e) {}
  }

  setHtml('settings-summary', `
    <div class="set-row">
      <span class="set-k">Default UPI app</span>
      <span class="set-v">${esc(defaultName)}</span>
    </div>
    <div class="set-row">
      <span class="set-k">Sequences started</span>
      <span class="set-v">${count}</span>
    </div>`);
}

/* ── data controls ─────────────────────────────────────────────────── */

async function settingsClearAllData() {
  const ok = window.appConfirm
    ? await appConfirm('Clear All Data', 'Delete pay history, receive history, saved UPI IDs, amounts and settings on this device? This can\u2019t be undone.', 'Delete All', 'Cancel')
    : confirm('Delete all saved data on this device?');
  if (!ok) return;

  try { Storage.clearAll(); } catch (e) {}

  // Native mirror prefs (theme/turbo/count) — keep the chosen UPI app!
  // UpiAppCatalog stores it under its own prefs file, so nothing to do.
  try {
    if (window.AndroidBridge && window.AndroidBridge.setThemePref) {
      window.AndroidBridge.setThemePref('system');
    }
    if (window.AndroidBridge && window.AndroidBridge.setTurboPref) {
      window.AndroidBridge.setTurboPref(true);
    }
  } catch (e) {}

  // Reset UI state to defaults
  try {
    document.documentElement.removeAttribute('data-theme');
    const tc = document.getElementById('turbo-chk');
    if (tc) tc.checked = true;
  } catch (e) {}

  renderSettingsInfo();
  toast('All data cleared');
}
