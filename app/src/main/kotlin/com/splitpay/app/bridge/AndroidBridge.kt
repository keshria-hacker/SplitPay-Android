package com.splitpay.app.bridge

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.splitpay.app.MainActivity
import com.splitpay.app.R
import com.splitpay.app.dialog.showAppDialog
import com.splitpay.app.model.AppEvent
import com.splitpay.app.util.AndroidStringEncoder
import com.splitpay.app.util.PreferenceManager
import com.splitpay.app.util.UpiAppCatalog
import com.splitpay.app.util.UpiLinkBuilder
import com.splitpay.app.util.callJs
import com.splitpay.app.util.runJs
import com.splitpay.app.util.isValidUpi
import com.splitpay.app.util.showShortToast
import com.splitpay.app.util.truncate
import com.splitpay.app.webview.UpiLauncher
import java.io.File

/**
 * JavaScript → Kotlin bridge, exposed as `window.AndroidBridge`.
 *
 * Architecture changes (v2):
 *   • Uses [UpiLinkBuilder] instead of raw string concatenation.
 *   • Uses [PreferenceManager] for all pref reads/writes.
 *   • Dispatches [AppEvent] sealed classes on significant actions
 *     so the rest of the Kotlin layer can react without parsing JS.
 *   • Uses [Extensions.kt] helpers (callJs, jsString, etc.) instead
 *     of duplicating those patterns here.
 *   • Input sanitisation is centralised in [sanitise].
 *
 * Threading: every @JavascriptInterface method is called on a WebView
 * background thread. All UI operations hop to the main thread via
 * [runOnUiThread]. Never hold a lock across the hop.
 */
class AndroidBridge(private val activity: MainActivity) {

    private val prefs get() = PreferenceManager.getInstance(activity)

    // ─── Clipboard ────────────────────────────────────────────────

    @JavascriptInterface
    fun getClipboardText(): String = try {
        (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .primaryClip?.getItemAt(0)
            ?.coerceToText(activity)
            ?.toString() ?: ""
    } catch (e: Exception) { "" }

    @JavascriptInterface
    fun copyToClipboard(text: String) {
        try {
            val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(
                ClipData.newPlainText(activity.getString(R.string.clipboard_label), text)
            )
        } catch (_: Exception) { /* web fallback handles it */ }
    }

    // ─── Share ────────────────────────────────────────────────────

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

    /**
     * Share a PNG through the system share sheet. Used by Receive mode to
     * send the merchant QR poster to WhatsApp, print apps, etc.
     *
     * The image is written to `cache/share/` — one of the two paths declared
     * in res/xml/file_paths.xml — and handed out via the app's FileProvider,
     * so no storage permission is needed and nothing is exposed beyond the
     * single shared file.
     *
     * @param base64Png raw base64 of the PNG (no `data:` prefix)
     * @param fileName  suggested name; sanitised here, never trusted
     */
    @JavascriptInterface
    fun shareImage(base64Png: String, fileName: String) {
        try {
            val bytes = Base64.decode(base64Png, Base64.DEFAULT)
            if (bytes.isEmpty() || bytes.size > MAX_SHARE_IMAGE_BYTES) {
                activity.runOnUiThread { activity.showShortToast(activity.getString(R.string.share_image_failed)) }
                return
            }
            val safeName = fileName
                .replace(Regex("[^A-Za-z0-9._-]"), "_")
                .take(60)
                .ifBlank { "splitpay-qr.png" }
                .let { if (it.endsWith(".png", ignoreCase = true)) it else "$it.png" }

            val dir  = File(activity.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, safeName).apply { writeBytes(bytes) }
            val uri  = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", file
            )

            activity.runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri("", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(
                    Intent.createChooser(send, activity.getString(R.string.share_image_chooser_title))
                )
            }
        } catch (_: Exception) {
            activity.runOnUiThread { activity.showShortToast(activity.getString(R.string.share_image_failed)) }
        }
    }

    // ─── UPI ──────────────────────────────────────────────────────

    /**
     * Build a validated UPI link and open it.
     * The web JS calls this instead of setting window.location so the
     * Kotlin side can log the attempt and handle "no UPI app" gracefully.
     *
     * @param upiId  VPA
     * @param amount Integer rupees as a string ("1500")
     * @param name   Payee display name
     * @param note   Transaction note
     * @param part   1-based part index (0 = not a split payment)
     * @param total  Total parts (0 = not a split payment)
     * @param ref    Ledger reference
     */
    @JavascriptInterface
    fun openUpiPayment(
        upiId:  String,
        amount: String,
        name:   String,
        note:   String,
        part:   Int,
        total:  Int,
        ref:    String,
    ) {
        activity.runOnUiThread {
            val amt = amount.toDoubleOrNull()
            if (amt == null || amt <= 0 || !upiId.isValidUpi()) {
                activity.showShortToast(activity.getString(R.string.invalid_upi_url))
                return@runOnUiThread
            }
            val link = UpiLinkBuilder()
                .payee(upiId, name)
                .amount(amt)
                .note(note, part, total)
                .ref(ref)
                .build()

            if (link != null) {
                UpiLauncher.launch(activity, link)
            } else {
                activity.showShortToast(activity.getString(R.string.invalid_upi_url))
            }
        }
    }

