# Contributing to SplitPay

Thanks for considering a contribution. This is a small WebView-in-Kotlin
app, so most changes only need a browser, not a full Android build — see
below.

## Before you start

- **No LICENSE file exists in this repository yet.** Check with the
  maintainer about the project's license before submitting a
  significant contribution, and don't assume any particular license
  applies until one is added.
- For anything more than a small fix, please open an issue first to
  discuss the approach — especially for anything touching the payment
  flow (`split.js`, `runner.js`) or the QR/UPI format (`upiqr.js`), where
  a design that looks fine can quietly break real UPI apps.

## Getting set up

You don't need Android Studio to work on the UI:

```
cd app/src/main/assets
python3 -m http.server 8000
# open http://localhost:8000/index.html in any browser
```

`bridge.js` detects the absence of `window.AndroidBridge` and falls back
to plain Web APIs, so most flows (Pay, Receive, QR scanning via file
upload, share, copy) work in a desktop browser without any native build.

To build and run the actual Android app you'll need Android Studio (or
the command line with JDK 17) — see the **Building** section in
[README.md](README.md).

## Project conventions

Please follow the patterns already in the codebase rather than
introducing new ones:

- **One IIFE module per concern**, exposing a single global (`Storage`,
  `UpiQr`, `FSM`, ...) rather than scattering globals. Look at
  `storage.js` or `upiqr.js` for the shape.
- **A block comment banner at the top of every JS file** explaining what
  it owns and why, in the existing `═══` style. If you add a file, add
  one.
- **Validation lives in one place.** `validator.js` is the single source
  of truth for what a valid UPI ID or amount looks like in the WebView;
  don't duplicate the regex elsewhere in JS. (The Kotlin side
  intentionally *does* duplicate it — see
  `String.isValidUpi()` in `util/Extensions.kt` — because the native
  layer must never trust the WebView's validation alone. If you change
  the UPI ID pattern, change it in **both** places and say so in the PR.)
- **Escape user-controlled text before it goes into `innerHTML`.** Use
  the existing `esc()` helper (`utils.js`) — see how `merchant.js` and
  `runner.js` build list markup for the pattern to follow.
- **State changes go through `S`** (`state.js`) and screen transitions
  through the `FSM` guard (`statemachine.js`) — don't call `goTo()`
  directly to jump between payment steps; add an explicit FSM transition
  instead so illegal states stay unreachable. (An earlier bug where
  `Back` then `Continue` silently failed was exactly this: a `goTo()`
  call that bypassed the FSM.)
- **Money math stays in whole-rupee integers.** Look at `split.js`
  (`equalSplit`, `randomSplit`) before adding new split logic — parts
  must always sum exactly to the total; floating point is not used for
  amounts anywhere in this codebase.
- **Every `id` in `index.html` must be unique**, even across screens that
  are never visible at the same time. `getElementById()` silently
  resolves to whichever matching element comes first in the document, so
  two screens sharing an id is a real bug, not just messy markup — this
  bit the Receive-mode account counter (`id="m-count"` was reused by an
  unrelated Manual Ledger progress counter that happened to sit earlier
  in the document, so the account counter never visibly updated). Grep
  for an id before reusing one.
- **Don't pre-encode a value before handing it to `callJs()`.**
  `Extensions.kt`'s `WebView.callJs(fn, vararg args)` serializes each
  argument itself — `Boolean`/`Number` become real JS literals, anything
  else gets quoted and escaped as a string via `jsString()`. Passing an
  already-`jsString()`-encoded value (or a hand-built JSON literal) into
  `callJs()` double-encodes it, and the string that arrives in JS won't
  match what the JS side expects. If you've already built a literal
  yourself, call `runJs()` directly instead — see `AndroidBridge.kt`'s
  `showInputDialog()` for the pattern, and the README's Recent Changes
  entry on `dispatchDialogResult()` for what happens when this is missed.
- **No remote resources of any kind** — fonts, scripts, images, API
  calls. Everything the WebView loads ships inside the APK under
  `assets/`. If you need a web font or a JS library, vendor it locally
  (see `assets/fonts/` and `assets/js/jsQR.min.js`/`qrcode.min.js` for
  the pattern, including keeping the license/attribution alongside it)
  rather than linking to a CDN — a previous version of this app linked
  Google Fonts remotely, which silently contradicted its own "fully
  offline" claims.

## Testing your change

There's currently no automated test suite checked into this repository.
Please verify manually before opening a PR, and consider adding tests
under a `tests/` directory if you're touching logic-heavy code:

- **Pure logic** (`upiqr.js`, `validator.js`, `split.js`'s math
  functions) has no DOM dependency and can be unit-tested by loading the
  file with Node's `vm` module — no browser needed. Cover round-trips
  *and* malformed/hostile input (bad percent-encoding, over-length
  fields, values at your stated limits like the 12-account cap).
- **UI flows** are straightforward to drive with a headless browser
  (e.g. Playwright) against the `python3 -m http.server` setup above —
  useful for anything spanning multiple screens (scan → plan → pay →
  receipt).
- **On a real device or emulator**, at minimum check: scanning a QR with
  the camera (not just file upload), the hardware back button at each
  screen, and actually opening at least one real UPI app from the pay
  screen.
- If you change anything in `AndroidManifest.xml`, `network_security_
  config.xml`, or `file_paths.xml`, re-read [SECURITY.md](SECURITY.md)
  first — those files are deliberately narrow and a "helpful" widening
  (e.g. exposing external storage, enabling cleartext traffic) is a
  regression even if it fixes the immediate problem.

## Submitting a change

- Keep PRs focused — one feature or fix per PR is much easier to review
  in a payments-adjacent codebase.
- Describe what you tested and how, including the manual steps above if
  you didn't add automated tests.
- If your change affects the UPI QR format (`upiqr.js`) or anything a
  third-party UPI app might scan, say explicitly which apps (if any) you
  tested against — this app's QR payloads need to keep working for apps
  SplitPay doesn't control.
