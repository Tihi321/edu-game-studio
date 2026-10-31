# Android app from a course (EGS-19)

A built course (`courses/<slug>/build/`) can be wrapped into an Android app with Capacitor. Edu Studio does **not** depend on Capacitor: it writes a separate project folder, `courses/<slug>/android/`, and you install and build that folder yourself. Nothing is downloaded, installed or signed by the generator, and it never makes a keystore.

## Make the project

- MCP: `edu_android_prepare {slug, appId?, sync?}`. The course must be built (`edu_build`). `appId` is an Android application id (default `org.edustudio.<slug>`, with `-` turned into `_`, a leading digit prefixed with `c`, a Java reserved word suffixed with `_app`; a given id is checked and refused when invalid). `sync: true` also runs `npm install` and `npx cap add android` (first time) or `npx cap sync android` in the folder (downloads Capacitor, takes minutes) and reports the tail of each command's output. Default false.
- Script, without an engine: `node scripts/android.mjs <slug | course folder> [--data <dir>] [--app-id <id>] [--sync]`.

The folder holds:

| File | What |
|---|---|
| `package.json` | its own dependencies (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, v8) and the scripts `android:sync`, `android:apk`, `android:bundle`, `android:run` |
| `capacitor.config.json` | `appId`, `appName` (the course title), `webDir: "www"` |
| `www/` | a copy of the build (no source maps, no dot files) |
| `scripts/gradle.mjs` | runs the Gradle wrapper; finds the JDK (`JAVA_HOME`, `java` on PATH, the usual install folders) and the SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, the default folders) and writes `android/local.properties` when it is missing |
| `resources/icon.png`, `splash.png` | from an image asset of the course whose id or file name contains `cover`, else a generated tile with the first letter of the title; put them into the app with `npx @capacitor/assets generate --android` |
| `README.md`, `.gitignore`, `keystore.properties.example` | the exact steps; the keystore and `keystore.properties` are git-ignored |

**Run it again** after a rebuild: `www/`, the config, the scripts and the pictures are refreshed; `android/` (the native project), `node_modules/` and every keystore are left alone.

## Build the app

In the folder: `npm install`, `npx cap add android` (once), `npm run android:run` (device or emulator), `npm run android:apk` (`android/app/build/outputs/apk/release`), `npm run android:bundle` (`.aab`). You need a JDK 17+ and the Android SDK. A release build needs a keystore **you** supply: copy `keystore.properties.example` to `android/keystore.properties`, add a `signingConfigs.release` block to `android/app/build.gradle` that reads it, and build. Edu Studio never creates or commits one.

## The player on a phone

The same player runs in the WebView. For phones and coarse pointers it adds (in `src/player/style/items.css`):

- `viewport-fit=cover` in `index.html` and `env(safe-area-inset-*)` padding on the stage;
- `touch-action: manipulation` on buttons and inputs (no double-tap zoom delay);
- buttons, choices, pills and unit cards at least 44 px high at 560 px and narrower, and on any coarse pointer;
- the hover lift only on devices that can hover.

**The back button** (`src/player/android-back.ts`): inside Capacitor (`window.Capacitor.Plugins.App` present; `@capacitor/app` is not imported) a back press clicks the first of the visible controls `leave`, `back`, `battle-flee`, `to-map`, `to-office` (see the test ids in `player.md`), so it goes one screen back in the current shell; with none on screen it calls `App.exitApp()`. In a normal browser nothing is installed.

## Checks

`tests/android.test.ts` (id sanitiser, generation, idempotence, the tool and its refusals) and `tests/android-mobile.e2e.test.ts` (390x844 with touch: safe-area CSS, 44 px targets, no sideways scroll, a fake `Capacitor.Plugins.App` back button). The autoplay bot also runs at the phone size: `node scripts/play.mjs <build> --mode perfect --viewport 390x844`.

Not covered by tests: a signed release build and a real device.
