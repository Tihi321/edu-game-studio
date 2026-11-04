# EGS-60 changelog

## 2026-11-04 EGS-60: Edu Studio follows whichever model Strata runs (hub HUB-26, T2)

Branch `EGS-60_strata-model-discovery`, from `master`. Replay of VNO-60 (commit 9d0d173). Committed on that branch; not pushed, not merged.

Behaviour: `strata/default` and `strata/default-low` are `loaded` rows. The engine asks Strata which model it serves, applies the matching `profiles` entry to those rows in place, shows `Strata: <model>` in the Models page and follows a model switch within one status check (10 s). The old ids resolve through `aliases`.

### Files changed

`src/shared/{schemas,protocol}.ts` (schemas: `loaded`, `aliases`, `json_schema`, `profiles`; defaults `strata/default`), `src/engine/models/{registry,router,openaiCompat,types}.ts`, `src/engine/{summary,engine}.ts`, `src/engine/queue/scheduler.ts` (spend event only), `src/engine/store/seedMigrations.ts`, `src/renderer/ui/ModelsPage.tsx`, `seed/config/{providers,roles,settings}.md`, `tests/{models,seed-migrations,custom-providers,roles-config}.test.ts`, `ROADMAP.md`, this folder.

### Same as VNO-60

Three `SEED_MIGRATIONS` entries (`strata-loaded-v1`, `-roles-v1`, `-settings-v1`); `syncServerSlots` returns `{ slots, served }`; `thinking`, `followsServer`, `served` summary fields; the spend table is unchanged (the `spend` event carries `served`); the catalog lists nothing for a provider with `loaded` rows.

### Differences from VNO-60

- The ModelsPage hunks and `schemas.ts` defaults were applied by hand (line context differs; store hook is `useEdu`).
- `seed/config/roles.md` (Edu): the roles are `researcher` and `fact-checker` (not `edition-aligner`); the rationale line "Strata (a model family different from the paid writers, and free)" now says that holds for Qwen only, and `providers.md` `## Strata` says the same. The Strata section keeps Edu's `<your Strata folder>` placeholder.
- `tests/roles-config.test.ts` also needed `strata/default-low`; the three recorded-migration lists keep Edu's extra `roles-scene-writer-v1`. The older `default_strata_model` fallbacks in `seedMigrations.ts` (legacy settings) still name `strata/qwen3.8-flash-next`; the settings migration renames them afterwards.

### Verification

- `yarn typecheck`: no errors. `yarn lint`: no output. `yarn test`: 91 files, 519 tests, all passed.
- AC-5: grep for `run-iq2_xs`, `coder-iq1_m`, `84 GB`, `Qwen3.8-Flash-Next server`, `server for Qwen3.8` over `seed/config`: no hit.

### Not run

Nothing against a running Strata; no app started; no user data (`~\EduGames`) touched; the Models page labels were typechecked, not looked at.

## Polish (checker findings)

- `resolve()` now also maps an alias whose fallback row still names an old ref of a `loaded` row (`strata/qwen3.8-flash-next`) to the row (`strata/default`), as Scriptorium does, so the shared-order list holds `strata/default` once. One assertion added to the existing AC-1 Strata test; it failed before the fix and passes after.
