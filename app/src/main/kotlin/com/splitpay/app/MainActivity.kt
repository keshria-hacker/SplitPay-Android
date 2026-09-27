package com.splitpay.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebSettings
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import com.splitpay.app.bridge.AndroidBridge
import com.splitpay.app.databinding.ActivityMainBinding
import com.splitpay.app.dialog.showAppDialog
import com.splitpay.app.dialog.showFallbackDialog
import com.splitpay.app.model.AppEvent
import com.splitpay.app.util.PreferenceManager
import com.splitpay.app.util.callJs
import com.splitpay.app.util.callJsDelayed
import com.splitpay.app.util.destroySafely
import com.splitpay.app.util.showShortToast
import com.splitpay.app.webview.SplitPayWebChromeClient
import com.splitpay.app.webview.SplitPayWebViewClient
import com.splitpay.app.webview.UpiLauncher

/**
 * Single-activity host for the SplitPay web app.
 *
 * Responsibilities (v2 — trimmed from 299 lines):
 *   1. Splash + edge-to-edge + window insets
 *   2. WebView configuration & asset loader
 *   3. Activity-result launchers (file chooser, camera permission)
 *   4. Hardware back routing (web first → exit confirm)
 *   5. [AppEvent] dispatcher — typed events from [AndroidBridge]
 *      forwarded to any future Kotlin observers (analytics, Wear, etc.)
 *
 * Everything else lives in its dedicated class:
 *   [AndroidBridge]          JS ↔ Kotlin surface
 *   [SplitPayWebViewClient]  error handling, renderer crashes
 *   [SplitPayWebChromeClient] file chooser, camera permission
 */
class MainActivity : AppCompatActivity() {

    internal lateinit var binding: ActivityMainBinding
    internal var filePathCallback: ValueCallback<Array<Uri>>? = null
    internal var webPermissionRequest: PermissionRequest? = null
    private  var exitDialog: Dialog? = null
    internal lateinit var assetLoader: WebViewAssetLoader

    private val prefs by lazy { PreferenceManager.getInstance(this) }

    companion object {
        private const val JS_CALL_DELAY_MS         = 600L
        private const val EXIT_SAFETY_NET_DELAY_MS = 500L
        internal val  rendererRestartTimestamps     = mutableListOf<Long>()
        internal const val RESTART_WINDOW_MS        = 10_000L
        internal const val MAX_RENDERER_RESTARTS    = 3
    }

    // ─── Activity-result launchers ───────────────────────────────

