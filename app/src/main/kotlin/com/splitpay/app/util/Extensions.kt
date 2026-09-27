package com.splitpay.app.util

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.util.TypedValue
import android.webkit.WebView
import android.widget.Toast
import androidx.annotation.AttrRes
import androidx.annotation.ColorInt

/* ═══════════════════════════════════════════════════════════════════
   SplitPay — Extensions.kt
   Extension functions that clean up repetitive patterns across
   MainActivity, AndroidBridge, and the webview clients.

   Grouped by receiver type so they're easy to scan.
   ═══════════════════════════════════════════════════════════════════ */

// ─── WebView extensions ───────────────────────────────────────────

/**
 * Evaluate [script] and discard the result.
 * Wraps the call in an IIFE + try/catch so:
 *   - the script runs in its own scope (no accidental variable leaks)
 *   - JS exceptions don't surface as renderer crashes
 */
fun WebView.runJs(script: String) {
    evaluateJavascript(
        "(function(){try{$script}catch(e){console.error('[WebView]',e);}})()",
        null
    )
}

/**
 * Call a named JS function with the given arguments.
 * Primitive arguments (Boolean, Int, Double, Long) are serialised as
 * JS literals; everything else is quoted as a JSON string.
 *
 *   webView.callJs("onVisReturn")
 *   webView.callJs("toast", "Hello", true)
 *   webView.callJs("goTo", "4a")
 */
fun WebView.callJs(fn: String, vararg args: Any?) {
    val argStr = args.joinToString(",") { arg ->
        when (arg) {
            null             -> "null"
            is Boolean       -> if (arg) "true" else "false"
            is Number        -> arg.toString()
            else             -> AndroidStringEncoder.jsString(arg.toString())
        }
    }
    runJs("if(typeof $fn==='function'){$fn($argStr);}")
}

/**
 * Post a JS call to run after [delayMs] on the main thread.
 * Useful for delayed nudges after returning from a UPI app.
 */
fun WebView.callJsDelayed(delayMs: Long, fn: String, vararg args: Any?) {
    postDelayed({ callJs(fn, *args) }, delayMs)
}

/**
 * Safely destroy the WebView:
 *   stop loading → clear history → remove all views → destroy
 * Calling [WebView.destroy] without these steps can leak the renderer.
 */
fun WebView.destroySafely() {
    stopLoading()
    clearHistory()
    removeAllViews()
    destroy()
}

// ─── Context / Activity extensions ───────────────────────────────

/** True when the system is in night mode (handles all API levels). */
val Context.isNightMode: Boolean
    get() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

/**
 * Resolve a theme attribute to its colour value.
 * Avoids the boilerplate TypedValue + obtainStyledAttributes pattern.
 */
@ColorInt
fun Context.colorFromAttr(@AttrRes attr: Int): Int {
    val tv = TypedValue()
    theme.resolveAttribute(attr, tv, true)
    return tv.data
}

/** Convert dp to px using the display density. */
fun Context.dpToPx(dp: Float): Int =
    (dp * resources.displayMetrics.density + 0.5f).toInt()

/** Show a short toast without storing a reference to it. */
fun Context.showShortToast(msg: String) =
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

// ─── String extensions ────────────────────────────────────────────

/**
 * True if this string is a valid UPI Virtual Payment Address.
 * Matches [localpart]@[provider] — same regex as JS validator.js.
 *
 * Length is capped before the regex runs — mirrors validator.js's 100-char
 * cap — so this check never depends on JS having already trimmed the
 * input first. This is the last check before an intent is launched, so
 * it shouldn't assume anything about what reached it.
 */
fun String.isValidUpi(): Boolean =
    length in 1..100 && matches(Regex("^[a-zA-Z0-9.\\-_+]+@[a-zA-Z0-9]+$"))

/**
 * Trim whitespace and return null if the result is blank.
 * Cleaner than the `takeIf { it.isNotBlank() }` idiom.
 */
fun String.trimOrNull(): String? = trim().ifBlank { null }

/**
 * Truncate to [max] characters, appending [suffix] (default "…") if cut.
 *   "Hello, world".truncate(5) == "Hello…"
 */
fun String.truncate(max: Int, suffix: String = "…"): String =
    if (length > max) take(max) + suffix else this

// ─── Number extensions ────────────────────────────────────────────

/** Format an integer amount as Indian rupees with comma grouping: 10,000. */
fun Int.toRupees(): String = "₹${String.format("%,d", this)}"

/** Clamp this Int to [min]..[max]. */
fun Int.clamp(min: Int, max: Int): Int = maxOf(min, minOf(max, this))

// ─── Internal helper (not an extension) ──────────────────────────

/**
 * Encodes a Kotlin string for safe embedding in a JS string literal.
 * Shared by callJs() and AndroidBridge.jsString().
 */
internal object AndroidStringEncoder {
    fun jsString(s: String): String = buildString {
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
