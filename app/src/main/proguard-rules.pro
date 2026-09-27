# ═══════════════════════════════════════════════════════════════════
# SplitPay — proguard-rules.pro
# R8 shrink/obfuscate/optimise rules.
#
# Principle: keep the minimum surface that R8 cannot infer on its
# own. Everything annotated with @JavascriptInterface, referenced
# reflectively, or called by name from the JS layer must be kept.
# Everything else is free to shrink, rename, and inline.
# ═══════════════════════════════════════════════════════════════════

# ── @JavascriptInterface methods ────────────────────────────────────
# R8 cannot see that the JS layer calls these by string name. Keep
# every class that holds @JavascriptInterface methods AND those methods.
-keepclassmembers class com.splitpay.app.bridge.AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
# Keep the class itself (so the WebView addJavascriptInterface binding holds)
-keep class com.splitpay.app.bridge.AndroidBridge { <init>(...); }

# ── Dialog DSL callbacks ─────────────────────────────────────────────
# AppDialog uses a builder DSL with lambda fields; R8 can inline them.
# Keep the public DSL surface so callers outside the module still compile.
-keep class com.splitpay.app.dialog.AppDialogBuilder { *; }

# ── Data / model classes ─────────────────────────────────────────────
# Sealed classes and data classes used in when() exhaustive matches.
# Keep names so stack traces are readable.
-keep class com.splitpay.app.model.** { *; }

# ── Extension objects ────────────────────────────────────────────────
# AndroidStringEncoder companion accessed by both AndroidBridge and
# Extensions.kt. R8 should inline it, but keep as a safety net.
-keep class com.splitpay.app.util.AndroidStringEncoder { *; }

# ── WebView clients ──────────────────────────────────────────────────
# SplitPayWebViewClient and SplitPayWebChromeClient override system
# methods — they must not be renamed or the WebView calls will miss.
-keep class com.splitpay.app.webview.SplitPayWebViewClient  { *; }
-keep class com.splitpay.app.webview.SplitPayWebChromeClient { *; }

# ── Kotlin metadata ──────────────────────────────────────────────────
# Needed for reflection-based libraries (Gson, Moshi, kotlinx.serialization).
# SplitPay doesn't use them today, but keep to avoid mystery crashes if
# a future dependency does.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes SourceFile,LineNumberTable   # readable crash stack traces

# ── Coroutines (if added later) ──────────────────────────────────────
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# ── SplashScreen compat ──────────────────────────────────────────────
-keep class androidx.core.splashscreen.** { *; }

# ── Suppress notes about JDK internals not present on Android ─────────
-dontnote sun.misc.**
-dontnote java.lang.invoke.**

# ── Suppress warnings for classes intentionally absent ────────────────
-dontwarn org.codehaus.mojo.**
-dontwarn javax.annotation.**
