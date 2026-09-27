# Security Policy

## Reporting a vulnerability

Please report suspected security issues privately rather than opening a
public issue. Suggested options, pick one:

- A private security advisory on this repository (GitHub: *Security →
  Advisories → Report a vulnerability*), or
- A dedicated security email address, e.g. `security@splitpay.app`.

When reporting, please include: the app version (`versionName` in
`app/build.gradle.kts`), Android version and device, steps to reproduce,
and what you expected vs. observed. We'd appreciate 90 days to fix an
issue before public disclosure, but will move faster where the severity
warrants it.

## Scope

This document covers the SplitPay Android app in this repository: the
WebView UI (`app/src/main/assets/`) and the native Kotlin shell
(`app/src/main/kotlin/`). It does not cover any UPI app, bank, or NPCI
infrastructure SplitPay hands payments off to — those have their own
security processes.

## How SplitPay is built, and what that means for security

**No backend, no accounts, no network calls of its own.** SplitPay does
not talk to any SplitPay-operated server. All state — UPI history, saved
amounts, theme, the merchant's saved accounts — lives in the WebView's
`localStorage` on the device, namespaced under the `sp_` prefix
(`app/src/main/assets/js/storage.js`). Nothing is uploaded anywhere by
this app. `AndroidManifest.xml` sets `android:allowBackup="false"`, and
`network_security_config.xml` disables cleartext (plain HTTP) traffic
everywhere.

That "no network calls" property is enforced by what the bundled HTML/
CSS/JS actually reference, **not** by `network_security_config.xml`
itself — its `domain-config` entry for `appassets.androidplatform.net`
sets trust-anchors/cleartext policy for that domain, it does not act as
an allowlist, and does nothing to stop the WebView reaching any other
HTTPS host. That gap wasn't theoretical: earlier builds of `index.html`
linked `fonts.googleapis.com`/`fonts.gstatic.com` for two web fonts, and
this config did nothing to prevent it since both are HTTPS, not
cleartext — every launch silently fetched from Google's CDN, directly
contradicting the app's own "fully offline" claims. Fonts are now
bundled locally under `assets/fonts/` instead (SIL OFL, see
`OFL-LICENSE.txt` there). If a genuine enforced allowlist ever matters
here, it needs a `WebViewClient.shouldInterceptRequest()`/
`shouldOverrideUrlLoading()` check — `network-security-config` can't do it.

**Money movement happens through Android's UPI intent system, not
inside this app.** SplitPay builds a `upi://pay?...` link and launches it
via `Intent.ACTION_VIEW` (`launchUpiIntent()` in
`webview/IntentLauncher.kt`); the user's own UPI app then handles authentication
and authorization. SplitPay never sees a UPI PIN, OTP, or bank
credential — it can't, since it isn't a party to that step.

**UPI IDs and amounts are validated twice, independently.**
`app/src/main/assets/js/validator.js` validates in the WebView (fast
feedback, disables bad input before it goes anywhere), and
`UpiLinkBuilder.kt` / `String.isValidUpi()` in
`app/src/main/kotlin/com/splitpay/app/util/Extensions.kt` re-validate
with the same pattern (`^[a-zA-Z0-9.\-_+]+@[a-zA-Z0-9]+$`) before a link
is ever launched natively. The point of the second check is that the JS
side should never be the only thing standing between untrusted input
(a scanned QR, a pasted string) and an intent launch.

**The merchant multi-account QR is a standard UPI link, not a new
protocol.** A SplitPay "Receive mode" QR is `upi://pay?pa=<primary
account>&...&spx=<other accounts, `~`-separated>`. `pa` is a normal,
single UPI ID, so any other UPI app that scans the code pays that one
account exactly as it would any other merchant QR — the extra `spx`
parameter is simply unrecognized and ignored by apps that don't know
about it. `app/src/main/assets/js/upiqr.js` is the single place that
builds and parses this format; it caps the account list at 12, validates
every ID with the same regex as above, de-duplicates case-insensitively,
and cannot be made to emit anything other than validated UPI IDs
regardless of what a scanned QR or pasted string contains — e.g. a
`spx` value containing a script tag or a `javascript:` URL is simply
dropped, not parsed as an account, because every token in `spx` goes
through the same validity check as `pa`. This repository does not yet
have an automated test suite checked in (see CONTRIBUTING.md); if you
add one, `upiqr.js`'s parser is the highest-value place to start, since
it is the one function that turns untrusted scanned/pasted text into
data the rest of the app acts on.

**The JS ↔ Kotlin bridge is a fixed, narrow API, and dialog results are
now correctly round-tripped.** `AndroidBridge.kt` exposes a specific set
of `@JavascriptInterface` methods to the WebView (clipboard, native
share, haptics, opening a UPI intent, showing native dialogs); it does
not expose arbitrary Kotlin reflection or file-system access.
`WebSettings.allowFileAccess = false`, and `mixedContentMode =
MIXED_CONTENT_NEVER_ALLOW`. The bridge only runs against assets bundled
in the APK — SplitPay does not load remote pages into this WebView. A
previous version of `dispatchDialogResult()` double-encoded its
arguments on the way back into JS (an already-quoted callback id and a
pre-stringified boolean both went through `callJs()`'s own quoting a
second time), which meant every native confirm/prompt dialog's actual
answer was silently discarded and only ever resolved — after a 30s
timeout in `bridge.js` — as `false`/`null`. This is now fixed by passing
a real `Boolean` and letting `callJs()`/`runJs()` encode each argument
exactly once; see the Recent Changes section of the README for detail.

**Sharing a file never grants broad storage access.** `shareImage()` and
the receipt-sharing path write only to the app's own `cache/share/` or
`files/receipts/` directories and hand out a single file via
`FileProvider` with `android:grantUriPermissions="true"` scoped to that
one file — see `res/xml/file_paths.xml`, which deliberately does not
expose a `.` (whole external storage) path.

## Known limitations (not vulnerabilities, but worth knowing)

- **A split payment is several independent UPI transactions.** If one
  part fails partway through a sequence, the parts already paid are not
  automatically reversed — this is inherent to splitting a payment into
  multiple UPI transactions, not a bug to patch.
- **SplitPay trusts the device's UPI apps and OS-level UPI intent
  handling** for authentication, PIN entry, and fraud checks; it has no
  visibility into or control over that layer.
- **A merchant multi-account QR is only as trustworthy as the accounts
  the merchant put into it.** SplitPay validates *format*, not
  *ownership* — it cannot verify that a UPI ID actually belongs to the
  merchant presenting the QR, the same way it can't for a plain single
  account UPI QR today.

## Dependencies

The WebView UI has no build-time JS dependency chain to audit — every
file in `app/src/main/assets/js/` is first-party except two vendored,
third-party files:

- `jsQR.min.js` (QR *decoding*, used by `camera.js`) carries a proper
  attribution comment identifying it as jsQR v1.4.0 via jsDelivr —
  provenance is traceable.
- `qrcode.min.js` (QR *encoding*, used by `merchant.js`/`upiqr.js`)
  carries an attribution header identifying it as a build of
  `davidshimjs/qrcodejs` (MIT). A previous version of this file — and of
  this document — had that header missing; it's since been added and
  this note updated to match.

The native app's dependencies are the AndroidX / Material libraries
declared in `app/build.gradle.kts`; keep those current via normal Gradle
dependency updates.
