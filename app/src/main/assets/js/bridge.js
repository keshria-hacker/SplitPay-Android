/* ═══════════════════════════════════════════════════════════════════
   SplitPay — bridge.js
   Patches web functions with Android-native equivalents when running
   inside the native WebView (window.AndroidBridge present).
   Runs as an IIFE so it leaves no globals; loads after all modules.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function applyPatches() {
    if (!window.AndroidBridge) return; // running in browser/PWA — skip

    // ── 1. Clipboard paste via native API (bypasses gesture restriction) ──
    const _pasteWeb = window.pasteUPI;
    window.pasteUPI = async function () {
      haptic('light');
      let text = '';
      try { text = window.AndroidBridge.getClipboardText() || ''; } catch (e) {}
      if (!text) {
        try { text = await navigator.clipboard.readText(); } catch (e) {}
      }
      if (text && text.trim()) {
        text = text.trim();
        if (text.includes('pa=') || text.startsWith('upi://')) handleScan(text);
        else { document.getElementById('iupi').value = text; upiTab('type'); }
      } else if (_pasteWeb) {
        _pasteWeb();
      }
    };

    // ── 2. Native share sheet ──────────────────────────────────────────────
    const _shareWeb = window.shareWA;
    window.shareWA = function () {
      const txt = S.total > 0 ? buildReceiptText() : 'SplitPay — Smart UPI Installment Splitter';
      try { window.AndroidBridge.shareText(txt); }
      catch (e) { if (_shareWeb) _shareWeb(); }
    };

    // ── 3. Native clipboard write ─────────────────────────────────────────
    const _copyWeb = window.copyReceipt;
    window.copyReceipt = function () {
      const text   = buildReceiptText();
      let   copied = false;
      try {
        if (window.AndroidBridge.copyToClipboard) {
          window.AndroidBridge.copyToClipboard(text);
          toast('Record copied');
          copied = true;
        }
      } catch (e) {}
      if (!copied) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(() => toast('Record copied'))
            .catch(() => toast('Copy failed', true));
        } else if (_copyWeb) {
          _copyWeb();
        }
      }
    };

    // ── 4. UPI app detection ──────────────────────────────────────────────
    try { window.AndroidBridge.hasUpiApp(); } catch (e) {}

    // ── 4b. UPI transaction result (fraud-warning fix, part 2) ─────────
    //
    // MainActivity's upiPaymentLauncher invokes onUpiResult(status, raw)
    // when the UPI app returns:
    //   0 = SUCCESS, 1 = FAILURE, 2 = cancelled/no response, 3 = no app.
    //
    // A returned SUCCESS/Submitted response is not independent bank
    // verification, so it only opens the existing confirmation sheet.
    // The user must verify the transaction in the UPI app before marking
    // the part paid. Explicit FAILURE opens the QR fallback.
    window.onUpiResult = function (status, raw, attemptId) {
      try {
        if (!S.awaiting || !S.running ||
            (attemptId && S.activeAttemptId && attemptId !== S.activeAttemptId)) return;

        if (status === 0) {
          S.awaiting = false;
          const idx = S.mode === 'manual' && S.mPendingIdx >= 0 ? S.mPendingIdx : S.cur;
          S.paymentStatus[idx] = 'returned';
          if (S.mode === 'auto') {
            hide('a-cd'); hide('a-ts'); show('a-paybig');
            setTimeout(function () {
              showConfirmSheet(
                'Part ' + (S.cur + 1) + ' returned',
                'Verify the payment in your UPI app transaction history before marking it paid.',
                'auto'
              );
            }, 350);
          } else if (S.mPendingIdx >= 0) {
            setTimeout(function () {
              showConfirmSheet(
                'Part ' + (idx + 1) + ' returned',
                'Verify the payment in your UPI app transaction history before marking it paid.',
                'manual'
              );
            }, 350);
          }
          toast('Returned from UPI. Verify the payment before marking it paid.');
        } else if (status === 1) {
          // Some UPI apps, including Paytm for VPAs that do not allow
          // generic intent payments, reject the deep link after launch.
          // Offer the QR path for the same part instead of asking the user
          // to confirm a payment that the app explicitly failed.
          S.awaiting = false;
          const idx = S.mode === 'manual' && S.mPendingIdx >= 0 ? S.mPendingIdx : S.cur;
          S.paymentStatus[idx] = 'failed';
          clearInterval(S.cdTimer);
          toast('Direct UPI payment was rejected. Scan the QR instead.', true);
          if (S.mode === 'auto') {
            hide('a-cd'); hide('a-ts'); show('a-paybig');
          }
          if (typeof showManualQR === 'function' && S.mode === 'manual' && S.mPendingIdx >= 0) {
            setTimeout(function () {
              if (S.running) showManualQR(S.mPendingIdx);
            }, 350);
          } else if (typeof openCurQR === 'function') {
            setTimeout(function () {
              if (S.running) openCurQR();
            }, 350);
          }
        }
      } catch (e) {}
    };

    // ── 4c. Keep the runner pay button's app label fresh ────────────────
    // Settings can change the default UPI app while a sequence screen is
    // already visible; re-label the button so it never shows a stale name.
    // Guarded because settings.js may not be loaded in stripped builds.
    try {
      if (typeof window.refreshPayBtnLabel === 'function') window.refreshPayBtnLabel();
      const _origChoose = window.chooseUpiApp;
      if (typeof _origChoose === 'function') {
        window.chooseUpiApp = function (pkg, ev) {
          const r = _origChoose.apply(this, arguments);
          if (r && typeof r.then === 'function') r.then(function () { window.refreshPayBtnLabel(); });
          else window.refreshPayBtnLabel();
          return r;
        };
      }
    } catch (e) {}

    // ── 5. Native popup helpers ───────────────────────────────────────────
    // appPopup(title, msg, btn, icon) — info | warn | question | exit | upi | rate
    window.appPopup = function (title, msg, btn, icon) {
      try { window.AndroidBridge.showPopup(title || 'SplitPay', msg || '', btn || 'OK', icon || 'info'); }
      catch (e) {}
    };

    // appConfirm(title, msg, okText, cancelText) → Promise<boolean>
    window.appConfirm = function (title, msg, ok, cancel) {
      return new Promise(function (resolve) {
        if (!window.AndroidBridge || !window.AndroidBridge.showConfirmDialog) {
          resolve(confirm(msg || '')); return;
        }
        const cb = 'cb' + Date.now() + Math.floor(Math.random() * 1e6);
        let settled = false;
        window['onAppDialogResult_' + cb] = function (val) {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          resolve(!!val);
          delete window['onAppDialogResult_' + cb];
        };
        // Safety net: resolve false after 30s so buttons never freeze
        const guard = setTimeout(function () {
          const fn = window['onAppDialogResult_' + cb];
          if (fn) fn(false);
        }, 30000);
        window.AndroidBridge.showConfirmDialog(
          title || 'Confirm', msg || '', ok || 'Yes', cancel || 'No', cb
        );
      });
    };

    // appPrompt(title, msg, prefill) → Promise<string|null>
    window.appPrompt = function (title, msg, prefill) {
      return new Promise(function (resolve) {
        if (!window.AndroidBridge || !window.AndroidBridge.showInputDialog) {
          resolve(prompt(msg || '', prefill || '')); return;
        }
        const cb = 'cb' + Date.now() + Math.floor(Math.random() * 1e6);
        let settled = false;
        window['onAppDialogResult_' + cb] = function (val) {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          resolve(val ? String(val.value) : null);
          delete window['onAppDialogResult_' + cb];
        };
        const guard = setTimeout(function () {
          const fn = window['onAppDialogResult_' + cb];
          if (fn) fn(false);
        }, 30000);
        window.AndroidBridge.showInputDialog(
          title || 'SplitPay', msg || '', prefill || '', cb
        );
      });
    };

    // Global result dispatcher — called by MainActivity.dispatchDialogResult()
    // Confirm: onAppDialogResult(callbackId, true|false)
    // Input:   onAppDialogResult({ id: callbackId, value: '...' })
    window.onAppDialogResult = function (a, b) {
      let id, val;
      if (b === undefined && a && typeof a === 'object') { id = a.id; val = a; }
      else { id = a; val = b; }
      const fn = window['onAppDialogResult_' + id];
      if (fn) fn(typeof val === 'object' && val !== null ? val : !!val);
    };
  }

  // Apply once DOM is ready (AndroidBridge is injected before DOMContentLoaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPatches);
  } else {
    applyPatches();
  }
})();
