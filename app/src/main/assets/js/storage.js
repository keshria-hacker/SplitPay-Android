/* ═══════════════════════════════════════════════════════════════════
   SplitPay — storage.js
   Thin localStorage wrapper with:
     • Namespaced keys  (prefix "sp_" — no collisions with other apps)
     • JSON encode/decode with silent error recovery
     • UPI history     (last 10, most-recent-first, with name)
     • User preferences (theme, turbo default, default split mode)
     • Payment stats   (count — used for rate-app nudge logic)
     • Pay history     (last 50 completed split-payment runs, for the
                        Dashboard's Pay tab)
     • Receive history (last 30 merchant-QR generations, for the
                        Dashboard's Receive tab)

   All accessors use property getters/setters so callsites read like:
     Storage.theme = 'dark';
     const upiList = Storage.upiHistory;

   Wrap every read in a try/catch because localStorage can throw in:
     - Private browsing / Incognito (on some Android WebViews)
     - When storage quota is exceeded
     - When the site is sandboxed without storage permission
   ═══════════════════════════════════════════════════════════════════ */

const Storage = (() => {
  const PFX  = 'sp_';
  const MAX_UPI_HISTORY  = 10;
  const MAX_AMOUNT_HISTORY = 5;
  const MAX_PAY_HISTORY = 50;
  const MAX_RECV_HISTORY = 30;

  // ─── Core primitives ──────────────────────────────────────────────

  function _get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PFX + key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function _set(key, value) {
    try { localStorage.setItem(PFX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function _del(key) {
    try { localStorage.removeItem(PFX + key); return true; }
    catch { return false; }
  }

  // ─── Theme ────────────────────────────────────────────────────────

  const _themeKey = 'theme';

  // ─── Turbo ────────────────────────────────────────────────────────

  const _turboKey = 'turbo';

  // ─── Default split mode ───────────────────────────────────────────

  const _modeKey = 'split_mode';

  // ─── UPI History  {upi, name, ts} ─────────────────────────────────

  const _histKey = 'upi_hist';

  function _getHistory() { return _get(_histKey, []); }

  // ─── Amount History  [number] ──────────────────────────────────────

  const _amtKey = 'amt_hist';

  // ─── Payment count ────────────────────────────────────────────────

  const _countKey = 'pay_count';

  // ─── Merchant profile  {name, accounts[]} ─────────────────────────

  const _merchantKey = 'merchant';

  // ─── Pay history  [{id, ts, upi, name, total, ...}]  ───────────────

  const _payHistKey = 'pay_hist';

  // ─── Receive history  [{id, ts, name, accounts[]}]  ────────────────

  const _recvHistKey = 'recv_hist';

  // ─── Public API ───────────────────────────────────────────────────

  return {

    // ── Theme ─────────────────────────────────────────────────────

    get theme() { return _get(_themeKey, 'system'); },
    set theme(v) { _set(_themeKey, v); EventBus.emit(EV.THEME_CHANGE, v); },

    // ── Turbo default ─────────────────────────────────────────────

    get turboDefault() { return _get(_turboKey, true); },
    set turboDefault(v) { _set(_turboKey, !!v); },

    // ── Split mode default ─────────────────────────────────────────

    get splitMode() { return _get(_modeKey, 'equal'); },
    set splitMode(v) { _set(_modeKey, v); },

    // ── UPI History ───────────────────────────────────────────────

    get upiHistory() { return _getHistory(); },

    /**
     * Prepend a UPI entry to the history (most-recent-first).
     * Deduplicates by UPI ID so the same ID is never stored twice.
     * Updates the name if the same ID is used with a different name.
     */
    addUpi(upi, name = '') {
      if (!upi || !upi.trim()) return;
      upi  = upi.trim();
      name = String(name || '').trim().slice(0, 80);

      let hist = _getHistory().filter(h => h.upi !== upi);
      hist.unshift({ upi, name, ts: Date.now() });
      if (hist.length > MAX_UPI_HISTORY) hist.length = MAX_UPI_HISTORY;
      _set(_histKey, hist);
    },

    /**
     * Remove one UPI entry (e.g. user long-pressed "delete").
     */
    removeUpi(upi) {
      _set(_histKey, _getHistory().filter(h => h.upi !== upi));
    },

    clearUpiHistory() { _del(_histKey); },

    // ── Amount History ────────────────────────────────────────────

    get amountHistory() { return _get(_amtKey, []); },

    /**
     * Most recent amount entered (0 if none yet).
     * screens.js's toStep2() reads this to pre-fill the amount field —
     * this getter was missing entirely, so that pre-fill silently never
     * fired (Storage.lastAmount was undefined, and undefined > 0 is
     * false, so the whole block was silently skipped every time).
     */
    get lastAmount() { const h = _get(_amtKey, []); return h.length ? h[0] : 0; },

    addAmount(amt) {
      const n = Math.floor(Number(amt) || 0);
      if (n <= 0) return;
      let hist = _get(_amtKey, []).filter(v => v !== n);
      hist.unshift(n);
      if (hist.length > MAX_AMOUNT_HISTORY) hist.length = MAX_AMOUNT_HISTORY;
      _set(_amtKey, hist);
    },

    // ── Payment stats ─────────────────────────────────────────────

    get paymentCount() { return _get(_countKey, 0); },

    incrementPaymentCount() {
      _set(_countKey, this.paymentCount + 1);
    },

    // ── Merchant profile (receive mode) ───────────────────────────

    /**
     * The merchant's saved business name + receiving UPI IDs.
     * Re-validated on read so a hand-edited / corrupted store can never
     * put an invalid ID or more than MAX_MERCHANT_UPIS accounts in a QR.
     */
    get merchant() {
      const raw = _get(_merchantKey, null);
      const name = raw && typeof raw.name === 'string' ? raw.name.slice(0, 50) : '';
      const list = raw && Array.isArray(raw.accounts) ? raw.accounts : [];
      return { name, accounts: UpiQr.cleanList(list) };
    },
    set merchant(v) {
      _set(_merchantKey, {
        name: String((v && v.name) || '').slice(0, 50),
        accounts: UpiQr.cleanList((v && v.accounts) || []),
      });
    },

    // ── Nuke everything ───────────────────────────────────────────

    clearAll() {
      [_themeKey, _turboKey, _modeKey, _histKey, _amtKey, _countKey, _merchantKey,
       _payHistKey, _recvHistKey]
        .forEach(_del);
    },

    // ── Pay history (Dashboard → Pay tab) ───────────────────────────

    /** Completed split-payment runs, most-recent-first. Read-only shape. */
    get payHistory() { return _get(_payHistKey, []); },

    /**
     * Log one finished payment run. Called once, from runner.js's
     * finish(), after a sequence (auto or manual) ends — whether every
     * part succeeded or not, so partial/failed runs still show up.
     * @param {object} rec  Pre-built record — see finish() for the shape.
     */
    addPayRecord(rec) {
      if (!rec) return;
      let hist = _get(_payHistKey, []);
      hist.unshift(rec);
      if (hist.length > MAX_PAY_HISTORY) hist.length = MAX_PAY_HISTORY;
      _set(_payHistKey, hist);
    },

    /** Remove one logged run (Dashboard's per-row delete button). */
    removePayRecord(id) {
      _set(_payHistKey, _get(_payHistKey, []).filter(r => r.id !== id));
    },

    clearPayHistory() { _del(_payHistKey); },

    // ── Receive history (Dashboard → Receive tab) ───────────────────

    /**
     * Merchant-QR generation events, most-recent-first.
     * This logs when a QR was *generated* on this device — the app has
     * no backend and can't know whether or when a payer actually pays
     * one of the accounts, so this is a QR-creation log, not proof of
     * money received.
     */
    get receiveHistory() { return _get(_recvHistKey, []); },

    addReceiveRecord(rec) {
      if (!rec) return;
      let hist = _get(_recvHistKey, []);
      hist.unshift(rec);
      if (hist.length > MAX_RECV_HISTORY) hist.length = MAX_RECV_HISTORY;
      _set(_recvHistKey, hist);
    },

    removeReceiveRecord(id) {
      _set(_recvHistKey, _get(_recvHistKey, []).filter(r => r.id !== id));
    },

    clearReceiveHistory() { _del(_recvHistKey); },
  };
})();
