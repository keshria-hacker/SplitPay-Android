package com.splitpay.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.PermissionRequest
import android.webkit.WebSettings
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import com.splitpay.app.bridge.AndroidBridge
import com.splitpay.app.databinding.ActivityMainBinding
import com.splitpay.app.dialog.showAppDialog
import com.splitpay.app.dialog.showFallbackDialog
import com.splitpay.app.webview.SplitPayWebChromeClient
import com.splitpay.app.webview.SplitPayWebViewClient
import com.splitpay.app.webview.showToast

/**
 * Single-activity composition root.
 *
 * Responsibilities kept here (everything else moved out):
 *  - splash screen + edge-to-edge + insets (keyboard & system bars)
 *  - WebView settings hardening and asset-loader wiring
 *  - activity-result launchers (file chooser, camera permission)
 *  - hardware back routing (web app first, then exit confirm)
 *
 * The web UI lives in assets/index.html and talks to native through
 * [AndroidBridge] (`window.AndroidBridge`) plus the JS callbacks
 * `onVisReturn()` / `onAppBack()` / `onAppDialogResult()`.
 */
class MainActivity : AppCompatActivity() {

    internal lateinit var binding: ActivityMainBinding
    internal var filePathCallback: ValueCallback<Array<Uri>>? = null
    internal var webPermissionRequest: PermissionRequest? = null
    private var exitDialog: Dialog? = null
    internal lateinit var assetLoader: WebViewAssetLoader

    companion object {
        /** Delay before nudging the web app after returning from a UPI app. */
        private const val WEBVIEW_JS_CALL_DELAY_MS = 600L

        /** Grace period for the web layer to answer a back-press claim. */
        private const val EXIT_DIALOG_SAFETY_NET_DELAY_MS = 500L

        // ── Renderer crash-loop guard (see SplitPayWebViewClient) ──
        internal val rendererRestartTimestamps = mutableListOf<Long>()
        internal const val RESTART_WINDOW_MS = 10_000L
        internal const val MAX_RENDERER_RESTARTS = 3
    }

    // ─── Activity Result Launchers ───────────────────────────────────────────

    /** Receives the file-chooser result (gallery/photo QR upload) and forwards it to JS. */
    internal val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val results: Array<Uri>? = if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            when {
                data?.clipData != null -> {
                    Array(data.clipData!!.itemCount) { i ->
                        data.clipData!!.getItemAt(i).uri
                    }
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else null
        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
    }

    /** Grants or denies the pending WebView camera permission request. */
    internal val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            webPermissionRequest?.grant(webPermissionRequest!!.resources)
        } else {
            webPermissionRequest?.deny()
            showToast(getString(R.string.camera_denied))
        }
        webPermissionRequest = null
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Must run before super.onCreate(): reads postSplashScreenTheme from
        // Theme.SplitPay.Splash and transitions to Theme.SplitPay — no
        // cold-start white flash on API 21–30, proper animated splash on 31+.
        installSplashScreen()

        super.onCreate(savedInstanceState)