    internal val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        filePathCallback?.onReceiveValue(
            if (result.resultCode == Activity.RESULT_OK) {
                result.data?.let { data ->
                    when {
                        data.clipData != null ->
                            Array(data.clipData!!.itemCount) { i ->
                                data.clipData!!.getItemAt(i).uri
                            }
                        data.data != null -> arrayOf(data.data!!)
                        else              -> null
                    }
                }
            } else null
        )
        filePathCallback = null
    }

    internal val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            webPermissionRequest?.grant(webPermissionRequest!!.resources)
        } else {
            webPermissionRequest?.deny()
            showShortToast(getString(R.string.camera_denied))
        }
        webPermissionRequest = null
    }

    /**
     * Result pipe for UPI payment intents.
     *
     * FIX (fraud warning): the old flow used startActivity(), so the UPI
     * app saw an unawaited, implicit request and showed the red
     * "possible fraud" warning. Following Google's documented pattern,
     * every UPI launch now goes through this ActivityResultLauncher and
     * the response is forwarded to JS via onUpiResult():
     *   0 = success, 1 = failure, 2 = cancelled/no response, 3 = no app
     */
    internal val upiPaymentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        val response = data?.getStringExtra("response")
        val status = parseUpiStatus(response)
        val jsStatus = when (status) {
            "SUCCESS" -> UpiLauncher.RESULT_SUCCESS
            "FAILURE" -> UpiLauncher.RESULT_FAILED
            else      -> UpiLauncher.RESULT_CANCELLED
        }
        binding.webView.callJs("onUpiResult", jsStatus, response ?: "")
    }

    /**
     * Parse the `upi://` response string's status field. Format (NPCI):
     * "upi://pay?...&Status=SUCCESS&txnid=..." — case varies by app, so
     * the lookup is case-insensitive.
     */
    private fun parseUpiStatus(response: String?): String? {
        if (response.isNullOrBlank()) return null
        return response.split('&')
            .mapNotNull {
                val i = it.indexOf('=')
                if (i <= 0) null else it.substring(0, i).trim() to it.substring(i + 1).trim()
            }
            .firstOrNull { it.first.equals("Status", ignoreCase = true) }
            ?.second
            ?.uppercase()
    }

    /** Entry point used by [UpiLauncher] — routes the intent through the result pipe. */
    fun startUpiIntentForResult(intent: Intent) {
        upiPaymentLauncher.launch(intent)
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyWindowInsets()
        setupAssetLoader()
        setupWebView()
        setupBackHandler()
    }

    /**
     * With android:launchMode="singleTask" (see AndroidManifest.xml), a
     * "splitpay://" callback link opened while the app is already running
     * is delivered here instead of spawning a second Activity instance.
     * The web layer doesn't currently read any data from this deep link —
     * returning from a UPI app is detected purely through onResume()/
     * visibilitychange — so there is nothing to parse yet; this just makes
     * sure the intent lands on the one Activity instance rather than being
     * silently dropped or stacking a duplicate.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
        // Nudge the web page after returning from a UPI app.
        // visibilitychange fires in the web layer too, but some Android
        // versions skip it inside WebView — this is the reliable fallback.
        binding.webView.callJsDelayed(JS_CALL_DELAY_MS, "onVisReturn")
    }

    override fun onPause() {
        super.onPause()
        binding.webView.onPause()
    }

    override fun onDestroy() {
        exitDialog?.runCatching { dismiss() }
        exitDialog = null
        binding.webView.destroySafely()
        super.onDestroy()
    }

    // ─── Setup ───────────────────────────────────────────────────

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime  = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right,
                            maxOf(bars.bottom, ime.bottom))
            insets
        }
    }

    private fun setupAssetLoader() {
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() = with(binding.webView) {
        settings.apply {
            javaScriptEnabled               = true
            domStorageEnabled               = true
            allowFileAccess                 = false
            allowContentAccess              = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort                 = true
            loadWithOverviewMode            = true
            setSupportZoom(false)
            builtInZoomControls             = false
            displayZoomControls             = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // FIX: was LOAD_CACHE_ELSE_NETWORK, which prefers the cache and
            // only hits the network when a resource isn't cached. For a purely
            // local asset app that meant a stale page could linger in the
            // HTTP cache and keep being served even after an app update
            // replaced the bundled assets. LOAD_DEFAULT revalidates against
            // the (virtual) origin per normal HTTP semantics while still
            // serving from cache when appropriate.
            cacheMode        = WebSettings.LOAD_DEFAULT
            defaultTextEncodingName         = "UTF-8"
            // Remove "wv" UA tag so camera + clipboard behave like a real browser
            userAgentString = userAgentString.replace(Regex("(?i)wv\\s*"), "")
        }

        // Disable WebView algorithmic colour inversion; the CSS handles dark mode.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        addJavascriptInterface(AndroidBridge(this@MainActivity), "AndroidBridge")
        webViewClient  = SplitPayWebViewClient(this@MainActivity)
        webChromeClient = SplitPayWebChromeClient(this@MainActivity)

        loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    /** Hardware back: web layer gets first claim; fallback = exit confirm. */
    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {

            override fun handleOnBackPressed() {
                if (exitDialog?.isShowing == true) return

                var answered = false
                runCatching {
                    // Settings modal gets first claim; if it closed itself,
                    // the back press is consumed and we don't fall through
                    // to onAppBack() (which would re-close something else
                    // or pop the exit dialog).
                    binding.webView.evaluateJavascript(
                        "try{(typeof closeSettingsIfOpen==='function')?closeSettingsIfOpen():false}catch(e){false}"
                    ) { closedSettings ->
                        if (closedSettings == "true") {
                            answered = true
                            return@evaluateJavascript
                        }
                        binding.webView.evaluateJavascript(
                            "try{(typeof onAppBack==='function')?onAppBack():false}catch(e){false}"
                        ) { handled ->
                            answered = true
                            if (handled != "true" && exitDialog?.isShowing != true) showExitDialog()
                        }
                    }
                }.onFailure { showExitDialog(); return }

                // Safety net if the WebView never calls back
                binding.webView.postDelayed({
                    if (!answered && exitDialog?.isShowing != true
                        && !isFinishing && !isDestroyed) {
                        answered = true
                        showExitDialog()
                    }
                }, EXIT_SAFETY_NET_DELAY_MS)
            }

            private fun showExitDialog() {
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
                        onPositive  { finish() }
                        onNegative  { exitDialog = null }
                        onCancelled { exitDialog = null }
                    }
                } catch (_: Exception) {
                    exitDialog = null
                    showFallbackDialog(
                        this@MainActivity,
                        getString(R.string.exit_title),
                        getString(R.string.exit_message)
                    ) { finish() }
                }
            }
        })
    }

    // ─── Event bus (AppEvent → Kotlin observers) ─────────────────

    /**
     * Dispatch a typed [AppEvent] from [AndroidBridge] to any
     * registered Kotlin-layer observers.
     *
     * Currently a no-op routing stub — add observers here as the app
     * grows (analytics, Wear OS, crash reporting, etc.) without
     * touching [AndroidBridge] or [MainActivity.setupWebView].
     */
    internal fun dispatchEvent(event: AppEvent) {
        when (event) {
            is AppEvent.ThemeChanged     -> { /* future: update status bar tint */ }
            is AppEvent.PaymentStarted   -> { /* future: analytics ping */ }
            is AppEvent.PartResult       -> { /* future: per-part Wear notification */ }
            is AppEvent.SequenceFinished -> { /* future: summary notification */ }
            else -> { /* other events handled by JS layer */ }
        }
    }

    // ─── Exposed to extracted classes ────────────────────────────

    /**
     * Route a confirm/cancel dialog answer back to the web JS layer.
     *
     * FIX: this used to take [value] as a pre-built `"true"`/`"false"` String
     * and pass an *already jsString()-encoded* [callbackId] straight into
     * [callJs]. Since callJs quotes/escapes every non-Boolean, non-Number
     * argument itself, both arguments were encoded twice: the callback id
     * came out as a quoted string containing literal escaped quotes (so it
     * never matched the plain id bridge.js registered its callback under),
     * and the boolean came out as the quoted string `"true"`/`"false"`
     * rather than a real JS boolean — and bridge.js's `!!val` on a non-empty
     * string is `true` even for the literal string `"false"`. Net effect:
     * every native confirm dialog (Cancel Sequence, Skip Part, Clear
     * History, …) silently ignored the user's tap and only ever resolved
     * — via the 30s safety-net timer in bridge.js's appConfirm()/appPrompt()
     * — as a hard `false`/`null`.
     *
     * Passing the raw [callbackId] and a real [Boolean] here lets callJs's
     * own type-based serialisation encode each exactly once.
     */
    fun dispatchDialogResult(callbackId: String, value: Boolean) {
        binding.webView.callJs("onAppDialogResult", callbackId, value)
    }
}
