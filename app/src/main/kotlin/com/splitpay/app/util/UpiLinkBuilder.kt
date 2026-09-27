package com.splitpay.app.util

import android.net.Uri
import java.util.Locale

/* ═══════════════════════════════════════════════════════════════════
   SplitPay — UpiLinkBuilder.kt
   Builder pattern for `upi://pay` deep links.

   Pattern applied:
     • Builder: fluent setters + a single build() call.
     • Validation: build() returns null for invalid configs instead of
       throwing — caller can check for null without a try/catch.
     • Immutability: the built link is a val String, not mutated later.

   Before (scattered across bridge + JS):
     "upi://pay?pa=" + upi + "&am=" + amt + "&pn=" + ...

   After:
     UpiLinkBuilder()
       .payee(upiId, name)
       .amount(1500.0)
       .note("Invoice", part = 2, totalParts = 5)
       .ref("LGR4F2AP2")
       .build()   // → "upi://pay?pa=name@bank&am=1500.00&..."

   Spec: NPCI UPI Linking Specification v1.1 §4
   ═══════════════════════════════════════════════════════════════════ */

class UpiLinkBuilder {

    // ─── Parameters (backing fields) ──────────────────────────────

    private var pa: String  = ""      // Payee VPA      (required)
    private var pn: String  = ""      // Payee name     (optional)
    private var am: Double  = -1.0    // Amount ≥ 0     (required)
    private var cu: String  = "INR"   // Currency       (default INR)
    private var tn: String  = ""      // Transaction note
    private var tr: String  = ""      // Transaction reference

    // ─── Fluent setters ───────────────────────────────────────────

    /**
     * Set payee Virtual Payment Address.
     * @throws nothing — validation happens in [build].
     */
    fun payee(upiId: String, name: String = ""): UpiLinkBuilder = apply {
        pa = upiId.trim()
        pn = name.trim().take(50)    // NPCI spec caps pn at 50 chars
    }

    fun amount(rupees: Double): UpiLinkBuilder = apply { am = rupees }

    /** Convenience overload for integer amounts (most common usage). */
    fun amount(rupees: Int): UpiLinkBuilder = amount(rupees.toDouble())

    fun currency(code: String): UpiLinkBuilder = apply { cu = code.trim().take(3) }

    /**
     * Build the transaction note.
     * If [part] > 0, the note is formatted as "[note] P{part}/{totalParts}"
     * so the payee's statement shows which installment this is.
     */
    fun note(
        text: String,
        part: Int = 0,
        totalParts: Int = 0,
    ): UpiLinkBuilder = apply {
        tn = buildString {
            append(text.trim().take(40))   // NPCI tn field limit ~50 chars total
            if (part > 0) append(" P$part${if (totalParts > 0) "/$totalParts" else ""}")
        }
    }

    fun ref(reference: String): UpiLinkBuilder = apply {
        tr = reference.trim().take(50)
    }

    // ─── Build ────────────────────────────────────────────────────

    /**
     * Build the UPI deep link.
     *
     * @return  A `upi://pay?...` string ready for an [Intent.ACTION_VIEW],
     *          or **null** if required fields are missing or invalid.
     */
    fun build(): String? {
        if (pa.isEmpty())      return null   // VPA required
        if (!pa.isValidUpi())  return null   // basic format check
        if (am < 0)            return null   // amount required
        if (am > 100_000)      return null   // sanity cap — ₹1 lakh max per link

        return Uri.Builder()
            .scheme("upi")
            .authority("pay")
            .apply {
                appendQueryParameter("pa", pa)
                if (pn.isNotEmpty()) appendQueryParameter("pn", pn)
                // FIX: String.format() without a Locale uses the device default.
                // On comma-decimal locales (de, ru, hi-IN variants…) that emitted
                // "am=1500,00", which UPI apps parse as 0 or reject outright —
                // a money-corrupting bug. NPCI spec v1.1 §4 requires a dot
                // decimal, so pin the formatting to Locale.US.
                appendQueryParameter("am", String.format(Locale.US, "%.2f", am))
                appendQueryParameter("cu", cu)
                if (tn.isNotEmpty()) appendQueryParameter("tn", tn)
                if (tr.isNotEmpty()) appendQueryParameter("tr", tr)
            }
            .build()
            .toString()
    }

    /**
     * Build or throw [IllegalStateException] with a descriptive message.
     * Use only when you have pre-validated the inputs.
     */
    fun buildOrThrow(): String = build()
        ?: error("UpiLinkBuilder: invalid configuration — pa='$pa', am=$am")

    // ─── Companion factory ────────────────────────────────────────

    companion object {
        /**
         * Quick single-call builder for the most common case.
         */
        fun of(
            upiId: String,
            amount: Int,
            name: String = "",
            note: String = "",
            part: Int = 0,
            totalParts: Int = 0,
            ref: String = "",
        ): String? = UpiLinkBuilder()
            .payee(upiId, name)
            .amount(amount)
            .note(note, part, totalParts)
            .ref(ref)
            .build()
    }
}
