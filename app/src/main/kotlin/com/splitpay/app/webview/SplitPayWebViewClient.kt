package com.splitpay.app.webview

import android.content.Intent
import android.os.Build
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.splitpay.app.MainActivity
import com.splitpay.app.R

/**
 * Routes navigation out of the WebView and keeps local assets on the
 * virtual HTTPS origin. Also implements renderer-crash recovery.
 *
 * Extracted from MainActivity; receives the activity so it can launch
 * intents, show dialogs and trigger recreation.
 */
class SplitPayWebViewClient(private val activity: MainActivity) : WebViewClient() {

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        // WebViewAssetLoader serves /assets/* from appassets.androidplatform.net
        // (secure HTTPS origin so camera + clipboard web APIs work).
        return activity.assetLoader.shouldInterceptRequest(request.url)
            ?: super.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest
    ): Boolean {
        // With minSdk = 24 only the WebResourceRequest overload is ever called;
        // the deprecated String overload would be dead code.
        return handleUrl(request.url.toString())
    }

    /** One routing table for every URL class the app can encounter. */
    private fun handleUrl(url: String): Boolean {
        return when {
            // UPI payment deep link — open in any installed UPI app
            url.startsWith("upi://") -> {
                launchUpiIntent(activity, url)
                true
            }

            // Android Intent scheme (some UPI apps emit these)
            url.startsWith("intent://") -> {
                try {
                    val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                    if (intent.resolveActivity(activity.packageManager) != null) {
                        activity.startActivity(intent)
                    } else {
                        activity.showToast(activity.getString(R.string.app_not_found))
                    }
                } catch (e: Exception) {
                    // Ignore malformed intent URIs — never crash on a link.
                }
                true
            }

            // WhatsApp / external share links
            url.contains("wa.me") || url.contains("whatsapp.com") -> {
                launchExternalUrl(activity, url)
                true
            }

            // External HTTPS — open in the browser
            url.startsWith("https://") && !url.contains("appassets.androidplatform.net") -> {
                launchExternalUrl(activity, url)
                true
            }

            // Local app assets & anything else — let the WebView handle it
            else -> false
        }
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        // Only handle main-frame errors; sub-resource errors are noise here.
        if (request.isForMainFrame) {
            super.onReceivedError(view, request, error)
        }
    }

    /**
     * Renderer gone: clean up the dead WebView and restart the activity.
     *
     * Crash-loop guard: if the renderer dies repeatedly inside
     * [MainActivity.RESTART_WINDOW_MS], stop recreating and close the app
     * gracefully — otherwise a persistent WebView bug would loop forever.
     */
    override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail
    ): Boolean {
        try {
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        } catch (_: Exception) {
            // Best-effort cleanup; the renderer is already gone.
        }

        if (!activity.isFinishing && !activity.isDestroyed) {
            val now = System.currentTimeMillis()
            with(MainActivity.rendererRestartTimestamps) {
                removeAll { it < now - MainActivity.RESTART_WINDOW_MS }
                add(now)
                if (size > MainActivity.MAX_RENDERER_RESTARTS) {
                    clear()
                    activity.showToast(activity.getString(R.string.renderer_crash_loop))
                    activity.finish()
                    return true
                }
            }

            val rendererCrashed =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash()
            activity.showToast(
                activity.getString(
                    if (rendererCrashed) R.string.renderer_crashed else R.string.renderer_restarted
                )
            )
            activity.binding.root.post { activity.recreate() }
        }
        return true
    }
}
