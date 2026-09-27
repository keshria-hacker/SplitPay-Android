/* ═══════════════════════════════════════════════════════════════════
   SplitPay — camera.js
   Camera access, QR scan loop, torch toggle, image upload decode.

   Scan loop uses setTimeout (not rAF) at ~8 fps to decode without
   burning CPU — keeps the UI at full frame-rate while the camera
   runs in the background.
   ═══════════════════════════════════════════════════════════════════ */

let _camStream  = null;
let _camRunning = false;
let _torchOn    = false;

/**
 * Who is the next decoded QR for?
 *   'payee'    — Pay flow: fill the payee fields (default)
 *   'merchant' — Receive flow: import UPI IDs into the merchant's list
 * Reset to 'payee' after every decode so a stale value can never
 * hijack a later scan.
 */
let _scanIntent = 'payee';

// ─── OPEN CAMERA ──────────────────────────────────────────────────

function openCam(intent) {
  haptic('medium');
  if (!window.isSecureContext) {
    toast('Camera requires HTTPS', true); return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Camera blocked. Use File Upload.', true); return;
  }
  // Only arm the intent once we know the camera will really open.
  _scanIntent = intent === 'merchant' ? 'merchant' : 'payee';
  setText('cam-hint', _scanIntent === 'merchant'
    ? 'Point camera at a UPI QR to add its ID'
    : 'Point camera at a UPI QR code');
  document.getElementById('cam-modal').classList.remove('hide');

  // Try progressively looser constraints until one succeeds
  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ];

  async function tryNext(idx) {
    if (idx >= attempts.length) { toast('Camera access denied', true); closeCam(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(attempts[idx]);
      _camStream  = stream;
      _camRunning = true;
      _torchOn    = false;
      const v = document.getElementById('scan-video');
      v.srcObject = stream;
      await v.play().catch(() => {});
      _setupTorch();
      setTimeout(scanFrame, 50);
    } catch (e) {
      tryNext(idx + 1);
    }
  }
  tryNext(0);
}

// ─── SCAN LOOP ────────────────────────────────────────────────────

function scanFrame() {
  if (!_camRunning) return;
  const modal = document.getElementById('cam-modal');
  if (modal.classList.contains('hide')) { setTimeout(scanFrame, 300); return; }

  const v = document.getElementById('scan-video');
  if (v.readyState < v.HAVE_ENOUGH_DATA) { setTimeout(scanFrame, 120); return; }

  const c     = document.getElementById('scan-canvas');
  const scale = Math.min(1, 480 / (v.videoWidth || 480));
  const w     = Math.max(1, Math.round((v.videoWidth  || 480) * scale));
  const h     = Math.max(1, Math.round((v.videoHeight || 360) * scale));
  c.width  = w;
  c.height = h;

  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);

  if (typeof jsQR !== 'undefined') {
    const code = jsQR(data.data, w, h);
    if (code && code.data) { haptic('heavy'); handleScan(code.data); return; }
  }
  setTimeout(scanFrame, 120);   // ~8 fps — easy on CPU/battery
}

// ─── CLOSE CAMERA ─────────────────────────────────────────────────

function closeCam() {
  _camRunning = false;
  _scanIntent = 'payee';           // closing without a scan must not leave a stale intent
  if (_camStream) {
    _camStream.getTracks().forEach(t => t.stop());
    _camStream = null;
  }
  _torchOn = false;
  const tb = document.getElementById('torch-btn');
  if (tb) tb.style.display = 'none';
  document.getElementById('cam-modal').classList.add('hide');
}

// ─── TORCH ────────────────────────────────────────────────────────

function toggleTorch() {
  if (!_camStream) return;
  _torchOn = !_torchOn;
  const track = _camStream.getVideoTracks()[0];
  if (track && typeof track.applyConstraints === 'function') {
    track.applyConstraints({ advanced: [{ torch: _torchOn }] }).catch(() => {});
  }
  const b = document.getElementById('torch-btn');
  if (b) b.classList.toggle('on', _torchOn);
}

function _setupTorch() {
  try {
    const track = _camStream && _camStream.getVideoTracks()[0];
    const caps  = track && track.getCapabilities ? track.getCapabilities() : null;
    const b     = document.getElementById('torch-btn');
    if (caps && caps.torch && b) b.style.display = 'flex';
  } catch (e) {}
}

// ─── IMAGE UPLOAD SCAN ────────────────────────────────────────────

function scanUpload(input, intent) {
  if (!input.files?.[0]) return;
  const want = intent === 'merchant' ? 'merchant' : 'payee';
  const file = input.files[0];
  input.value = '';                 // lets the same file be picked again later
  const reader = new FileReader();
  reader.onload = e => {
    const img   = new Image();
    img.onload  = () => {
      const c   = document.createElement('canvas');
      c.width   = img.width;
      c.height  = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d   = ctx.getImageData(0, 0, c.width, c.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(d.data, d.width, d.height);
        if (code?.data) { _scanIntent = want; handleScan(code.data); }
        else toast('No QR found in image', true);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── QR DATA HANDLER ──────────────────────────────────────────────

/**
 * Route a decoded QR payload (upi:// link, SplitPay merchant QR, or raw VPA).
 * Parsing lives in UpiQr.parse() (upiqr.js); this function only decides
 * where the result goes, based on _scanIntent.
 *
 * Pay flow:      a merchant QR with several accounts fills S.payees so the
 *                plan screen can spread parts across them.
 * Receive flow:  every account found is added to the merchant's list.
 */
function handleScan(data) {
  const intent = _scanIntent;      // read + reset BEFORE anything else can run
  _scanIntent  = 'payee';
  closeCam();
  if (!data?.trim()) return;

  try {
    const r = UpiQr.parse(data);
    if (!r) { toast('No UPI ID found', true); return; }

    if (intent === 'merchant') { merchantImportScan(r); return; }

    setValue('iupi', r.pa);
    if (r.pn) setValue('iname', r.pn.slice(0, 50));
    if (r.am && parseFloat(r.am) > 0) { setValue('iamt', r.am); syncChips(); }

    // Must be set BEFORE upiTab('type') — that call renders the multi-account note.
    S.payees = r.multi ? r.accounts.slice() : [];
    upiTab('type');
    toast(r.multi
      ? 'Merchant QR: ' + r.accounts.length + ' accounts'
      : 'QR scanned successfully');
    haptic('medium');
  } catch (e) {
    toast('Could not decode QR', true);
  }
}
