/* ═══════════════════════════════════════════════════════════════════
   SplitPay — merchant.js   (load after camera.js, before bridge.js)
   "Receive" mode: a merchant bundles up to 12 UPI IDs into ONE QR.

   Screens (both live inside <main>, so goTo() animates them):
     scm1  Accounts — business name + add / scan / remove / reorder
     scm2  QR       — the generated code, share as image

   The QR payload format is defined in upiqr.js. When a customer scans
   it with SplitPay, the split parts are spread across these accounts;
   any other UPI app just pays the first (primary) account.

   The profile (name + accounts) is saved in localStorage on every
   change, so the merchant only sets it up once.
   ═══════════════════════════════════════════════════════════════════ */

// ─── STATE ────────────────────────────────────────────────────────

let _appMode   = 'pay';      // 'pay' | 'receive'
let _mScreen   = 'm1';       // which merchant screen Receive mode is on
let _mName     = '';
let _mAccounts = [];
let _mLink     = '';         // payload behind the QR currently on scm2
let _mMatrix   = null;       // {n, dark(r,c)} for that payload

const _M_ICON = id => `<svg class="icn icn-sm" style="display:inline-block;" aria-hidden="true"><use href="#${id}"></use></svg>`;

function _mSave() {
  Storage.merchant = { name: _mName, accounts: _mAccounts };
}

