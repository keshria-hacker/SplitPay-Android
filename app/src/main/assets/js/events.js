/* ═══════════════════════════════════════════════════════════════════
   SplitPay — events.js  (load FIRST after state.js)
   Tiny pub/sub EventBus. Every module communicates through events
   instead of calling each other's globals directly. This means:
     - modules have zero knowledge of each other
     - bridge.js, logger.js, and future features can hook any event
       without touching the originating module
     - tests can inject mock subscribers without mocking globals

   Usage:
     EventBus.on('payment:done', ({ paid, total }) => ...)
     EventBus.emit('payment:done', { paid: 3, total: 5000 })
     EventBus.once('split:ready', handler)   // fires once, then unsubscribes
     EventBus.off('payment:done', handler)   // manual cleanup
   ═══════════════════════════════════════════════════════════════════ */

const EventBus = (() => {
  const _subs = Object.create(null);

  /**
   * Subscribe to an event.
   * @returns  An unsubscribe function — call it to remove the listener.
   */
  function on(event, fn) {
    if (!_subs[event]) _subs[event] = [];
    _subs[event].push(fn);
    return () => off(event, fn);
  }

  /** Remove a specific listener. */
  function off(event, fn) {
    if (!_subs[event]) return;
    _subs[event] = _subs[event].filter(f => f !== fn);
  }

  /** Subscribe once — auto-removes after the first call. */
  function once(event, fn) {
    const wrapper = (...args) => { fn(...args); off(event, wrapper); };
    on(event, wrapper);
  }

  /**
   * Emit an event to all subscribers.
   * Exceptions inside handlers are caught and logged so one bad
   * handler cannot break the entire event chain.
   */
  function emit(event, payload) {
    if (!_subs[event]) return;
    // Snapshot to avoid mutation issues during iteration
    [..._subs[event]].forEach(fn => {
      try { fn(payload); }
      catch (e) { console.error('[EventBus] handler error on "' + event + '":', e); }
    });
  }

  /** Remove every listener for an event (useful on reset). */
  function clear(event) {
    if (event) { delete _subs[event]; }
    else       { Object.keys(_subs).forEach(k => delete _subs[k]); }
  }

  /** Development helper: list all active subscriptions. */
  function debug() {
    return Object.fromEntries(
      Object.entries(_subs).map(([k, v]) => [k, v.length])
    );
  }

  return { on, off, once, emit, clear, debug };
})();

/* ── Canonical event catalogue ──────────────────────────────────────
   Centralise event names as constants so typos cause immediate
   ReferenceErrors instead of silent listener misses.               */
const EV = Object.freeze({
  // Navigation
  NAV_GOTO:          'nav:goto',          // payload: step string  '1'|'2'|'3'|'4a'|'4b'|'5'
  MODAL_OPEN:        'modal:open',        // payload: modal element id
  MODAL_CLOSE:       'modal:close',       // payload: modal element id
  TOAST:             'toast:show',        // payload: { msg, err }

  // UPI / Scan
  UPI_SCANNED:       'upi:scanned',       // payload: { upi, name?, amount? }
  UPI_SELECTED:      'upi:selected',      // payload: { upi, name }

  // Plan
  SPLIT_READY:       'split:ready',       // payload: { splits[], total, mode }

  // Payment lifecycle
  PAY_START:         'payment:start',     // payload: { total, parts, mode }
  PAY_PART_DONE:     'payment:part-done', // payload: { idx, amount, success }
  PAY_COMPLETE:      'payment:complete',  // payload: { paid, failed, totalPaid }
  PAY_CANCEL:        'payment:cancel',    // payload: undefined

  // App
  THEME_CHANGE:      'theme:change',      // payload: 'light'|'dark'
  RESET:             'app:reset',         // payload: undefined
  BACK:              'app:back',          // payload: undefined
});
