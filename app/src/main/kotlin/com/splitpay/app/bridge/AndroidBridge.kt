package com.splitpay.app.bridge

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

// The bridge is a facade over MainActivity's UI capabilities (dialogs, toasts,
// launchers, WebView evaluation). Keeping it in its own file isolates the exact
// @JavascriptInterface surface that ProGuard must keep (see proguard-rules.pro).
import com.splitpay.app.MainActivity
import com.splitpay.app.R
import com.splitpay.app.dialog.showAppDialog
import com.splitpay.app.webview.launchUpiIntent
import com.splitpay.app.webview.showToast

/**
 * JavaScript → Kotlin bridge, exposed to the web layer as `window.AndroidBridge`.
 *
 * Threading contract: every @JavascriptInterface method is called on a WebView
 * background thread, so anything that touches UI must hop via
 * [MainActivity.runOnUiThread]. All inputs are blank-guarded / length-capped
 * because they originate from the web layer.
 *
 * Supported calls (mirrored in README's bridge table):
 *  - getClipboardText()            read clipboard (bypasses gesture restriction)
 *  - copyToClipboard(text)         write clipboard on all API levels
 *  - shareText(text)               native share sheet
 *  - openUpiLink(upiUrl)           open a `upi://` intent
 *  - hasUpiApp()                   is any UPI app installed?
 *  - requestCameraPermission()     official camera permission flow
 *  - nativeToast(message)          Android toast (80-char cap)
 *  - showPopup(title, msg, btn, icon)
 *  - showConfirmDialog(...) / showInputDialog(...)
 *      → results are dispatched back to `onAppDialogResult(id, value)` in JS.
 */
class AndroidBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getClipboardText(): String {
        return try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.primaryClip?.getItemAt(0)
                ?.coerceToText(activity)
                ?.toString() ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    @JavascriptInterface
    fun shareText(text: String) {
        activity.runOnUiThread {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra(Intent.EXTRA_SUBJECT, activity.getString(R.string.share_subject))
            }
            activity.startActivity(
                Intent.createChooser(intent, activity.getString(R.string.share_chooser_title))
            )
        }
    }

    @JavascriptInterface
    fun openUpiLink(upiUrl: String) {
        activity.runOnUiThread {
            if (upiUrl.startsWith("upi://")) {
                launchUpiIntent(activity, upiUrl)
            } else {
                activity.showToast(activity.getString(R.string.invalid_upi_url))
            }
        }
    }

    @JavascriptInterface
    fun hasUpiApp(): Boolean {
        // The manifest's <queries> block (scheme "upi") keeps this working on
        // Android 11+ where package visibility is filtered by default.
        val intent = Intent(Intent.ACTION_VIEW, "upi://pay?pa=test@upi".toUri())
        return intent.resolveActivity(activity.packageManager) != null
    }

    @JavascriptInterface
    fun copyToClipboard(text: String) {
        try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = android.content.ClipData.newPlainText(
                activity.getString(R.string.clipboard_label), text
            )
            cm.setPrimaryClip(clip)
        } catch (e: Exception) {
            // Silently fail — the web clipboard API is the JS-side fallback.
        }
    }

    @JavascriptInterface
    fun requestCameraPermission() {
        activity.runOnUiThread {
            if (ContextCompat.checkSelfPermission(
                    activity, Manifest.permission.CAMERA
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                activity.cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }

    @JavascriptInterface
    fun nativeToast(message: String) {
        activity.runOnUiThread {
            // Cap length so a long web message cannot blow out the toast view.
            val preview = if (message.length > 80) message.take(80) + "…" else message
            activity.showToast(preview)
        }
    }

    @JavascriptInterface
    fun showPopup(title: String, message: String, buttonText: String, icon: String) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    val displayTitle = if (title.isBlank()) "SplitPay" else "SplitPay: $title"
                    setTitle(displayTitle)
                    setMessage(message)
                    setIcon(
                        when (icon) {
                            "info", "warn", "question", "exit", "upi", "rate" -> icon
                            else -> "info"
                        }
                    )
                    setPositiveText(if (buttonText.isBlank()) "OK" else buttonText)
                }
            } catch (e: Exception) {
                activity.showToast(if (message.isBlank()) title else message)
            }
        }
    }

    /**
     * Native replacement for JS `confirm()`. The answer is routed back to the
     * web layer through [MainActivity.dispatchDialogResult] using [callbackId].
     */
    @JavascriptInterface
    fun showConfirmDialog(
        title: String,
        message: String,
        okText: String,
        cancelText: String,
        callbackId: String
    ) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    setTitle(if (title.isBlank()) "SplitPay: Confirm" else "SplitPay: $title")
                    setMessage(message)
                    setIcon("question")
                    setPositiveText(if (okText.isBlank()) "OK" else okText)
                    setNegativeText(if (cancelText.isBlank()) "Cancel" else cancelText)
                    onPositive { activity.dispatchDialogResult(callbackId, "true") }
                    onNegative { activity.dispatchDialogResult(callbackId, "false") }
                    onCancelled { activity.dispatchDialogResult(callbackId, "false") }
                }
            } catch (e: Exception) {
                activity.dispatchDialogResult(callbackId, "false")
            }
        }
    }

    /**
     * Native replacement for JS `prompt()`. The entered text (or "" when the
     * dialog fails) is returned as a JSON payload so JS can distinguish the
     * callback id from the value.
     */
    @JavascriptInterface
    fun showInputDialog(
        title: String,
        message: String,
        prefill: String,
        callbackId: String
    ) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    setTitle(if (title.isBlank()) "SplitPay" else "SplitPay: $title")
                    if (message.isNotBlank()) setMessage(message)
                    setIcon("info")
                    setPositiveText("OK")
                    setNegativeText("Cancel")
                    showWithInput(activity.getString(R.string.dialog_input_hint), prefill) { value ->
                        val payload = "{\"id\":" + jsString(callbackId) +
                            ",\"value\":" + jsString(value ?: "") + "}"
                        activity.binding.webView.evaluateJavascript(
                            "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}", null
                        )
                    }
                }
            } catch (e: Exception) {
                val payload = "{\"id\":" + jsString(callbackId) +
                    ",\"value\":\"\"}"
                activity.binding.webView.evaluateJavascript(
                    "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}", null
                )
            }
        }
    }

    internal companion object {
        /** @return [s] encoded as a JSON string literal (backslash, quote, control chars). */
        internal fun jsString(s: String): String = buildString {
            append('"')
            for (c in s) when (c) {
                '\\'  -> append("\\\\")
                '"'   -> append("\\\"")
                '\n'  -> append("\\n")
                '\r'  -> append("\\r")
                '\t'  -> append("\\t")
                else  -> append(c)
            }
            append('"')
        }
    }
}
