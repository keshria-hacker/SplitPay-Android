# SplitPay — Android App

> Smart UPI installment splitter. Split large UPI payments into parts of ≤ ₹1,999 — under the government's 0.4% MDR threshold for merchants — and run them as a guided sequence.

---

## 📱 What the App Does

- **Scan or enter** any UPI ID / QR code (live camera, photo, or gallery)
- **Auto-splits** large amounts into ≤ ₹1,999 parts (equal or randomized)
- **Auto-Run mode** — sequences payments automatically, with a Turbo back-to-back option
- **Manual mode** — review and confirm each part individually
- **Show-QR fallback** — generates a payment QR for any part, scannable from a second device/app
- **Custom native popups** — pen-and-paper styled dialogs (light + dark)
- **Receipt sharing** — copy, or share via WhatsApp / any installed app
- **MDR savings calculator** (0.4% rule, capped at ₹300 per NPCI Oct-2026 guidelines)

---

## 🧱 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | **Kotlin** (JVM 17) | Native Android, coroutine-free single-activity design |
| UI Shell | **WebView + WebViewAssetLoader** | UI ships as a local web app served from `https://appassets.androidplatform.net` (secure origin: camera, clipboard APIs work) |
| UI (web) | Vanilla **HTML/CSS/JS**, zero frameworks | ~50 KB single file, instant load, no build step for the UI |
| QR decode | **jsQR 1.4.0** (bundled locally) | Offline scanning, no CDN dependency |
| QR generate | **qrcodejs 1.0.0** (bundled locally) | Payment QR fallback |
| Native dialogs | **Material Components** theme + custom XML popups | Brand-consistent, DayNight aware |
| Build | **Gradle 9.6 / AGP 9.4.0 / ViewBinding** | |
| Min SDK | **24** (Android 7.0) | Covers ~98% of Indian devices |
| Target SDK | **35** (Android 15) | Meets current Play Store requirement |

**No network backend.** The app makes zero outbound HTTP requests; UPI deep links go through the Android intent system, not HTTP.

---

## ⚙️ How the App Works — Flow

```
┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌──────────┐
│ 1. PAYEE   │──▶│ 2. AMOUNT  │──▶│ 3. PLAN    │──▶│ 4. EXECUTE │──▶│ 5. DONE  │
│ scan/type  │   │ + chips    │   │ equal/rand │   │ auto/manual│   │ receipt  │
│ UPI ID     │   │ + note     │   │ editable   │   │ turbo/pause│   │ + share  │
└────────────┘   └────────────┘   └────────────┘   └────────────┘   └──────────┘
```

**Step 1 — Payee.** Scan a UPI QR with the camera (live jsQR loop on a downscaled 480px frame, ~8 fps to save CPU) or pick from gallery/photo, or type a UPI ID. Scanned `pa=`/`pn=` fields are validated and length-capped.

**Step 2 — Amount.** Amount input is sanitized (integer rupees, capped at ₹10,000). Quick chips (2,500 / 5,000 / 10K) highlight when matching.

**Step 3 — Plan.** The app computes the **minimum number of parts** `⌈total / 1999⌉`; you can raise it (max 200). Choose **Equal** or **Random** amounts, edit any part inline, and the sum-check bar turns green only when `Σ parts === total` and every part is within `[₹1, ₹1,999]`.

**Step 4 — Execute.**
- *Auto-Run*: builds `upi://pay?...` links per part and opens the installed UPI app. When you return, `visibilitychange` (+ a native `onVisReturn()` nudge from MainActivity) triggers the confirm sheet. **Turbo** chains parts back-to-back; otherwise a 3-2-1 countdown runs. You can **Pause**, **Skip**, **Mark Done**, **Show QR**, or **Retry** any part.
- *Manual*: a ledger list where each part unlocks only after the previous one is marked paid/failed — each row has Pay / Show-QR / Done actions.

**Step 5 — Done.** Receipt with per-part ✓/✕, MDR savings card, share or copy.

---

## 🗺 Code Map

