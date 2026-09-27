package com.splitpay.app.model

/**
 * Sealed class hierarchy for every meaningful event in the app.
 *
 * Design rationale:
 *   Using sealed classes instead of string constants / arbitrary data maps
 *   gives compile-time exhaustive `when` checks, typed payloads, and
 *   autocomplete — no silent bugs from typos like "payment:compelete".
 *
 * Transport:
 *   Events flow from JS → Kotlin via [com.splitpay.app.bridge.AndroidBridge]
 *   methods. The bridge parses JSON arguments and emits the appropriate
 *   sealed subclass so the rest of the Kotlin layer is JSON-free.
 *
 * Future use:
 *   When the app grows (analytics, server sync, Wear OS companion),
 *   add new subclasses and exhaustive `when` branches will point out
 *   every handler that needs updating.
 */
sealed class AppEvent {

    // ── Navigation ──────────────────────────────────────────────────

    /** The web UI moved to a different screen. */
    data class Navigate(val step: String) : AppEvent()

    // ── Payment lifecycle ────────────────────────────────────────────

    /**
     * A payment sequence has been started.
     * [total]  sum of all parts in rupees
     * [parts]  number of installments
     * [mode]   "auto" | "manual"
     */
    data class PaymentStarted(
        val total:  Int,
        val parts:  Int,
        val mode:   String,
    ) : AppEvent()

    /**
     * One installment in the sequence has been resolved.
     * [index]   0-based part index
     * [amount]  rupees
     * [success] true = paid, false = failed / skipped
     */
    data class PartResult(
        val index:   Int,
        val amount:  Int,
        val success: Boolean,
    ) : AppEvent()

    /**
     * The whole sequence ended (success, partial, or fully failed).
     * [paidParts]   number of parts that were paid
     * [failedParts] number of parts that failed
     * [totalPaid]   sum of paid parts in rupees
     */
    data class SequenceFinished(
        val paidParts:   Int,
        val failedParts: Int,
        val totalPaid:   Int,
    ) : AppEvent()

    /** The sequence was cancelled by the user mid-flight. */
    object SequenceCancelled : AppEvent()

    // ── UPI / Scan ───────────────────────────────────────────────────

    /**
     * A UPI QR code was decoded successfully.
     * [upiId]   the VPA (virtual payment address)
     * [name]    payee name from QR metadata, null if absent
     * [amount]  pre-filled amount from QR, null if absent
     */
    data class UpiScanned(
        val upiId:  String,
        val name:   String?,
        val amount: String?,
    ) : AppEvent()

    // ── App lifecycle ────────────────────────────────────────────────

    /** The user chose a theme. [theme] is "light" | "dark" | "system". */
    data class ThemeChanged(val theme: String) : AppEvent()

    /** The app was fully reset to the initial state. */
    object Reset : AppEvent()

    /** The user pressed the hardware back button while running. */
    object BackPressed : AppEvent()

    // ── Error ────────────────────────────────────────────────────────

    /**
     * A recoverable error occurred inside the web layer.
     * [code]    machine-readable short code ("SPLIT_MISMATCH", etc.)
     * [message] human-readable description for logs
     */
    data class WebError(val code: String, val message: String) : AppEvent()
}
