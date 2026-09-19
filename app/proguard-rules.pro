# ──────────────────────────────────────────────────────────────────────────────
# SplitPay ProGuard / R8 rules
#
# DESIGN PRINCIPLE: keep only what R8 cannot discover itself (reflection targets
# and JavaScript bridge methods). Blanket -keep class foo.** { *; } rules defeat
# code shrinking and result in a larger APK — they are removed here.
# ──────────────────────────────────────────────────────────────────────────────

# ── Application class ─────────────────────────────────────────────────────────
# R8 finds this via AndroidManifest.xml; listed explicitly as a safety net.
-keep class com.splitpay.app.SplitPayApp { <init>(); }

# ── JavaScript → Android Bridge ───────────────────────────────────────────────
# Methods annotated @JavascriptInterface are called by the WebView engine through
# reflection and are therefore invisible to R8's static analysis.
# Keep ONLY the annotated methods and the class name (prevents NPE in the bridge).
-keepclassmembers class com.splitpay.app.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepnames class com.splitpay.app.MainActivity$AndroidBridge

# ── Kotlin runtime ────────────────────────────────────────────────────────────
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlin.Metadata { public <methods>; }
-keepclassmembers class **$WhenMappings { <fields>; }
-dontwarn kotlin.**

# ── AndroidX WebKit ───────────────────────────────────────────────────────────
# WebViewAssetLoader and WebViewFeature are accessed reflectively inside the
# webkit compat library itself; keep the public API surface.
-keep class androidx.webkit.** { *; }
-dontwarn androidx.webkit.**

# ── Suppress warnings for optional dependencies ───────────────────────────────
-dontwarn com.google.android.material.**
-dontwarn androidx.**

# ── Strip debug-only logging in release builds ────────────────────────────────
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int     v(...);
    public static int     d(...);
    public static int     i(...);
}

# ── Preserve source file info for stack-trace deobfuscation ──────────────────
# Upload the mapping.txt to Play Console so crash reports are readable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SplitPay
