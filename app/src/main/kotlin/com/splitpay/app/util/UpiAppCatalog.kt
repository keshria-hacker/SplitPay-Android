package com.splitpay.app.util

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

/* ═══════════════════════════════════════════════════════════════════
   SplitPay — UpiAppCatalog.kt
   Catalog of known UPI apps with their verified Play Store package
   names, plus install detection and the "preferred UPI app" setting.

   WHY EXPLICIT PACKAGE NAMES MATTER (the fraud-warning fix):
     Google's official UPI integration guide requires merchants to
     launch UPI apps with intent.setPackage(<upi app package>) and
     startActivityForResult(). When a payment intent arrives WITHOUT
     an explicit package, Google Pay / PhonePe / Paytm / BHIM treat
     the caller as an unknown third party and show the red
     "possible fraud — this app was not verified" warning before
     letting the user pay. Launching explicitly suppresses that
     warning on every major UPI app and lets the caller await the
     transaction result instead of guessing.
   ═══════════════════════════════════════════════════════════════════ */

/** One entry per supported UPI app. [packageName] values are the
 *  official Play Store IDs — verified against each app's Play listing. */
data class UpiApp(
    val packageName: String,
    val displayName: String,
) {
    /** Safe emoji-free short label for pickers/toasts. */
    val label: String get() = displayName
}

object UpiAppCatalog {

    /** Sentinel for "no default app — ask every time". */
    const val UPI_APP_NONE = "__ask__"

    // ─── Known UPI apps (Play Store package IDs) ────────────────────
    val KNOWN_APPS = listOf(
        UpiApp("com.google.android.apps.nbu.paisa.user", "Google Pay"),
        UpiApp("com.phonepe.app",                        "PhonePe"),
        UpiApp("net.one97.paytm",                        "Paytm"),
        UpiApp("in.org.npci.upiapp",                     "BHIM"),
        UpiApp("com.amazon.mShop.android.shopping",      "Amazon Pay"),
        UpiApp("com.mobikwik_new",                       "MobiKwik"),
        UpiApp("com.freecharge.android",                 "Freecharge"),
        UpiApp("com.cred.store",                         "Cred UPI"),
        UpiApp("com.myairtelapp.app",                    "Airtel Thanks"),
        UpiApp("com.whatsapp",                           "WhatsApp UPI"),
    )

    private const val PREF_KEY_DEFAULT_APP = "preferred_upi_app"

    // ─── Install detection ──────────────────────────────────────────

    /**
     * True when [packageName] is installed AND handles `upi://pay` links.
     * On API 33+ `getPackageInfo` throws when the package isn't visible —
     * the <queries> entries in AndroidManifest.xml keep the known UPI
     * packages visible, so this stays accurate on Android 13+.
     */
    fun isInstalled(context: Context, packageName: String): Boolean {
        if (packageName.isBlank()) return false
        return try {
            context.packageManager.getPackageInfo(packageName, 0)
            // Also confirm it can actually accept a UPI payment intent —
            // some apps (e.g. WhatsApp) are installed but may not have the
            // UPI surface enabled in every region.
            val probe = Intent(Intent.ACTION_VIEW,
                Uri.parse("upi://pay?pa=probe@upi")).setPackage(packageName)
            context.packageManager.resolveActivity(probe, 0) != null
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * All catalog apps installed on this device, in catalog order.
     * Used by the Settings UPI-app picker.
     */
    fun installedApps(context: Context): List<UpiApp> =
        KNOWN_APPS.filter { isInstalled(context, it.packageName) }

    /**
     * Resolve an arbitrary package name to a display name.
     * Returns the app's real label when the package is installed but not
     * in our catalog (e.g. a regional UPI app the user sideloaded).
     */
    fun displayNameFor(context: Context, packageName: String): String {
        KNOWN_APPS.firstOrNull { it.packageName == packageName }?.let { return it.displayName }
        return try {
            val pm = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getApplicationInfo(packageName, 0)
            }
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }
    }

    // ─── Preferred (default) UPI app ────────────────────────────────

    /** Read the saved default UPI app package ("" = no default chosen). */
    fun preferredApp(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        return prefs.getString(PREF_KEY_DEFAULT_APP, "").orEmpty()
    }

    /**
     * Save the default UPI app package. Pass "" to clear (use "Ask every time").
     * If the package was uninstalled since it was chosen, the pref is
     * self-healed to "" so the app never launches into a dead package.
     */
    fun setPreferredApp(context: Context, packageName: String) {
        val clean = packageName.trim()
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        if (clean.isNotEmpty() && !isInstalled(context, clean)) {
            prefs.edit().putString(PREF_KEY_DEFAULT_APP, "").apply()
            return
        }
        prefs.edit().putString(PREF_KEY_DEFAULT_APP, clean).apply()
    }

    /** True when the user picked a specific default UPI app. */
    fun hasPreferredApp(context: Context): Boolean =
        preferredApp(context).isNotEmpty()

    /**
     * The app a payment should be routed to right now, or null when no
     * usable default is set (uninstalled / never chosen).
     * Self-healing: a stale package name is cleared on read.
     */
    fun resolvePreferred(context: Context): UpiApp? {
        val pkg = preferredApp(context)
        if (pkg.isEmpty()) return null
        if (!isInstalled(context, pkg)) {
            setPreferredApp(context, "")   // self-heal stale entries
            return null
        }
        return UpiApp(pkg, displayNameFor(context, pkg))
    }

    private const val PREFS_FILE = "upi_settings"
}