    /**
     * Preferred JS entry point for payments (the web runner calls this).
     * Builds the validated NPCI link natively and launches it through
     * [UpiLauncher] — explicit package when a default UPI app is set in
     * Settings, otherwise the system chooser — ALWAYS awaiting the
     * result (Google's documented anti-fraud pattern).
     */
    @JavascriptInterface
    fun payWithUpi(link: String) {
        activity.runOnUiThread {
            val pa = runCatching { android.net.Uri.parse(link) }
                .getOrNull()
                ?.takeIf { it.scheme == "upi" }
                ?.getQueryParameter("pa")
            if (pa == null || !pa.isValidUpi()) {
                activity.showShortToast(activity.getString(R.string.invalid_upi_url))
                return@runOnUiThread
            }
            UpiLauncher.launch(activity, link)
        }
    }

    // ─── UPI app settings (Settings screen bridge) ────────────────

    /**
     * JSON array of installed UPI apps for the Settings picker:
     * [{"packageName":"...","displayName":"..."}, …]
     */
    @JavascriptInterface
    fun getUpiApps(): String {
        val apps = UpiAppCatalog.installedApps(activity)
        val items = apps.joinToString(",") {
            "{" +
                "\"packageName\":" + jsString(it.packageName) + "," +
                "\"displayName\":" + jsString(it.displayName) +
                "}"
        }
        return "[$items]"
    }

    /** The saved default UPI app package, or UpiAppCatalog.UPI_APP_NONE ("ask every time"). */
    @JavascriptInterface
    fun getPreferredUpiApp(): String =
        UpiAppCatalog.preferredApp(activity).ifEmpty { UpiAppCatalog.UPI_APP_NONE }

    /** Save the default UPI app. Pass UpiAppCatalog.UPI_APP_NONE to go back to asking every time. */
    @JavascriptInterface
    fun setPreferredUpiApp(packageName: String) {
        val pkg = packageName.trim()
        if (pkg == UpiAppCatalog.UPI_APP_NONE) {
            UpiAppCatalog.setPreferredApp(activity, "")
        } else {
            UpiAppCatalog.setPreferredApp(activity, pkg)
        }
    }

    /**
     * Display name of the saved default UPI app ("Google Pay"), or ""
     * when unset — the runner uses this to label its pay button
     * ("Pay with Google Pay" vs the generic "Open UPI App").
     */
    @JavascriptInterface
    fun getPreferredUpiAppName(): String =
        UpiAppCatalog.resolvePreferred(activity)?.displayName.orEmpty()

    /**
     * Legacy: open a raw upi:// URL built by the web layer.
     * Not on the current live path (see README), but it's still a public
     * @JavascriptInterface method, so it's validated the same way
     * [openUpiPayment] is rather than trusting the scheme prefix alone —
     * a scheme check doesn't confirm `pa=` is a well-formed VPA, and this
     * is the last check before an [Intent.ACTION_VIEW] is launched.
     */
    @JavascriptInterface
    fun openUpiLink(upiUrl: String) {
        activity.runOnUiThread {
            val pa = runCatching { android.net.Uri.parse(upiUrl) }
                .getOrNull()
                ?.takeIf { it.scheme == "upi" }
                ?.getQueryParameter("pa")

            if (pa != null && pa.isValidUpi()) {
                UpiLauncher.launch(activity, upiUrl)
            } else {
                activity.showShortToast(activity.getString(R.string.invalid_upi_url))
            }
        }
    }

    @JavascriptInterface
    fun hasUpiApp(): Boolean {
        val intent = Intent(Intent.ACTION_VIEW,
            android.net.Uri.parse("upi://pay?pa=test@upi"))
        return activity.packageManager.resolveActivity(
            intent, PackageManager.MATCH_DEFAULT_ONLY) != null
    }

    // ─── Preferences (new in v2) ──────────────────────────────────

    /** Called when JS Storage.theme changes — syncs to SharedPreferences. */
    @JavascriptInterface
    fun setThemePref(theme: String) {
        val safe = when (theme) {
            "light", "dark", "system" -> theme
            else -> "system"
        }
        prefs.theme = safe
        activity.dispatchEvent(AppEvent.ThemeChanged(safe))
    }

    @JavascriptInterface
    fun getThemePref(): String = prefs.theme

    @JavascriptInterface
    fun setTurboPref(enabled: Boolean) { prefs.turboDefault = enabled }

    @JavascriptInterface
    fun getTurboPref(): Boolean = prefs.turboDefault

    // ─── Payment lifecycle events (new in v2) ─────────────────────

