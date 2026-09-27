package com.splitpay.app.util

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/* ═══════════════════════════════════════════════════════════════════
   SplitPay — PreferenceManager.kt
   Singleton SharedPreferences wrapper.

   Pattern applied — double-checked locking singleton:
     PreferenceManager.getInstance(context).theme = "dark"

   Why a singleton?
     SharedPreferences must not be instantiated multiple times for the
     same file name (race conditions on some Android versions). Wrapping
     it in a singleton guarantees a single underlying instance while
     giving a clean property-accessor API.

   Syncs with Storage.js:
     The JS Storage module also persists to localStorage. These prefs
     are the Kotlin-native mirror used when the WebView isn't running
     (e.g. to configure the status bar colour before the page loads).
   ═══════════════════════════════════════════════════════════════════ */

class PreferenceManager private constructor(private val prefs: SharedPreferences) {

    // ─── Theme ────────────────────────────────────────────────────

    /**
     * Active theme: "light" | "dark" | "system".
     * Defaults to "system" — respects the device setting.
     */
    var theme: String
        get() = prefs.getString(KEY_THEME, THEME_SYSTEM) ?: THEME_SYSTEM
        set(value) = prefs.edit { putString(KEY_THEME, value) }

    val isLightTheme get() = theme == THEME_LIGHT
    val isDarkTheme  get() = theme == THEME_DARK
    val isSystemTheme get() = theme == THEME_SYSTEM

    // ─── Turbo mode ───────────────────────────────────────────────

    /**
     * Whether Turbo Auto-Next is on by default.
     * The toggle in the plan screen overrides this for the current session.
     */
    var turboDefault: Boolean
        get() = prefs.getBoolean(KEY_TURBO, true)
        set(value) = prefs.edit { putBoolean(KEY_TURBO, value) }

    // ─── Default split mode ───────────────────────────────────────

    /** Last chosen split mode: "equal" | "random". */
    var defaultSplitMode: String
        get() = prefs.getString(KEY_SPLIT_MODE, "equal") ?: "equal"
        set(value) = prefs.edit { putString(KEY_SPLIT_MODE, value) }

    // ─── Payment count ────────────────────────────────────────────

    /** Total sequences started (not just completed) — for UX nudges. */
    var paymentCount: Int
        get() = prefs.getInt(KEY_PAY_COUNT, 0)
        set(value) = prefs.edit { putInt(KEY_PAY_COUNT, value) }

    fun incrementPaymentCount() { paymentCount++ }

    // ─── Onboarding ───────────────────────────────────────────────

    var hasSeenOnboarding: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDED, false)
        set(value) = prefs.edit { putBoolean(KEY_ONBOARDED, value) }

    // ─── Clear ────────────────────────────────────────────────────

    /** Wipe all persisted preferences (e.g. for a factory-reset feature). */
    fun clearAll() = prefs.edit { clear() }

    // ─── Companion (singleton) ────────────────────────────────────

    companion object {
        // Theme constants — shared with the JS layer and dialog code
        const val THEME_LIGHT  = "light"
        const val THEME_DARK   = "dark"
        const val THEME_SYSTEM = "system"

        private const val PREFS_FILE    = "splitpay_prefs"
        private const val KEY_THEME     = "theme"
        private const val KEY_TURBO     = "turbo"
        private const val KEY_SPLIT_MODE = "split_mode"
        private const val KEY_PAY_COUNT = "pay_count"
        private const val KEY_ONBOARDED = "onboarded"

        @Volatile private var _instance: PreferenceManager? = null

        /**
         * Return the singleton, creating it if necessary.
         * Thread-safe via double-checked locking.
         * Always pass [applicationContext] — never an Activity.
         */
        fun getInstance(context: Context): PreferenceManager =
            _instance ?: synchronized(this) {
                _instance ?: PreferenceManager(
                    context.applicationContext.getSharedPreferences(
                        PREFS_FILE, Context.MODE_PRIVATE
                    )
                ).also { _instance = it }
            }
    }
}
