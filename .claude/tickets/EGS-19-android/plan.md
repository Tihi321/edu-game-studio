# EGS-19: Android via Capacitor

Scope (narrow reading): Edu Studio gains NO Capacitor dependency. It generates a separate project folder `courses/<slug>/android/` from a built course; the user installs and builds it.

1. `src/engine/android/` (pure, no network): `app-id.ts` (package id sanitiser), `generate.ts` (writes package.json, capacitor.config.json, www/, scripts/gradle.mjs, resources/icon.png + splash.png via sharp, README.md, .gitignore, keystore.properties.example; idempotent: never touches `android/`, `node_modules/`, keystores), `sync.ts` (npm install, cap add/sync through execFile).
2. MCP `edu_android_prepare {slug, appId?, sync?}` in `src/engine/mcp/tools-android.ts`, one line in tools.ts. CLI `scripts/android.mjs`.
3. Player: touch-action, safe-area padding, 44 px targets on phones, hover only where a hover exists, Android back button bridge (`window.Capacitor.Plugins.App`, guarded) in `src/player/android-back.ts`.
4. Tests: app-id, generation, MCP refusals, e2e mobile (390x844, touch).
5. Docs: docs/android.md, mcp-guide pointer. Real toolchain only as far as JDK + SDK are present (nothing downloaded).