```
app/src/main/
├── AndroidManifest.xml                 # Permissions (CAMERA, VIBRATE), UPI <queries>, deep links
├── kotlin/com/splitpay/app/
│   ├── SplitPayApp.kt                  # Application: WebView debugging only in debug builds
│   └── MainActivity.kt                 # Everything native:
│       ├── setupAssetLoader()          #   HTTPS virtual domain for assets
│       ├── setupWebView()              #   hardened WebSettings, bridge attach
│       ├── AppDialogBuilder + showAppDialog()  # reusable custom popup system
│       ├── AndroidBridge               #   JS→Kotlin: clipboard, share, UPI, popups
│       ├── SplitPayWebViewClient       #   URL routing: upi://, intent://, external
│       └── SplitPayWebChromeClient     #   camera permission, file chooser, JS dialogs
├── assets/
│   ├── index.html                      # the entire UI (screens, styles, logic)
│   └── js/  jsQR.min.js, qrcode.min.js # bundled QR engines (offline)
└── res/
    ├── layout/dialog_custom.xml        # popup layout (icon/title/message/input/buttons)
    ├── drawable/dialog_*               # popup card, buttons, input, badge
    ├── values(+night)/                 # light & dark palettes, themes, strings
    └── xml/                            # backup rules, network security, provider paths
```

### JavaScript ↔ Kotlin bridge

| JS call | Native action |
|---|---|
| `AndroidBridge.getClipboardText()` | read clipboard (bypasses gesture restriction) |
| `AndroidBridge.copyToClipboard(t)` | write clipboard on all API levels |
| `AndroidBridge.shareText(t)` | native share sheet |
| `AndroidBridge.openUpiLink(u)` | open UPI intent (iframe fallback) |
| `AndroidBridge.hasUpiApp()` | is any UPI app installed? |
| `AndroidBridge.requestCameraPermission()` | official Android camera permission flow |
| `AndroidBridge.showPopup(t,m,btn,icon)` | 1-button native popup |
| `AndroidBridge.showConfirmDialog(...)` / `showInputDialog(...)` | confirm/input popups; results dispatch to `onAppDialogResult(id, val)` |
| `window.appConfirm(...) / appPrompt(...)` | Promise wrappers for the above (web fallback: `confirm`/`prompt`) |

---

## 🧮 Core Algorithms

### Split math (exact integer, no float drift)

```js
const MAX_PART = 1999;
getMin(total)  → Math.max(1, Math.ceil(total / MAX_PART))

// Equal: leftover rupees spread over the FIRST parts  (₹100/3 → 34, 33, 33)
evenParts(rem, k): base + 1 for the first (rem − base·k) parts

// Random: distinct-amount construction (O(n), no retries, no dead ends)
// Rule: NO two parts share the same amount.
//   part_i = i + x_i, x = non-decreasing random composition of
//   E = total − n(n+1)/2 with each x_i ≤ 1999 − n  ⇒ parts strictly increase.
// Feasible band for n distinct parts in [1,1999]:
//   n(n+1)/2 ≤ total ≤ n(3999−n)/2   (e.g. ₹10,000 needs ≥ 6 parts)
// Guarantees: every part ∈ [1,1999], all amounts UNIQUE, Σ === total exactly.
// Sum-check + startPay() additionally reject duplicate amounts in random mode.
```

Old versions had a `minA > maxA` dead-end fallback and float-safe re-splits; the current engine can't produce an invalid plan by construction.

### Safety rails
- Amount sanitized: integer rupees, hard-capped at **₹10,000** (keeps installment sequences short; split math still respects the ₹1,999 MDR limit).
- `startPay()` refuses to run unless `Σ parts === total` and all parts ∈ [1, 1999].
- Editing a part recomputes the last part to the *exact* remainder — the sum-check (not silent rounding) flags any imbalance.

### QR scan pipeline
Downscaled 480px frame → `getImageData` → jsQR (`dontInvert` for speed) → parse `pa/pn/am` from `upi://` links or bare UPI IDs → validate → fill the form. Torch button only appears when the camera reports `torch` capability.

---

## 🔐 Security Model

