/* ═══════════════════════════════════════════════════════════════════
   SplitPay — statemachine.js
   Finite State Machine for the payment flow.

   Problem it solves:
     Without a FSM the app has IMPLICIT state scattered across S.running,
     S.awaiting, S.cur, and which screen is visible. This makes it easy
     to accidentally re-enter a running sequence, double-submit a part,
     or navigate backwards into an inconsistent UI.

   Solution:
     A strict transition table makes every state change explicit and
     auditable. Invalid transitions log a warning and return false —
     the caller does nothing rather than corrupting state.

   States:
     PAYEE  → the user is entering/scanning a UPI ID         (screen 1)
     AMOUNT → the user is entering the rupee amount          (screen 2)
     PLAN   → the user is choosing the split plan            (screen 3)
     AUTO   → auto-sequence is running                       (screen 4a)
     MANUAL → manual ledger is open                          (screen 4b)
     DONE   → the sequence finished (paid or partial)        (screen 5)

   Valid transitions (→ means "may transition to"):
     PAYEE  → AMOUNT
     AMOUNT → PAYEE | PLAN
     PLAN   → AMOUNT | AUTO | MANUAL
     AUTO   → PLAN (cancel) | DONE
     MANUAL → PLAN (cancel) | DONE
     DONE   → PAYEE (new payment / reset)
   ═══════════════════════════════════════════════════════════════════ */

const FSM = (() => {

  // ─── State constants ────────────────────────────────────────────

  const ST = Object.freeze({
    PAYEE:  'PAYEE',
    AMOUNT: 'AMOUNT',
    PLAN:   'PLAN',
    AUTO:   'AUTO',
    MANUAL: 'MANUAL',
    DONE:   'DONE',
  });

  // ─── Valid transitions ──────────────────────────────────────────

  const TRANSITIONS = Object.freeze({
    [ST.PAYEE]:  [ST.AMOUNT],
    [ST.AMOUNT]: [ST.PAYEE,  ST.PLAN],
    [ST.PLAN]:   [ST.AMOUNT, ST.AUTO, ST.MANUAL],
    [ST.AUTO]:   [ST.PLAN,   ST.DONE],
    [ST.MANUAL]: [ST.PLAN,   ST.DONE],
    [ST.DONE]:   [ST.PAYEE],
  });

  // ─── State → screen id mapping ──────────────────────────────────

  const SCREEN = Object.freeze({
    [ST.PAYEE]:  '1',
    [ST.AMOUNT]: '2',
    [ST.PLAN]:   '3',
    [ST.AUTO]:   '4a',
    [ST.MANUAL]: '4b',
    [ST.DONE]:   '5',
  });

  let _state = ST.PAYEE;

  // ─── Public API ─────────────────────────────────────────────────

  return {

    ST,

    /** Current state. */
    get state() { return _state; },

    /** The screen-id that should be active for the current state. */
    get screen() { return SCREEN[_state]; },

    /** True if a payment sequence is currently running. */
    get isRunning() { return _state === ST.AUTO || _state === ST.MANUAL; },

    /**
     * Can the FSM legally move to [next]?
     * @param {string} next  One of ST.*
     */
    can(next) {
      return (TRANSITIONS[_state] || []).includes(next);
    },

    /**
     * Attempt a transition to [next].
     * @returns {boolean} true if the transition happened.
     */
    go(next) {
      if (!this.can(next)) {
        console.warn(
          `[FSM] invalid: ${_state} → ${next}. Allowed: ${(TRANSITIONS[_state] || []).join(', ') || 'none'}`
        );
        return false;
      }
      const prev = _state;
      _state = next;
      EventBus.emit('fsm:transition', { from: prev, to: next, screen: SCREEN[next] });
      return true;
    },

    /**
     * Force-reset to PAYEE without transition guards.
     * Used by the global reset() — after a reset, the FSM must be clean
     * regardless of where it was.
     */
    reset() {
      _state = ST.PAYEE;
    },

    /** Human-readable status for debugging. */
    toString() { return `FSM[${_state}]`; },
  };
})();

// ── Wire FSM transitions to screen navigation ────────────────────
// When the FSM moves to a new state, goTo() is called automatically.
// This means callers do FSM.go(FSM.ST.AMOUNT) and the screen updates
// for free — no more goTo() calls scattered across modules.
EventBus.on('fsm:transition', ({ screen }) => {
  if (typeof goTo === 'function') goTo(screen);
});
