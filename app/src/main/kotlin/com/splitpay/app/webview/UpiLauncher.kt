package com.splitpay.app.webview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import com.splitpay.app.MainActivity
import com.splitpay.app.R
import com.splitpay.app.dialog.showAppDialog
import com.splitpay.app.util.UpiAppCatalog
import com.splitpay.app.util.showShortToast

/* ═══════════════════════════════════════════════════════════════════
   SplitPay — UpiLauncher.kt
   THE FRAUD-WARNING FIX, in one place.

   Google's official UPI integration guide (developers.google.com/pay/
   india/api/android/in-app-payments) requires exactly two things from
   an app that hands a payment to a UPI app:

     1. intent.setPackage(<upi app package>)  — an EXPLICIT intent
     2. startActivityForResult(...)           — AWAIT the response

   The old code violated both:
     • plain ACTION_VIEW with no package  → GPay/PhonePe/Paytm/BHIM
       show the red "possible fraud / third-party app" warning sheet
       before allowing payment;
     • startActivity()                    → the UPI app can't correlate
       the request with a genuine caller and SplitPay never learned
       whether the user completed, cancelled, or failed the payment.

   This launcher implements the documented pattern:
     • a preferred app chosen in Settings → explicit launch to that app
     • no preference                      → system chooser (still works
       with EVERY UPI app, installed or future) and the user's choice
       can be remembered
     • ALWAYS startActivityForResult so the response is awaited
   ═══════════════════════════════════════════════════════════════════ */

object UpiLauncher {

    /** Result codes forwarded to JS via onUpiResult(). */
    const val RESULT_SUCCESS  = 0   // UPI app reported success
    const val RESULT_FAILED   = 1   // UPI app reported failure
    const val RESULT_CANCELLED = 2  // user backed out / nothing returned
    const val RESULT_NO_APP   = 3   // no UPI app could be launched

    /**
     * Open a `upi://pay?...` link the documented way.
     */
    fun launch(activity: Activity, upiUrl: String) {
        val uri = Uri.parse(upiUrl)

        // ── Route 1: explicit launch to the user's preferred UPI app ──
        val preferred = UpiAppCatalog.resolvePreferred(activity)
        if (preferred != null) {
            val explicit = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage(preferred.packageName)
                // NEW_TASK: UPI apps live outside our task. SINGLE_TOP
                // avoids stacking duplicate activities when several parts
                // are paid back-to-back in a sequence.
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            if (tryStart(activity, explicit)) return
            // Preferred app exists but refused the intent → fall through
            // to the chooser rather than dead-ending the user.
        }

        // ── Route 2: chooser — works with ANY UPI app ever installed ──
        val chooser = Intent(Intent.ACTION_VIEW, uri).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        if (!tryStart(activity, chooser)) {
            showAppDialog(activity) {
                setTitle(activity.getString(R.string.no_upi_app_title))
                setMessage(activity.getString(R.string.no_upi_app_message))
                setIcon("upi")
                setPositiveText(activity.getString(R.string.ok))
            }
        }
    }

    /**
     * Start [intent] for a result and report "no handler" cleanly.
     * Every UPI launch in the app funnels through here so the
     * response is always awaited (Google's requirement #2).
     */
    private fun tryStart(activity: Activity, intent: Intent): Boolean =
        try {
            if (intent.resolveActivity(activity.packageManager) != null) {
                (activity as? MainActivity)?.startUpiIntentForResult(intent)
                    ?: activity.startActivityForResult(intent, REQUEST_UPI)
                true
            } else {
                false
            }
        } catch (e: ActivityNotFoundException) {
            activity.showShortToast(
                activity.getString(R.string.could_not_open_upi, e.message ?: "")
            )
            false
        } catch (e: Exception) {
            activity.showShortToast(
                activity.getString(R.string.could_not_open_upi, e.message ?: "")
            )
            false
        }

    /** Request code for the UPI payment intent. */
    const val REQUEST_UPI = 4711
}
