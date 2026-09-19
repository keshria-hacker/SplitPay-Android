package com.splitpay.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toDrawable
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import com.splitpay.app.databinding.ActivityMainBinding
import com.splitpay.app.databinding.DialogCustomBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var webPermissionRequest: PermissionRequest? = null
    private var exitDialog: Dialog? = null
    private lateinit var assetLoader: WebViewAssetLoader

    // ─── Activity Result Launchers ───────────────────────────────────────────

    private val fileChooserLauncher = registerForActivityResult(
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

    private val cameraPermissionLauncher = registerForActivityResult(
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
        // FIX: installSplashScreen() MUST be called before super.onCreate().
        // It reads postSplashScreenTheme from Theme.SplitPay.Splash and
        // automatically transitions to Theme.SplitPay — eliminating the
        // cold-start white flash on API 21–30 and providing the proper
        // animated icon splash on API 31+.
        installSplashScreen()

        super.onCreate(savedInstanceState)

        // Edge-to-edge display (works on all API 24+)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Apply window insets so the WebView respects system bars and the keyboard.
        // The web page is a fixed (non-scrolling) shell: pinned header on top,
        // pinned action dock at the bottom. Padding the WebView root keeps that
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
        // Notify the web page after returning from UPI payment app.
        // The HTML already listens to visibilitychange, but some Android versions
        // don't fire it reliably in WebView. This is a reliable fallback.
        binding.webView.postDelayed({
            binding.webView.evaluateJavascript(
                "if(typeof onVisReturn==='function'){onVisReturn();}", null
            )
        }, 600)
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
        // WebViewAssetLoader serves local assets from a virtual HTTPS domain.
        // This is more secure than file:// and gives proper security origins
        // for camera API, clipboard API, etc.
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler(
                "/assets/",
                WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val wv = binding.webView

        wv.settings.apply {
            // JavaScript — required for the app
            javaScriptEnabled = true

            // DOM Storage — for app state persistence
            domStorageEnabled = true

            // File access from assets — not needed; using AssetLoader
            allowFileAccess = false
            allowContentAccess = true

            // Media — allow camera without requiring user gesture first
            mediaPlaybackRequiresUserGesture = false

            // FIX: databaseEnabled is deprecated (API 26+) and covers Web SQL,
            // which is unspecified/unsupported in most modern WebViews. The app
            // uses DOM Storage (localStorage), handled by domStorageEnabled above.
            // Left here commented out; remove on next major refactor if no issues.
            // @Suppress("DEPRECATION")
            // databaseEnabled = true

            // Viewport
            useWideViewPort = true
            loadWithOverviewMode = true

            // Zoom controls off (app has its own layout)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            // No mixed content — app is fully offline; extra safety net
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // Cache — serve assets from cache; fall back to network only if needed
            cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK

            // Text encoding
            defaultTextEncodingName = "UTF-8"

            // Remove "wv" from UA so CDN APIs respond better (e.g. camera prompt)
            userAgentString = userAgentString.replace(
                Regex("(?i)wv\\s*"), ""
            )
        }

        // Let the web app handle dark mode via CSS prefers-color-scheme;
        // disable algorithmic darkening so the WebView doesn't re-process colors.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, false)
        }

        // Attach JavaScript → Android bridge
        wv.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        wv.webViewClient = SplitPayWebViewClient()
        wv.webChromeClient = SplitPayWebChromeClient()

        // Load the app from the virtual HTTPS domain
        wv.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {

            /** Single-page UI: there is no real in-app history to traverse,
             *  so back always asks before exiting the app. */
            fun showExitDialog() {
                try {
                    exitDialog = showAppDialog(this@MainActivity) {
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
                        getString(R.string.exit_title),
                        getString(R.string.exit_message)
                    ) { finish() }
                }
            }

            override fun handleOnBackPressed() {
                if (exitDialog?.isShowing == true) return

                // Give the web app first claim on back: while a payment
                // sequence is running it shows its own "Cancel sequence?"
                // confirm instead of exiting.
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

                // Safety net: if the WebView never answers (renderer busy/crashed,
                // page failed to load), still show the popup.
                binding.webView.postDelayed({
                    if (!answered && exitDialog?.isShowing != true &&
                        !isFinishing && !isDestroyed
                    ) {
                        answered = true
                        showExitDialog()
                    }
                }, 500)
            }
        })
    }

    // ─── Custom Popup (SplitPay pen & paper style) ───────────────────────────

    inner class AppDialogBuilder(context: Context) {

        private val appContext = context
        private var title: String? = null
        private var message: String? = null
        private var iconRes: Int? = null
        private var positiveText: String? = null
        private var negativeText: String? = null
        private var positiveAction: (() -> Unit)? = null
        private var negativeAction: (() -> Unit)? = null
        private var cancelledAction: (() -> Unit)? = null
        private var cancelable = true
        private var inputHint: String? = null
        private var inputPrefill: String? = null
        private var inputResult: ((String?) -> Unit)? = null

        fun setTitle(t: String) = apply { title = t }
        fun setMessage(m: String) = apply { message = m }
        fun setIcon(name: String) = apply { iconRes = iconFor(name) }
        fun setPositiveText(t: String) = apply { positiveText = t }
        fun setNegativeText(t: String) = apply { negativeText = t }
        fun setCancelable(c: Boolean) = apply { cancelable = c }
        fun onPositive(action: () -> Unit) = apply { positiveAction = action }
        fun onNegative(action: () -> Unit) = apply { negativeAction = action }
        fun onCancelled(action: () -> Unit) = apply { cancelledAction = action }

        fun showWithInput(hint: String, prefill: String, result: (String?) -> Unit) =
            apply {
                inputHint = hint
                inputPrefill = prefill
                inputResult = result
            }

        fun show(): Dialog {
            val dlgBinding = DialogCustomBinding.inflate(LayoutInflater.from(appContext))

            if (title.isNullOrBlank()) {
                dlgBinding.dlgTitle.visibility = View.GONE
            } else {
                dlgBinding.dlgTitle.visibility = View.VISIBLE
                dlgBinding.dlgTitle.text = title
            }

            if (iconRes == null) {
                dlgBinding.dlgIconBadge.visibility = View.GONE
            } else {
                dlgBinding.dlgIconBadge.visibility = View.VISIBLE
                dlgBinding.dlgIcon.setImageResource(iconRes!!)
                dlgBinding.dlgIcon.setColorFilter(
                    ContextCompat.getColor(appContext, R.color.background)
                )
            }

            if (message.isNullOrBlank()) {
                dlgBinding.dlgMessage.visibility = View.GONE
            } else {
                dlgBinding.dlgMessage.visibility = View.VISIBLE
                dlgBinding.dlgMessage.text = message
            }

            val hasInput = inputResult != null
            if (hasInput) {
                dlgBinding.dlgInput.visibility = View.VISIBLE
                dlgBinding.dlgInput.hint = inputHint
                dlgBinding.dlgInput.setText(inputPrefill ?: "")
            }

            if (negativeText.isNullOrBlank()) {
                dlgBinding.dlgNegative.visibility = View.GONE
                (dlgBinding.dlgPositive.layoutParams as? android.widget.LinearLayout.LayoutParams)
                    ?.marginStart = 0
            } else {
                dlgBinding.dlgNegative.visibility = View.VISIBLE
                dlgBinding.dlgNegative.text = negativeText
            }
            if (positiveText.isNullOrBlank()) {
                dlgBinding.dlgPositive.visibility = View.GONE
                (dlgBinding.dlgNegative.layoutParams as? android.widget.LinearLayout.LayoutParams)
                    ?.marginEnd = 0
            } else {
                dlgBinding.dlgPositive.visibility = View.VISIBLE
                dlgBinding.dlgPositive.text = positiveText
            }

            if (iconRes == null) {
                (dlgBinding.dlgTitle.layoutParams as? android.widget.LinearLayout.LayoutParams)
                    ?.marginStart = 0
            }

            var answered = false

            val dialog = Dialog(appContext)
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
            dialog.setCanceledOnTouchOutside(cancelable)
            dialog.setCancelable(cancelable)
            dialog.setOnCancelListener {
                if (!answered) {
                    if (hasInput) inputResult?.invoke(null)
                    cancelledAction?.invoke()
                }
            }
            dialog.setOnDismissListener { exitDialog = null }
            dialog.setContentView(dlgBinding.root)
            dialog.show()
            dialog.window?.let { win ->
                win.setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
                win.setGravity(Gravity.CENTER)
                val maxPx = (420 * appContext.resources.displayMetrics.density).toInt()
                val wPx = (appContext.resources.displayMetrics.widthPixels * 0.88f).toInt()
                win.setLayout(
                    minOf(wPx, maxPx),
                    WindowManager.LayoutParams.WRAP_CONTENT
                )
            }

            dlgBinding.dlgPositive.setOnClickListener {
                answered = true
                if (hasInput) inputResult?.invoke(dlgBinding.dlgInput.text.toString())
                positiveAction?.invoke()
                dialog.dismiss()
            }
            dlgBinding.dlgNegative.setOnClickListener {
                answered = true
                if (hasInput) inputResult?.invoke(null)
                negativeAction?.invoke()
                dialog.dismiss()
            }

            if (hasInput) {
                dlgBinding.dlgInput.requestFocus()
                dialog.window?.setSoftInputMode(
                    WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
                )
                dialog.setOnDismissListener {
                    exitDialog = null
                    dialog.window?.setSoftInputMode(
                        WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED
                    )
                }
            }

            return dialog
        }

        private fun iconFor(name: String): Int? = when (name.lowercase().trim()) {
            "exit", "logout", "power"      -> android.R.drawable.ic_menu_close_clear_cancel
            "warn", "warning", "error"     -> android.R.drawable.ic_dialog_alert
            "question", "confirm", "help"  -> android.R.drawable.ic_menu_help
            "info", "about"                -> android.R.drawable.ic_dialog_info
            "upi", "pay", "money", "card"  -> android.R.drawable.ic_menu_manage
            "rate", "star"                 -> android.R.drawable.btn_star_big_on
            else                           -> android.R.drawable.ic_dialog_info
        }
    }

    private fun showAppDialog(context: Context, configure: AppDialogBuilder.() -> Unit): Dialog =
        AppDialogBuilder(context).apply(configure).show()

    private fun showFallbackDialog(title: String, message: String, onYes: () -> Unit) {
        try {
            AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(getString(R.string.yes)) { _, _ -> onYes() }
                .setNegativeButton(getString(R.string.no), null)
                .setCancelable(true)
                .show()
        } catch (e: Exception) {
            showToast("$title — $message")
        }
    }

    // ─── JavaScript → Android Bridge ─────────────────────────────────────────

    inner class AndroidBridge {

        @JavascriptInterface
        fun getClipboardText(): String {
            return try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.primaryClip?.getItemAt(0)
                    ?.coerceToText(this@MainActivity)
                    ?.toString() ?: ""
            } catch (e: Exception) {
                ""
            }
        }

        @JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                    putExtra(Intent.EXTRA_SUBJECT, "SplitPay Ledger")
                }
                startActivity(Intent.createChooser(intent, "Share receipt via"))
            }
        }

        @JavascriptInterface
        fun openUpiLink(upiUrl: String) {
            runOnUiThread {
                launchUpiIntent(upiUrl)
            }
        }

        @JavascriptInterface
        fun hasUpiApp(): Boolean {
            val intent = Intent(Intent.ACTION_VIEW, "upi://pay?pa=test@upi".toUri())
            return intent.resolveActivity(packageManager) != null
        }

        @JavascriptInterface
        fun copyToClipboard(text: String) {
            try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = android.content.ClipData.newPlainText("SplitPay Receipt", text)
                cm.setPrimaryClip(clip)
            } catch (e: Exception) {
                // Silently fail — web clipboard API handles it as fallback
            }
        }

        @JavascriptInterface
        fun requestCameraPermission() {
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.CAMERA
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                }
            }
        }

        @JavascriptInterface
        fun nativeToast(message: String) {
            runOnUiThread {
                val preview = if (message.length > 80) message.take(80) + "…" else message
                showToast(preview)
            }
        }

        @JavascriptInterface
        fun showPopup(title: String, message: String, buttonText: String, icon: String) {
            runOnUiThread {
                try {
                    showAppDialog(this@MainActivity) {
                        setTitle(if (title.isBlank()) "SplitPay" else title)
                        setMessage(message)
                        setIcon(icon)
                        setPositiveText(if (buttonText.isBlank()) "OK" else buttonText)
                    }
                } catch (e: Exception) {
                    showToast(if (message.isBlank()) title else message)
                }
            }
        }

        @JavascriptInterface
        fun showConfirmDialog(
            title: String,
            message: String,
            okText: String,
            cancelText: String,
            callbackId: String
        ) {
            runOnUiThread {
                try {
                    showAppDialog(this@MainActivity) {
                        setTitle(if (title.isBlank()) "Confirm" else title)
                        setMessage(message)
                        setIcon("question")
                        setPositiveText(if (okText.isBlank()) "OK" else okText)
                        setNegativeText(if (cancelText.isBlank()) "Cancel" else cancelText)
                        onPositive { dispatchDialogResult(callbackId, "true") }
                        onNegative { dispatchDialogResult(callbackId, "false") }
                        onCancelled { dispatchDialogResult(callbackId, "false") }
                    }
                } catch (e: Exception) {
                    dispatchDialogResult(callbackId, "false")
                }
            }
        }

        @JavascriptInterface
        fun showInputDialog(
            title: String,
            message: String,
            prefill: String,
            callbackId: String
        ) {
            runOnUiThread {
                try {
                    showAppDialog(this@MainActivity) {
                        setTitle(if (title.isBlank()) "SplitPay" else title)
                        if (message.isNotBlank()) setMessage(message)
                        setIcon("info")
                        setPositiveText("OK")
                        setNegativeText("Cancel")
                        showWithInput("Enter here", prefill) { value ->
                            val payload = "{\"id\":" + jsString(callbackId) +
                                ",\"value\":" + jsString(value ?: "") + "}"
                            binding.webView.evaluateJavascript(
                                "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}", null
                            )
                        }
                    }
                } catch (e: Exception) {
                    val payload = "{\"id\":" + jsString(callbackId) +
                        ",\"value\":\"\"}"
                    binding.webView.evaluateJavascript(
                        "if(typeof onAppDialogResult==='function'){onAppDialogResult($payload);}", null
                    )
                }
            }
        }
    }

    private fun dispatchDialogResult(callbackId: String, value: String) {
        binding.webView.evaluateJavascript(
            "if(typeof onAppDialogResult==='function'){onAppDialogResult(" +
                jsString(callbackId) + ",$value);}", null
        )
    }

    private fun jsString(s: String): String = buildString {
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

    // ─── WebViewClient ────────────────────────────────────────────────────────

    inner class SplitPayWebViewClient : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? {
            return assetLoader.shouldInterceptRequest(request.url)
                ?: super.shouldInterceptRequest(view, request)
        }

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            // FIX: Removed the deprecated shouldOverrideUrlLoading(WebView, String)
            // overload. With minSdk = 24, Android guarantees that only the
            // WebResourceRequest version is called — the String overload is
            // unreachable and its presence was dead code.
            return handleUrl(request.url.toString())
        }

        private fun handleUrl(url: String): Boolean {
            return when {
                // UPI payment deep link — open in any installed UPI app
                url.startsWith("upi://") -> {
                    launchUpiIntent(url)
                    true
                }

                // Android Intent scheme (some UPI apps use this)
                url.startsWith("intent://") -> {
                    try {
                        val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        if (intent.resolveActivity(packageManager) != null) {
                            startActivity(intent)
                        } else {
                            showToast("Required app not found")
                        }
                    } catch (e: Exception) {
                        // Ignore malformed intents
                    }
                    true
                }

                // WhatsApp / external share links
                url.contains("wa.me") || url.contains("whatsapp.com") -> {
                    launchExternalUrl(url)
                    true
                }

                // External HTTPS — open in browser
                url.startsWith("https://") && !url.contains("appassets.androidplatform.net") -> {
                    launchExternalUrl(url)
                    true
                }

                // Local app assets — let WebView handle it
                url.contains("appassets.androidplatform.net") -> false

                // Everything else — let WebView handle
                else -> false
            }
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            // Only handle main-frame errors; ignore sub-resource errors
            if (request.isForMainFrame) {
                super.onReceivedError(view, request, error)
            }
        }

        override fun onRenderProcessGone(
            view: WebView,
            detail: RenderProcessGoneDetail
        ): Boolean {
            try {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            } catch (_: Exception) {
                // Best-effort cleanup; renderer is already gone
            }

            if (!isFinishing && !isDestroyed) {
                val rendererCrashed =
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash()
                showToast(
                    if (rendererCrashed) "Web content crashed. Restarting SplitPay…"
                    else "Web content was restarted."
                )
                binding.root.post { recreate() }
            }
            return true
        }
    }

    // ─── WebChromeClient ─────────────────────────────────────────────────────

    inner class SplitPayWebChromeClient : WebChromeClient() {

        override fun onPermissionRequest(request: PermissionRequest) {
            val resources = request.resources
            val needsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources

            if (needsCamera) {
                when {
                    ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED -> {
                        request.grant(request.resources)
                    }
                    else -> {
                        webPermissionRequest = request
                        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
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
            filePathCallback?.onReceiveValue(null)
            filePathCallback = callback

            return try {
                val intent = params.createIntent()
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                fileChooserLauncher.launch(intent)
                true
            } catch (e: Exception) {
                filePathCallback = null
                false
            }
        }

        override fun onJsConfirm(
            view: WebView,
            url: String,
            message: String,
            result: JsResult
        ): Boolean {
            showAppDialog(this@MainActivity) {
                setTitle("SplitPay")
                setMessage(message)
                setIcon("question")
                setPositiveText(getString(R.string.yes))
                setNegativeText(getString(R.string.no))
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
            showAppDialog(this@MainActivity) {
                setTitle("SplitPay")
                setMessage(message)
                setIcon("info")
                setPositiveText("OK")
                setNegativeText("Cancel")
                setCancelable(false)
                showWithInput("Enter UPI ID", defaultValue ?: "") { value ->
                    if (value != null) result.confirm(value) else result.cancel()
                }
            }
            return true
        }

        override fun onJsAlert(
            view: WebView, url: String, message: String, result: JsResult
        ): Boolean {
            showAppDialog(this@MainActivity) {
                setMessage(message)
                setIcon("info")
                setPositiveText(getString(R.string.ok))
                setCancelable(false)
                onPositive { result.confirm() }
                onCancelled { result.cancel() }
            }
            return true
        }

        override fun onProgressChanged(view: WebView, newProgress: Int) {
            // Progress available here if you add a ProgressBar to the layout
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun launchUpiIntent(upiUrl: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, upiUrl.toUri()).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            if (intent.resolveActivity(packageManager) != null) {
                startActivity(intent)
            } else {
                showAppDialog(this) {
                    setTitle(getString(R.string.no_upi_app_title))
                    setMessage(getString(R.string.no_upi_app_message))
                    setIcon("upi")
                    setPositiveText(getString(R.string.ok))
                }
            }
        } catch (e: Exception) {
            showToast("Could not open UPI app: ${e.message}")
        }
    }

    private fun launchExternalUrl(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, url.toUri()).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(intent)
        } catch (e: Exception) {
            showToast("Could not open link")
        }
    }

    private fun showToast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }
}