        // Edge-to-edge display (works on all API 24+).
        WindowCompat.setDecorFitsSystemWindows(window, false)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // The web page is a fixed (non-scrolling) shell: pinned header on top,
        // pinned action dock at the bottom. Padding the WebView root keeps the
        // dock visible above the nav bar and above the soft keyboard (IME).
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                maxOf(systemBars.bottom, ime.bottom)
            )
            insets
        }

        setupAssetLoader()
        setupWebView()
        setupBackHandler()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
        // Notify the web page after returning from a UPI payment app. The HTML
        // also listens to visibilitychange, but some Android versions do not
        // fire it reliably inside WebView — this nudge is the fallback.
        binding.webView.postDelayed({
            binding.webView.evaluateJavascript(
                "if(typeof onVisReturn==='function'){onVisReturn();}", null
            )
        }, WEBVIEW_JS_CALL_DELAY_MS)
    }

    override fun onPause() {
        super.onPause()
        binding.webView.onPause()
    }

    override fun onDestroy() {
        exitDialog?.let { try { it.dismiss() } catch (e: Exception) {} }
        exitDialog = null
        binding.webView.apply {
            stopLoading()
            clearHistory()
            removeAllViews()
            destroy()
        }
        super.onDestroy()
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    private fun setupAssetLoader() {
        // WebViewAssetLoader serves local assets from a virtual HTTPS domain —
        // more secure than file:// and gives proper origins for camera/clipboard.
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val wv = binding.webView

        wv.settings.apply {
            javaScriptEnabled = true       // required for the app UI
            domStorageEnabled = true       // localStorage app state

            // File access not needed — assets come through the asset loader.
            allowFileAccess = false
            allowContentAccess = true

            // Camera stream should not require a user gesture first.
            mediaPlaybackRequiresUserGesture = false

            useWideViewPort = true
            loadWithOverviewMode = true

            // The app has its own layout; zoom controls are off.
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            // Fully offline app — mixed content is never allowed.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // Serve from cache; assets are bundled so this is always a hit.
            cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
            defaultTextEncodingName = "UTF-8"

            // Remove "wv" from the UA so web APIs (e.g. camera prompt) behave
            // as they would in a normal browser.
            userAgentString = userAgentString.replace(Regex("(?i)wv\\s*"), "")
        }

        // The web app handles dark mode via CSS prefers-color-scheme; disable
        // algorithmic darkening so the WebView does not re-process colors.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, false)
        }

        // Attach the JavaScript → Android bridge and the two clients.
        wv.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")
        wv.webViewClient = SplitPayWebViewClient(this)
        wv.webChromeClient = SplitPayWebChromeClient(this)

        wv.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    /** Back handling: the web app gets first claim, then the exit confirm. */
    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {

            /** Ask before exiting the app (single-page UI, no history). */
            fun showExitDialog() {
                try {
                    exitDialog = showAppDialog(
                        this@MainActivity,
                        onDismiss = { exitDialog = null }
                    ) {
                        setTitle(getString(R.string.exit_title))
                        setMessage(getString(R.string.exit_message))
                        setIcon("exit")
                        setPositiveText(getString(R.string.exit_yes))
                        setNegativeText(getString(R.string.exit_no))
                        setCancelable(true)
                        onPositive { finish() }
                        onNegative { exitDialog = null }
                        onCancelled { exitDialog = null }
                    }
                } catch (e: Exception) {
                    exitDialog = null
                    showFallbackDialog(
                        this@MainActivity,
                        getString(R.string.exit_title),
                        getString(R.string.exit_message)
                    ) { finish() }
                }
            }

            override fun handleOnBackPressed() {
                if (exitDialog?.isShowing == true) return

                // Give the web app first claim on back: while a payment
                // sequence runs it shows its own "Cancel sequence?" confirm.
                var answered = false
                try {
                    binding.webView.evaluateJavascript(
                        "try{(typeof onAppBack==='function')?onAppBack():false}catch(e){false}"
                    ) { handled ->
                        answered = true
                        if (handled == "true") return@evaluateJavascript
                        if (exitDialog?.isShowing == true) return@evaluateJavascript
                        showExitDialog()
                    }
                } catch (e: Exception) {
                    showExitDialog()
                    return
                }

                // Safety net: if the WebView never answers (renderer busy or
                // crashed), still show the popup.
                binding.webView.postDelayed({
                    if (!answered && exitDialog?.isShowing != true &&
                        !isFinishing && !isDestroyed
                    ) {
                        answered = true
                        showExitDialog()
                    }
                }, EXIT_DIALOG_SAFETY_NET_DELAY_MS)
            }
        })
    }

    // ─── Exposed to extracted classes (bridge / clients) ─────────────────────

    /** Routes a dialog answer back into the web layer. */
    fun dispatchDialogResult(callbackId: String, value: String) {
        binding.webView.evaluateJavascript(
            "if(typeof onAppDialogResult==='function'){onAppDialogResult(" +
                AndroidBridge.jsString(callbackId) + ",$value);}", null
        )
    }
}
