package com.splitpay.app.webview

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.core.net.toUri
import com.splitpay.app.R

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
 * Opens a `upi://pay?...` deep link the SAFE way.
 *
 * FIX (fraud warning): this used to fire a bare implicit ACTION_VIEW —
 * which is exactly the pattern that makes Google Pay / PhonePe / Paytm /
 * BHIM show the red "possible fraud / third-party app" warning sheet.
 * All UPI launches now funnel through [UpiLauncher], which follows
 * Google's documented pattern: explicit package (when the user chose a
 * default UPI app in Settings) + startActivityForResult so the response
 * is awaited.
 *
 * Kept as a thin delegate so existing call-sites (SplitPayWebViewClient,
 * older JS) keep compiling and behave correctly.
 */
fun launchUpiIntent(activity: Activity, upiUrl: String) {
    UpiLauncher.launch(activity, upiUrl)
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
