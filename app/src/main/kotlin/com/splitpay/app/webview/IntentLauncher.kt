package com.splitpay.app.webview

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.core.net.toUri
import com.splitpay.app.R
import com.splitpay.app.dialog.showAppDialog

/**
 * Small helpers for leaving the app: UPI payment intents, external URLs,
 * and toasts. Extracted from MainActivity so both the bridge and the
 * WebViewClient can share one implementation.
 */

/** Long toast from anywhere with an [Activity]. */
fun Activity.showToast(msg: String) {
    Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}

/**
 * Opens a `upi://pay?...` deep link in the user's installed UPI app.
 * If none resolves, an explanatory popup is shown instead.
 */
fun launchUpiIntent(activity: Activity, upiUrl: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW, upiUrl.toUri()).apply {
            // NEW_TASK: UPI apps live outside our task. SINGLE_TOP avoids
            // stacking duplicates when several parts are paid back-to-back.
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        if (intent.resolveActivity(activity.packageManager) != null) {
            activity.startActivity(intent)
        } else {
            showAppDialog(activity) {
                setTitle(activity.getString(R.string.no_upi_app_title))
                setMessage(activity.getString(R.string.no_upi_app_message))
                setIcon("upi")
                setPositiveText(activity.getString(R.string.ok))
            }
        }
    } catch (e: Exception) {
        activity.showToast(activity.getString(R.string.could_not_open_upi, e.message ?: ""))
    }
}

/** Opens an external https link (WhatsApp share, etc.) in the browser. */
fun launchExternalUrl(activity: Activity, url: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW, url.toUri()).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        activity.startActivity(intent)
    } catch (e: Exception) {
        activity.showToast(activity.getString(R.string.could_not_open_link))
    }
}
