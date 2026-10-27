# The Android apps

## The display app (instead of Fully Kiosk)

`android/` is a tiny app (`party.froghub`, minSdk 22, so it runs on Fire OS 5): a full-screen WebView that

- keeps the screen on and plays sound without a tap;
- gives the microphone to Frog Hub's own site only, and stays on that site;
- retries every 10 seconds when the server can't be reached;
- never closes on Back.

**Five quick taps in the top-left corner** open its settings (address, open on startup, exit). It asks for Frog Hub's
address on first start, or set it over adb:

```sh
adb shell am start -n party.froghub/.MainActivity -e url https://froghub.example
```

Debug it with `chrome://inspect` over adb.

### Old Fire tablets and Let's Encrypt

Fire OS 5 doesn't trust Let's Encrypt's root certificates (ISRG Root X1 and X2), so its WebView refuses sites that use
them and shows a black page. The app bundles both roots (`res/raw/`) and, when the only error is "untrusted", checks
the site again itself (`IsrgTrust.java`: the full chain against those roots, the hostname, and the same certificate)
before going ahead.

Its WebView is Chrome 59, which has no ES modules, so `vite.config.js` also builds a legacy version for Chrome 59.

### Building it

Ready-built copies of both apps are on the [latest release](https://github.com/froghub-assistant/froghub/releases/latest),
built by `.github/workflows/android.yml` whenever `android/`, `android-full/` or `android-admin/` changes, and signed with Frog Hub's
release key so each one installs over the last.

To build it yourself, use `android/build.sh` on an x86 computer with the Android SDK (its build tools don't run on
ARM). It signs with that computer's debug key (or `KEYSTORE` and `KS_PASS`), so updates built there install over the
old one, but not over a release copy: Android only updates an app signed with the same key, so uninstall first to
switch.

## The full display app

`android-full/` builds `froghub-full.apk` (`party.froghub.full`, so it installs alongside the other one): the same
app, but showing the page in [GeckoView](https://mozilla.github.io/geckoview/), Firefox's engine, bundled in the
APK, instead of the tablet's own WebView. On an old tablet that means a modern engine: Sendspin works (no need for
the DLNA speaker), and so does anything else newer than Chrome 59. GeckoView also has its own root certificates, so
Let's Encrypt just works.

- It uses **GeckoView 143**, the last version for Android 5 and 6 (later ones need Android 8). It gets no more
  security fixes, which is why it stays on Frog Hub's own site and Home Assistant's login page, as the WebView app
  does.
- It's about 80 MB bigger (32-bit ARM only, as on Fire tablets), and on a 1 GB tablet it takes a few seconds longer
  to start.
- All but one class are shared with `android/`: `DisplayActivity.java` (the screen, its settings, the DLNA speaker)
  is the base of both `MainActivity.java` (WebView) and `android-full/src/.../GeckoActivity.java`. The page's
  `window.FrogHubApp` comes from a built-in extension (`android-full/assets/bridge/`) that passes calls on to
  `GeckoActivity` over native messaging, and only on Frog Hub's own page.
- Debug it from Firefox on a computer: `about:debugging`, over adb.

It's built with Gradle (GeckoView comes from Mozilla's Maven repository, with dependencies): the same workflow builds
it with the others, at the same version as `android/`, onto the same release. To build it yourself:
`gradle -p android-full assembleRelease` (Gradle 8.14, JDK 17, the Android SDK).

## The admin app

`android-admin/` wraps [the admin page](/guide/grown-ups#the-admin-page) as a phone app (`party.froghub.admin`,
minSdk 22 = Android 5.1), with the same Let's Encrypt check. It asks for the site on first start.
[Download it](https://github.com/froghub-assistant/froghub/releases/latest/download/froghub-admin.apk), or build it
like the display app, with `android-admin/build.sh`.
