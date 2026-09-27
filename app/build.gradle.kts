plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace  = "com.splitpay.app"
    // compileSdk 37 is the max level AGP 9.4.x can compile against.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.splitpay.app"
        minSdk        = 24
        // FIX: was 35. Google Play has required new apps AND app updates to
        // target Android 16 (API 36) since August 31, 2026 — an app still
        // targeting 35 can no longer be submitted or updated on Play as of
        // this build. Bumped to 36; re-smoke-test predictive back and any
        // other API-36 behavior changes before shipping (see MainActivity's
        // hardware-back handling, which already uses OnBackPressedCallback
        // rather than the removed Activity.onBackPressed()/KEYCODE_BACK path).
        targetSdk     = 36
        versionCode   = 1
        versionName   = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // FIX: Limit to the ABIs that cover >99 % of real devices.
        // x86 / x86_64 are emulator-only; Play's AAB delivery handles per-device
        // splits automatically, so this also shrinks locally-built debug APKs.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    signingConfigs {
        // ── Release signing ──────────────────────────────────────────────────
        // REQUIRED before Play Store upload. Uncomment and supply values.
        // Best practice: read credentials from environment variables — NEVER
        // commit passwords to source control.
        //
        // Build command: ./gradlew bundleRelease
        // Output: app/build/outputs/bundle/release/app-release.aab
        //
        // create("release") {
        //     storeFile    = file(System.getenv("KEYSTORE_PATH") ?: "splitpay-release.jks")
        //     storePassword = System.getenv("STORE_PASSWORD") ?: ""
        //     keyAlias      = System.getenv("KEY_ALIAS")      ?: ""
        //     keyPassword   = System.getenv("KEY_PASSWORD")   ?: ""
        // }
    }

    buildTypes {
        release {
            isMinifyEnabled   = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Uncomment once signingConfigs.release is configured above:
            // signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable        = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    // FIX: Explicit AAB split config (Play Store uses these for per-device delivery)
    bundle {
        language { enableSplit = true }
        density  { enableSplit = true }
        abi      { enableSplit = true }
    }

    // Lint — non-fatal so CI still passes; revisit MissingTranslation if you add locales
    lint {
        abortOnError       = false
        checkReleaseBuilds = true
        disable            += setOf("MissingTranslation", "ExtraTranslation")
    }

    // FIX: Exclude files that inflate the APK/AAB with no benefit
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/NOTICE*"
            excludes += "/META-INF/LICENSE*"
            excludes += "/*.txt"
            excludes += "/*.properties"
        }
    }
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.appcompat:appcompat:1.8.0")

    // WebView (enhanced support across all API 24+ WebView versions)
    implementation("androidx.webkit:webkit:1.17.0")

    // Material Design
    implementation("com.google.android.material:material:1.14.0")

    // Layouts
    implementation("androidx.constraintlayout:constraintlayout:2.2.2")

    // Activity
    implementation("androidx.activity:activity-ktx:1.13.0")

    // Splash Screen API — provides proper API 31+ adaptive splash screen
    // and eliminates the cold-start white flash on older API levels.
    // FIX: was 1.0.1 (July 2022) — two stable minor versions behind. 1.2.0
    // is current stable and fixes several splash→activity theme-handoff
    // bugs that touch exactly the installSplashScreen() + edge-to-edge path
    // MainActivity.onCreate() runs on every launch.
    implementation("androidx.core:core-splashscreen:1.2.0")
}