/** shakeEl() leaves its red highlight on until the next shake; clear it once the animation ends. */
function _mShake(id) {
  shakeEl(id);
  const el = $(id);
  if (el) el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

// ─── APP MODE (Pay | Receive) ─────────────────────────────────────

function setAppMode(mode) {
  if (mode !== 'pay' && mode !== 'receive') return;
  if (mode === _appMode) return;
  if (FSM.isRunning) { toast('Finish or cancel the payment first', true); return; }

  _appMode = mode;
  document.body.classList.toggle('mode-receive', mode === 'receive');
  syncModebar();
  haptic('light');
  // Pay mode resumes exactly where the payer left off (FSM is untouched).
  goTo(mode === 'receive' ? _mScreen : FSM.screen);
}

/** Highlight the active mode; hide the switch while a payment is mid-run. */
function syncModebar() {
  toggleClass('mb-pay',  'on', _appMode === 'pay');
  toggleClass('mb-recv', 'on', _appMode === 'receive');
  setAttr('mb-pay',  'aria-selected', String(_appMode === 'pay'));
  setAttr('mb-recv', 'aria-selected', String(_appMode === 'receive'));
  toggleVis('modebar', !FSM.isRunning, 'flex');
  // Opening the Dashboard mid-sequence would abandon an in-flight part —
  // same reasoning as hiding the Pay/Receive switch above.
  toggleVis('dash-btn', !FSM.isRunning, 'flex');
}
EventBus.on('fsm:transition', syncModebar);
EventBus.on(EV.RESET, syncModebar);

// ─── ACCOUNTS ─────────────────────────────────────────────────────

function merchantInit() {
  const m = Storage.merchant;
  _mName     = m.name;
  _mAccounts = m.accounts.slice();
  setValue('m-name', _mName);
  merchantRender();
  _mNameHint();
  syncModebar();
}

function merchantNameInput(el) {
  _mName = el.value;
  _mSave();
  _mNameHint();
}

/** Warn when a long / non-Latin name had to be shortened to keep the QR scannable. */
function _mNameHint() {
  const norm  = _mName.replace(/\s+/g, ' ').trim();
  const shown = UpiQr.fitName(_mName);
  const cut   = norm && shown !== norm;
  toggleVis('m-name-hint', !!cut);
  if (cut) setText('m-name-hint', 'Shortened to “' + shown + '” inside the QR so it stays easy to scan.');
}

/**
 * Add UPI IDs to the list. Returns counts so callers can report precisely.
 * Duplicates are case-insensitive; the 12-account cap is enforced here
 * (and again in Storage / UpiQr, so no path can exceed it).
 */
function _mAdd(list) {
  const res  = { added: 0, dup: 0, invalid: 0, capped: 0 };
  const have = new Set(_mAccounts.map(v => v.toLowerCase()));
  for (const raw of list) {
    const v = String(raw == null ? '' : raw).trim();
    if (!Validator.upi(v).ok)                  { res.invalid++; continue; }
    if (have.has(v.toLowerCase()))             { res.dup++;     continue; }
    if (_mAccounts.length >= MAX_MERCHANT_UPIS) { res.capped++;  continue; }
    _mAccounts.push(v);
    have.add(v.toLowerCase());
    res.added++;
  }
  if (res.added) _mSave();
  return res;
}

/** Turn an _mAdd() result into one clear toast. Returns true if anything was added. */
function _mReport(res) {
  if (res.added) {
    let msg = 'Added ' + res.added + (res.added > 1 ? ' accounts' : ' account');
    if (res.capped) msg += ' · ' + res.capped + ' skipped (max ' + MAX_MERCHANT_UPIS + ')';
    toast(msg);
    haptic('medium');
    return true;
  }
  if (res.capped)  toast('Limit reached — max ' + MAX_MERCHANT_UPIS + ' UPI IDs', true);
  else if (res.dup) toast('Already in your list', true);
  else              toast('No valid UPI ID found', true);
  return false;
}

/** "+" button / Enter key. Accepts one ID, or several separated by space, comma or newline. */
function merchantAdd() {
  const raw    = getValue('m-vpa');
  const tokens = raw.split(/[\s,;]+/).filter(Boolean);

  if (tokens.length <= 1) {
    const r = Validator.upi(raw);
    if (!r.ok) { _mShake('m-vpa'); toast(r.msg, true); return; }
  }
  const res = _mAdd(tokens);
  if (!_mReport(res)) { _mShake('m-vpa'); return; }

  setValue('m-vpa', '');
  merchantRender();
  const el = $('m-vpa');
  if (el && _mAccounts.length < MAX_MERCHANT_UPIS) el.focus();
}

/** Called by handleScan() when the camera / gallery was opened from Receive mode. */
function merchantImportScan(r) {
  if (_appMode !== 'receive') setAppMode('receive');
  const res = _mAdd(r.accounts);
  if (r.pn && !_mName.trim()) {                 // adopt the QR's business name if none set
    _mName = r.pn.slice(0, 50);
    setValue('m-name', _mName);
    _mSave();
    _mNameHint();
  }
  _mReport(res);
  merchantRender();
}

function merchantRemove(i) {
  if (i < 0 || i >= _mAccounts.length) return;
  haptic('light');
  _mAccounts.splice(i, 1);
  _mSave();
  merchantRender();
}

function merchantMakePrimary(i) {
  if (i <= 0 || i >= _mAccounts.length) return;
  haptic('medium');
  const [v] = _mAccounts.splice(i, 1);
  _mAccounts.unshift(v);
  _mSave();
  merchantRender();
  toast('Primary account changed');
}

function merchantRender() {
  const n    = _mAccounts.length;
  const full = n >= MAX_MERCHANT_UPIS;

  setText('m-count', n + ' / ' + MAX_MERCHANT_UPIS);
  setHtml('m-pips', Array.from({ length: MAX_MERCHANT_UPIS },
    (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join(''));

  const vpa = $('m-vpa'), btn = $('m-add-btn');
  if (vpa) { vpa.disabled = full; vpa.placeholder = full ? 'Limit reached' : 'name@bank'; }
  if (btn) btn.disabled = full;
  ['m-scan-btn', 'm-gal-btn'].forEach(id => toggleClass(id, 'dis', full));

  if (!n) {
    setHtml('m-list', `<div class="m-empty">No accounts yet.<br>Add up to ${MAX_MERCHANT_UPIS} UPI IDs — they all go into one QR.</div>`);
    return;
  }
  setHtml('m-list', _mAccounts.map((v, i) => `
    <div class="macct${i === 0 ? ' pri' : ''}" role="listitem">
      <div class="macct-n">${i + 1}</div>
      <div class="macct-body">
        <div class="macct-upi">${esc(v)}</div>
        ${i === 0 ? '<div class="macct-tag">Primary · other UPI apps pay this one</div>' : ''}
      </div>
      ${i > 0 ? `<button class="macct-btn" onclick="merchantMakePrimary(${i})" aria-label="Make ${esc(v)} the primary account">${_M_ICON('ic-up')}</button>` : ''}
      <button class="macct-btn del" onclick="merchantRemove(${i})" aria-label="Remove ${esc(v)}">${_M_ICON('ic-trash')}</button>
    </div>`).join(''));
}

// ─── QR ───────────────────────────────────────────────────────────

/**
 * Build the QR module matrix for `text`.
 * qrcode.js is used only as an encoder here; we paint the modules
 * ourselves so the on-screen code and the shared PNG are pixel-crisp and
 * have a proper 4-module quiet zone.
 */
function _mQrMatrix(text) {
  const lvl = QRCode.CorrectLevel[text.length > 400 ? 'L' : 'M'];   // M unless the code is very dense
  const q   = new QRCode(document.createElement('div'),
    { text, width: 4, height: 4, colorDark: '#000000', colorLight: '#ffffff', correctLevel: lvl });
  const m = q._oQRCode;
  if (!m || typeof m.getModuleCount !== 'function') throw new Error('QR engine unavailable');
  return { n: m.getModuleCount(), dark: (r, c) => m.isDark(r, c) };
}

function _mPaintQr(cv, mat, mod, quiet) {
  const size = (mat.n + quiet * 2) * mod;
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < mat.n; r++)
    for (let c = 0; c < mat.n; c++)
      if (mat.dark(r, c)) ctx.fillRect((c + quiet) * mod, (r + quiet) * mod, mod, mod);
}

function merchantGenerate() {
  if (!_mAccounts.length) {
    _mShake('m-vpa'); toast('Add at least one UPI ID first', true); return;
  }
  const link = UpiQr.build({ name: _mName, accounts: _mAccounts });
  if (!link) { toast('Could not build QR', true); return; }

  let mat;
  try { mat = _mQrMatrix(link); }
  catch (e) { toast('Too much data for one QR — remove an account', true); return; }

  _mLink = link;
  _mMatrix = mat;
  _mPaintQr($('mq-canvas'), mat, Math.max(4, Math.ceil(720 / (mat.n + 8))), 4);

  // Log this generation for the Dashboard's Receive tab. This records
  // that a QR was *created* on this device — there's no backend, so the
  // app has no way to know whether or when anyone actually pays it.
  Storage.addReceiveRecord({
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    name: _mName,
    accounts: _mAccounts.slice(),
  });

  const n     = _mAccounts.length;
  const shown = UpiQr.fitName(_mName);
  setText('mq-name', shown || 'Merchant QR');
  setText('mq-sub',  n === 1 ? '1 account · standard UPI QR' : n + ' accounts · one QR');
  setText('mq-note', n === 1
    ? 'Add more accounts so customers using SplitPay can split their payment across them.'
    : 'Customers using SplitPay can split their payment across all ' + n +
      ' accounts. Any other UPI app pays only the primary account.');
  // ≥ version 13 (69+ modules): still valid, but fiddly to scan from a small/dim screen
  const dense = mat.n >= 69;
  toggleVis('mq-dense', dense);
  if (dense) setText('mq-dense',
    'This is a dense code. Scan it at full brightness, or use Share to print it larger. Fewer or shorter UPI IDs make a simpler code.');
  setText('mq-det-title', 'Accounts in this QR (' + n + ')');
  setHtml('mq-list', _mAccounts.map((v, i) => `
    <div class="macct sm${i === 0 ? ' pri' : ''}">
      <div class="macct-n">${i + 1}</div>
      <div class="macct-body"><div class="macct-upi">${esc(v)}</div></div>
      ${i === 0 ? '<div class="macct-tag inline">Primary</div>' : ''}
    </div>`).join(''));

  _mGo('m2');
  haptic('heavy');
}

function _mGo(screen) {
  _mScreen = screen;
  goTo(screen);
}

function merchantEdit() { haptic('light'); _mGo('m1'); }

/** Hardware-back handler (called from onAppBack in runner.js). */
function merchantBack() {
  if (_appMode === 'receive' && _mScreen === 'm2') { merchantEdit(); return true; }
  return false;
}

// ─── SHARE QR AS IMAGE ────────────────────────────────────────────

/** Print-ready poster: business name, big QR, one-line instruction. */
function _mPoster() {
  const W = 900, PAD = 64, QUIET = 4;
  const n   = _mAccounts.length;
  const mod = Math.floor((W - PAD * 2) / (_mMatrix.n + QUIET * 2));
  const qs  = mod * (_mMatrix.n + QUIET * 2);
  const titleY = PAD + 54, qrY = titleY + 36;
  const capY   = qrY + qs + 58;
  const H      = capY + (n > 1 ? 52 : 0) + PAD;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#191D25'; ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  // Title — shrink until it fits
  const title = UpiQr.fitName(_mName) || 'Scan to pay';
  ctx.fillStyle = '#191D25'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let px = 60;
  do { ctx.font = `700 ${px}px Georgia, "Noto Sans Devanagari", serif`; px -= 2; }
  while (ctx.measureText(title).width > W - PAD * 2 && px > 24);
  ctx.fillText(title, W / 2, titleY);

  // QR
  const tmp = document.createElement('canvas');
  _mPaintQr(tmp, _mMatrix, mod, QUIET);
  ctx.drawImage(tmp, (W - qs) / 2, qrY);

  // Captions
  ctx.font = '600 34px Georgia, serif';
  ctx.fillText('Scan with any UPI app', W / 2, capY);
  if (n > 1) {
    ctx.fillStyle = '#6A7384';
    ctx.font = '400 28px Georgia, serif';
    ctx.fillText('SplitPay users can split across ' + n + ' accounts', W / 2, capY + 46);
  }
  return cv;
}

function _mFileName() {
  const slug = (UpiQr.fitName(_mName) || 'merchant').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'merchant';
  return 'splitpay-qr-' + slug + '.png';
}

async function merchantShare() {
  if (!_mMatrix) return;
  haptic('light');
  let cv;
  try { cv = _mPoster(); } catch (e) { toast('Could not create image', true); return; }
  const name = _mFileName();
  const url  = cv.toDataURL('image/png');

  // 1 — Native share sheet (Android app). Falls through on older builds
  //     that predate shareImage().
  if (window.AndroidBridge && typeof window.AndroidBridge.shareImage === 'function') {
    try { window.AndroidBridge.shareImage(url.split(',')[1], name); return; } catch (e) { /* try next */ }
  }
  // 2 — Web Share API with a file (mobile browsers / PWA)
  try {
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: UpiQr.fitName(_mName) || 'Merchant QR' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;      // user closed the sheet
  }
  // 3 — Plain download (desktop browsers)
  if (window.AndroidBridge) { toast('Update the app to share QR images', true); return; }
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('QR image saved');
}

// ─── BOOT ─────────────────────────────────────────────────────────

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', merchantInit);
else merchantInit();
