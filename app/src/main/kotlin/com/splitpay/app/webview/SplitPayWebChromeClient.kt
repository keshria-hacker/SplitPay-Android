package com.splitpay.app.webview

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.core.content.ContextCompat
import com.splitpay.app.MainActivity
import com.splitpay.app.R
import com.splitpay.app.dialog.showAppDialog

/**
 * Chrome-side web integration: camera permission for getUserMedia, file
 * chooser for QR photo/gallery upload, and native replacements for the
 * browser alert/confirm/prompt dialogs (same pen & paper styling).
 *
 * Extracted from MainActivity; receives the activity so it can reach the
 * registered activity-result launchers and dialog helpers.
 */
class SplitPayWebChromeClient(private val activity: MainActivity) : WebChromeClient() {

    override fun onPermissionRequest(request: PermissionRequest) {
        val resources = request.resources
        val needsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources

        if (needsCamera) {
            when {
                ContextCompat.checkSelfPermission(
                    activity, Manifest.permission.CAMERA
                ) == PackageManager.PERMISSION_GRANTED -> {
                    // Already granted — let the page stream immediately.
                    request.grant(request.resources)
                }
                else -> {
                    // Stash the request; the launcher callback grants/denies it
                    // once the user answers the system permission dialog.
                    activity.webPermissionRequest = request
                    activity.cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }
        } else {
            request.deny()
        }
    }

    override fun onShowFileChooser(
        webView: WebView,
        callback: ValueCallback<Array<Uri>>,
        params: FileChooserParams
    ): Boolean {
        // Cancel any in-flight chooser first so callbacks never leak.
        activity.filePathCallback?.onReceiveValue(null)
        activity.filePathCallback = callback

        return try {
            val intent = params.createIntent()
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
            activity.fileChooserLauncher.launch(intent)
            true
        } catch (e: Exception) {
            // No file picker available — release the callback so the web layer
            // is not left waiting forever.
            activity.filePathCallback = null
            false
        }
    }

    override fun onJsConfirm(
        view: WebView,
        url: String,
        message: String,
        result: JsResult
    ): Boolean {
        showAppDialog(activity) {
            setTitle(activity.getString(R.string.app_name))
            setMessage(message)
            setIcon("question")
            setPositiveText(activity.getString(R.string.yes))
            setNegativeText(activity.getString(R.string.no))
            setCancelable(false)
            onPositive { result.confirm() }
            onNegative { result.cancel() }
            onCancelled { result.cancel() }
        }
        return true
    }

    override fun onJsPrompt(
        view: WebView,
        url: String,
        message: String,
        defaultValue: String?,
        result: JsPromptResult
    ): Boolean {
        showAppDialog(activity) {
            setTitle(activity.getString(R.string.app_name))
            setMessage(message)
            setIcon("info")
            setPositiveText("OK")
            setNegativeText("Cancel")
            setCancelable(false)
            showWithInput(activity.getString(R.string.input_hint_upi), defaultValue ?: "") { value ->
                if (value != null) result.confirm(value) else result.cancel()
            }
        }
        return true
    }

    override fun onJsAlert(
        view: WebView, url: String, message: String, result: JsResult
    ): Boolean {
        showAppDialog(activity) {
            setMessage(message)
            setIcon("info")
            setPositiveText(activity.getString(R.string.ok))
            setCancelable(false)
            onPositive { result.confirm() }
            onCancelled { result.cancel() }
        }
        return true
    }
}
