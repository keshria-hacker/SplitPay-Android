# ═══════════════════════════════════════════════════════════════════
# SplitPay — R8 / ProGuard rules
#
# This file was MISSING but app/build.gradle.kts references it in the
# release buildType, so `assembleRelease` (and `bundleRelease`) failed
# outright with:
#   "Supplied proguard configuration does not exist: .../app/proguard-rules.pro"
#
# The rules below aren't just to satisfy the reference — they're load-
# bearing for release builds, because gradle.properties enables R8 full
# mode and the app talks to JavaScript through a @JavascriptInterface
# bridge whose methods are invoked from JS *by string name* over JNI.
# R8 can't see those call sites and would rename/remove the methods,
# silently breaking every window.AndroidBridge.* call (UPI launch,
# clipboard, native dialogs, share, camera…).
# ═══════════════════════════════════════════════════════════════════

# ── JavaScript bridge (window.AndroidBridge) ────────────────────────
# Keep the bridge class itself (instantiated only for the injected JS
# object) and every @JavascriptInterface method, under its original name.
-keep class com.splitpay.app.bridge.AndroidBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
