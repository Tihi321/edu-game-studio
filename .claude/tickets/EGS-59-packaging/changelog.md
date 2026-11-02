# EGS-59 packaging: changelog

Request: "build it", read as the Windows installer and exe (packaging was an open ROADMAP row, numbered EGS-20 there; that number belongs to classroom mode, so this is EGS-59). CI from the same row is left open.

## Changes
- `electron-builder@26.15.3` (dev), the same version and layout as VN Studio.
- `electron-builder.config.cjs`: `out/**` (no maps) and `package.json` in app.asar; `seed/`, `themes/`, `build/icon.png` as extraResources (main already reads `resources/seed`, `resources/themes`, `resources/icon.png` when packaged); sharp, `@img`, `@napi-rs` unpacked; NSIS (per-user, choose folder) and portable targets, x64.
- `scripts/make-icons.mjs` + committed `build/icon.png`, `build/icon.ico` (mortarboard on a chalkboard, 16x16 sprite).
- `scripts/verify-package.mjs`: checks the unpacked build, including `out/player` and `out/live` in the archive (the engine walks up from `out/engine` to find them).
- Scripts `dist`, `dist:installer`, `dist:portable`, `dist:dir`, `verify:package`, `icons`; README and ROADMAP updated.
- No engine or app code changed.

## Verified
- `yarn dist` built `release/Edu-Studio-Setup-0.0.1-x64.exe` and `release/Edu-Studio-Portable-0.0.1-x64.exe`; `verify:package` passed (sharp 0.35.5 and keyring load from app.asar.unpacked).
- `release/win-unpacked/Edu Studio.exe` started against a scratch data folder (`EDU_DATA` in `.claude/temp/pkg-smoke`, port 7499): the seed was copied from resources, `engine.ready`, MCP listening.
- The packaged engine (exe as Node, script inside app.asar) imported and built `solar-system`: the player bundle is found inside the archive.
- `yarn typecheck`, `yarn lint`, `yarn test` (518 tests) pass.

## Not verified
- The installer and the portable exe were not run (no install, no uninstall); the studio window was not looked at by a person.
- Signing: electron-builder ran signtool without a certificate, so the exes are not signed (SmartScreen will warn).
- `yarn test:e2e` not run (no shell, player or bot change).
