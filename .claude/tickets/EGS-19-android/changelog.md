# EGS-19 changelog: Android via Capacitor

## Changed (repo-relative)

- `src/engine/android/app-id.ts`: package id sanitiser (`appIdFor`, `safeSegment`, `appIdProblem`).
- `src/engine/android/templates.ts`: package.json, capacitor.config.json, scripts/gradle.mjs, README, .gitignore, keystore example.
- `src/engine/android/generate.ts`: `prepareAndroid(courseDir, {slug?, appId?, buildDir?})`, idempotent, never touches `android/`, `node_modules/`, keystores; icon and splash with sharp.
- `src/engine/android/sync.ts`: optional `npm install` + `npx cap add/sync android` through execFile.
- `src/engine/mcp/tools-android.ts` + two lines in `src/engine/mcp/tools.ts`: `edu_android_prepare {slug, appId?, sync?}`.
- `scripts/android.mjs`: CLI entry (`node scripts/android.mjs <slug|folder> [--data] [--app-id] [--sync]`), via tsx.
- `src/player/android-back.ts` (+ one call in `src/player/main.ts`): back button through `window.Capacitor.Plugins.App`, guarded.
- `src/player/style/items.css`: touch-action, safe-area padding, 44 px targets on phones/coarse pointers, hover lift only with hover. (`viewport-fit=cover` was already in `index.html`.)
- `tests/android.test.ts`, `tests/android-mobile.e2e.test.ts`.
- `docs/android.md`, `docs/mcp-guide.md` (one table row).

## Verification

- tsc node/web/player: clean. eslint: clean.
- vitest: android.test.ts (12), android-mobile.e2e.test.ts (2), bot.e2e, bot-rpg.e2e, edu-mcp, edu-cli: 76 passed.
- Builds: player, engine, electron-vite: ok.
- Autoplay bot at `--viewport 390x844`, perfect and random on solar-system and european-capitals, and perfect on solar-system with shells rpg, mindmaze, encyclopedia, detective: ok, no failures.
- Real Capacitor 8 CLI (from the lang-combat checkout's node_modules, read only, junctioned into a temp copy): `cap add android` on the generated folder succeeded.
- Real debug APK: with the JDK 21 on JAVA_HOME and the Android SDK in the default Windows folder (found by the generated `scripts/gradle.mjs` with ANDROID_HOME unset), `node scripts/gradle.mjs assembleDebug --offline` on the generated folder (native project from `cap add android`, lang-combat's node_modules junctioned read-only) built a 5.2 MB `app-debug.apk` whose assets/public holds index.html and game-data.js, appId org.edustudio.solar. Nothing was downloaded (Gradle 8.14.3 and the dependencies were cached). Not installed on a device or emulator.

## Not run

- A signed release, a real device or emulator, `sync: true` with a network `npm install`.
- Bot roleplay shell at phone size: the solar-system fixture is not a language course, so it fails the same way on desktop (unrelated).