    /**
     * Called when the web layer starts a payment sequence.
     * Allows Kotlin to update the payment count pref and dispatch
     * the typed [AppEvent.PaymentStarted] to any interested observers.
     */
    @JavascriptInterface
    fun onPaymentStarted(total: Int, parts: Int, mode: String) {
        prefs.incrementPaymentCount()
        activity.dispatchEvent(AppEvent.PaymentStarted(total, parts, sanitise(mode)))
    }

    @JavascriptInterface
    fun onPartResult(index: Int, amount: Int, success: Boolean) {
        activity.dispatchEvent(AppEvent.PartResult(index, amount, success))
    }

    @JavascriptInterface
    fun onSequenceFinished(paidParts: Int, failedParts: Int, totalPaid: Int) {
        activity.dispatchEvent(AppEvent.SequenceFinished(paidParts, failedParts, totalPaid))
    }

    // ─── Camera ───────────────────────────────────────────────────

    @JavascriptInterface
    fun requestCameraPermission() {
        activity.runOnUiThread {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED
            ) {
                activity.cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }

    // ─── Toasts ───────────────────────────────────────────────────

    @JavascriptInterface
    fun nativeToast(message: String) {
        activity.runOnUiThread {
            activity.showShortToast(sanitise(message).truncate(80))
        }
    }

    // ─── Dialogs ──────────────────────────────────────────────────

    @JavascriptInterface
    fun showPopup(title: String, message: String, buttonText: String, icon: String) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    setTitle(if (title.isBlank()) "SplitPay" else "SplitPay: ${sanitise(title)}")
                    setMessage(sanitise(message))
                    setIcon(icon.takeIf { it in VALID_ICONS } ?: "info")
                    setPositiveText(buttonText.ifBlank { "OK" })
                }
            } catch (_: Exception) {
                activity.showShortToast(sanitise(message).truncate(80))
            }
        }
    }

    @JavascriptInterface
    fun showConfirmDialog(
        title: String, message: String,
        okText: String, cancelText: String, callbackId: String
    ) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    setTitle("SplitPay: ${sanitise(title).ifBlank { "Confirm" }}")
                    setMessage(sanitise(message))
                    setIcon("question")
                    setPositiveText(okText.ifBlank { "OK" })
                    setNegativeText(cancelText.ifBlank { "Cancel" })
                    onPositive  { activity.dispatchDialogResult(callbackId, true)  }
                    onNegative  { activity.dispatchDialogResult(callbackId, false) }
                    onCancelled { activity.dispatchDialogResult(callbackId, false) }
                }
            } catch (_: Exception) {
                activity.dispatchDialogResult(callbackId, false)
            }
        }
    }

    @JavascriptInterface
    fun showInputDialog(
        title: String, message: String, prefill: String, callbackId: String
    ) {
        activity.runOnUiThread {
            try {
                showAppDialog(activity) {
                    setTitle("SplitPay: ${sanitise(title).ifBlank { "Input" }}")
                    if (message.isNotBlank()) setMessage(sanitise(message))
                    setIcon("info")
                    setPositiveText("OK")
                    setNegativeText("Cancel")
                    showWithInput(
                        activity.getString(R.string.dialog_input_hint),
                        sanitise(prefill).truncate(200)
                    ) { value ->
                        // FIX: this payload is a pre-built JS object LITERAL (unquoted
                        // braces), not a content string. Passing it through callJs()
                        // would run it through jsString() a second time — wrapping the
                        // whole `{"id":...}` literal in an extra pair of quotes and
                        // escaping its internal quotes — so onAppDialogResult() would
                        // receive one big string instead of an object, id/value would
                        // never match up with the callback bridge.js registered, and
                        // every appPrompt() would silently time out after 30s instead
                        // of resolving with what the user typed. runJs() evaluates the
                        // literal as-is, with no re-encoding.
                        val payload = buildString {
                            append("{\"id\":")
                            append(jsString(callbackId))
                            append(",\"value\":")
                            append(jsString(value ?: ""))
                            append("}")
                        }
                        activity.binding.webView.runJs(
                            "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}"
                        )
                    }
                }
            } catch (_: Exception) {
                val payload = "{\"id\":${jsString(callbackId)},\"value\":\"\"}"
                activity.binding.webView.runJs(
                    "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}"
                )
            }
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────

    /** Strip null bytes and cap length to block oversized bridge payloads. */
    private fun sanitise(s: String, max: Int = 500): String =
        s.replace("\u0000", "").take(max)

    companion object {
        private val VALID_ICONS = setOf("info", "warn", "question", "exit", "upi", "rate")

        /** Upper bound for a shared QR image (a poster PNG is ~20–60 KB). */
        private const val MAX_SHARE_IMAGE_BYTES = 2 * 1024 * 1024

        /** Encode [s] as a JSON string literal. Public for use in MainActivity. */
        fun jsString(s: String): String = AndroidStringEncoder.jsString(s)
    }
}