- **No backend, no analytics, no tracking.** State lives in JS memory only; nothing persists (backup rules exclude everything).
- **XSS-hardened rendering:** payee names/UPI IDs coming from scanned QR codes are HTML-escaped (`esc()`) before any `innerHTML` insertion; name field length-capped to 50 chars. A malicious QR cannot inject markup into a WebView that has a native bridge.
- **Bridge hygiene:** all bridge methods run on the UI thread via `runOnUiThread`, validate/blank-guard inputs, and `nativeToast` caps message length.
- **Transport:** `cleartextTrafficPermitted="false"` globally; app assets served from a virtual HTTPS origin; mixed content blocked.
- **FileProvider** paths scoped to the app's private `receipts/` and `cache/share/` dirs (was: entire external storage).
- **Backups disabled** (`allowBackup=false` + full data-extraction exclusions) so no residue syncs to Google.
- **Release hygiene:** ProGuard keeps only the `@JavascriptInterface` surface; `Log.d/v/i` stripped from release.
- **Explicitly out of scope:** the app never stores, transmits, or processes card/UPI credentials — payments happen entirely inside the user's chosen UPI app.

---

## 🛠 Build Instructions

### Prerequisites
| Tool | Version |
|------|---------|
| Android Studio | Ladybug (2024.2+) |
| JDK | 17+ (bundled in Studio) |
| Android SDK | API 37 |

### Run / Debug
1. Open the project in Android Studio → wait for Gradle sync.
2. Enable USB debugging on a phone (real device recommended — UPI apps don't run on emulators).
3. ▶ Run (Shift+F10).

CLI build:
```bash
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

### Release
1. Generate a keystore (keep it safe — it's required for all future updates):
   ```bash
   keytool -genkey -v -keystore splitpay-release.jks -alias splitpay \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Uncomment and fill `signingConfigs.release` in `app/build.gradle.kts`.
3. Build:
   ```bash
   ./gradlew bundleRelease    # → app-release.aab  (Play Store upload)
   ./gradlew assembleRelease  # → app-release.apk  (direct install/testing)
   ```

---

## 🚀 Play Store Checklist

**Already done in this repo:**
- ✅ `targetSdk 35`, `versionCode/versionName` set, `minSdk 24`
- ✅ `debug` build has a separate `applicationId` suffix (`.debug`) — clean release ID
- ✅ Backup & device-transfer rules fully exclude app data
- ✅ Minimal permissions (CAMERA, VIBRATE) with a human-readable camera-use label
- ✅ Network security config (no cleartext), scoped FileProvider
- ✅ Release minify + resource shrinking + ProGuard rules for the JS bridge

**You must do before submitting:**
1. **Create the Play Console account** ($25 one-time) and complete identity verification.
2. **Store listing:** app name, 512×512 icon, 1024×500 feature graphic, ≥2 phone screenshots.
3. **Privacy policy URL** (required — template below; GitHub Pages works).
4. **Financial declaration:** declare UPI intent usage in the *App content → Financial features* form. The app itself touches no money — it composes UPI deep links for the user's own payment apps.
5. **Data safety form:** "No data collected, no data shared."

> ⚠️ **Listing copy caution:** phrase the value proposition as *"split large payments into installments"* rather than *"bypass MDR / government fee"*. Fee-avoidance framing can trip Play's financial-policy review even though the mechanic (multiple smaller transfers) is a normal UPI operation.

**Privacy policy template:**
```
SplitPay Privacy Policy
SplitPay is a payment utility. We do not collect, store, or transmit any
personal or payment data. All operations run locally on your device. No
analytics, no tracking, no third-party services.
Contact: [your email]
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Gradle sync fails | Check internet; File → Invalidate Caches |
| UPI app doesn't open | Install GPay / PhonePe / Paytm / BHIM first |
| Camera dark / no scan | Grant Camera permission; flash/torch appears only if the device supports it |
| `JAVA_HOME` not set (CLI builds) | Point `JAVA_HOME` at Android Studio's bundled JBR |
| Build fails on SDK | Install API 37 via Tools → SDK Manager |

---

## 📋 Technical Details

| Property | Value |
|----------|-------|
| Min Android | 7.0 (API 24) |
| Target Android | 15 (API 35) |
| Architecture | Single Activity + WebView shell + native bridge |
| UI assets | `index.html` (~50 KB) + bundled jsQR/qrcodejs |
| Permissions | CAMERA, VIBRATE |
| Data collected | None |

---

*SplitPay — making large UPI payments frictionless.*
