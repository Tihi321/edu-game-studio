# EGS-15 changelog

## 2026-10-30: re-verification of the committed tree (EGS-17 run)

The committed tree of `EGS-15_art` commit 40a6b28 was exported (`git archive`) and checked on its own: `yarn typecheck` passes, `yarn lint` passes, `yarn test` 59 files, 833 tests: 832 pass. The one failure is `tests/bot.e2e.test.ts` hr-a1-greetings "random: a seeded 75 % learner" (click on `next` times out: "element is not stable"). It is not caused by this ticket: the pointer rests on the edge of the Next button after the `g-formal-sort` item and the `.btn:hover` lift makes the button jitter forever (a player CSS bug from EGS-03). Fixed in the EGS-17 commit (`src/player/style/theme.css`, a hover area that moves with the button); with it the suite passes in full (EGS-17: 68 files, 969 tests). Nothing else in this ticket needed a fix.

## 2026-10-29: art, the art-director and the art-critic, and the media foundation

Branch `EGS-15_art` (stacked on `EGS-08_pipeline`), one commit `EGS-15: ...`; not pushed.

**Verification (orchestrator re-run):** `yarn typecheck` and `yarn lint` pass; `yarn test` 59 files, 833 tests passing (baseline 52 files, 746 tests). One earlier full run had 1 failure in the existing `tests/bot.e2e.test.ts` random run on `hr-a1-greetings` (the known EGS-04 flake under load); the re-run passed all 833. `yarn build` passes. Details and what was not run: `plan.md` Results. No live provider was running (ComfyUI 8188, Pixel Studio 7457, flow-music-mcp 7462 were down), so live image generation is UNTESTED.

## What changed

### The media foundation (EGS-16 and EGS-17 build on it)

- **Settings**: `src/shared/media.ts` gets `courseMediaSchema` / `parseCourseMedia` (the `art`, `music`, `voice`, `sound` blocks of the existing `courseSettingsSchema`, every field optional). They live in `course.md` frontmatter under `media`. The brief (`src/shared/brief.ts`) takes an optional `media` block (validated with `courseMediaSchema`); `EduService.createFromBrief` writes it to `course.md`. `art.enabled` (new, default true) and `art.review` (default changed from false to true). `resolveRpgPixelProvider` (default `pixel-studio`), `PIXEL_KINDS`, and two new image kinds, `illustration` and `tileset`, in `ASSET_KINDS` / `IMAGE_KINDS`. `AssetEntry` gains `alt`, `style`, `provider`, `fit`, `placeholder` and a richer `review` (`version`, `rounds`).
- **Manifest and files**: `courses/<slug>/course/assets.json` and `course/assets/<id>/v<n>.<ext>` (the loader, the build and the lint did not object to `assets.json` in `course/`, so it stays there). `placeholder.svg` and `custom.<ext>` live in the same folder.
- **Merge into the pack** (`src/engine/edu/media-link.ts`, pure): `pack.assets[]`, the alt text key `asset.<id>.alt` in the source catalog, `article.asset`, `item.asset` / `backAsset`, `shells.config[shell].art = {slot: assetId}`. Used by the assemble step (`AssembleInput.media`) and by `CourseStore.mergeMedia` (the tools re-link a pack on disk). A link is set only when its asset has a file.
- **Placeholders** (`src/engine/assets/placeholder.ts`): a real SVG card `assets/<id>/placeholder.svg`, recorded as `entry.placeholder = {file, reason}`; the lint warns `PLACEHOLDER_ASSET` because of the file name. A version or an import removes it.
- **`MediaService`** (`src/engine/edu/media.ts`, `EduService.media`): settings, manifest (serialised writes per course), the art plan, generation with providers and placeholders, the art-critic round, the pack merge, queue helper for the tools' jobs.
- **Art plan** (`src/shared/art.ts` pure rules: stable ids, slot table per shell, sizes, prompt pieces; `src/engine/edu/art.ts`: the art-director's zod contract, checks, deterministic fallback plan, prompt variables, plan entries).
- **Bot** (`scripts/play.mjs`): media check on by default (`--no-media-check` off): every asset URL of `game-data.json` is loaded in the page, failures are `mediaErrors` (summary also has `media: {checked, images, audio}`) and fail the run. `src/engine/edu/playtest.ts` reads the optional `mediaErrors` (an older `EDU_PLAY_SCRIPT` still works).
- **Fakes** (`tests/`): `edu-helpers.ts` FakeComfy (down flag, a sprite figure on a plain background, removal modes), `makeEduEnv({studios, vision})`; `assets-fixtures.ts`; `pipeline-helpers.ts` scripts the art-director and the art-critic.

### The ports from VN Studio

- `src/engine/assets/generate.ts` (`generateAsset`, `finishImage`, `removeBackground`, `generateAll`): image kinds only; no book, no character sheets; the audio branches (music, sfx, ambience) are left for EGS-16 (`generateAsset` skips them with a reason). `generateAll` takes a `commit` hook so a caller that shares the manifest merges into a fresh copy; `onFailure` lets the caller put a placeholder in.
- `src/engine/assets/flow-image.ts` (Flow images, no references): used only when a course or an asset asks for Flow.
- `src/engine/assets/import.ts`: `edu_asset_replace` takes a file as it is (custom, locked; images and audio extensions checked), no post-processing.
- VN's `derive.ts` (framing words, fallback prompts) became `shared/art.ts` + `edu/art.ts` (the course's fallback plan); VN's scene and character derivation is not ported.
- **`themes/{emit,pick}.ts`: not needed.** The player has its own CSS themes, and the build does not need VN's theme emitter.
- Tests ported and adapted: `assets-generate`, `flow-generate`, `studios-generate` (the Pixel Studio part; the music part comes with EGS-16), `assets-import`.

### The kept copies

- `src/engine/assets/manifest.ts`: only two comments (the paths are now under `course/`).
- `postprocess.ts`, `palettes.ts`, `studios/{pixel,draw,pixelate,flow,config,autostart}.ts`, `comfy/*`: unchanged.
- `studios/draw.ts` (the `pixel-studio-draw` agent) is not used for courses: that provider makes the image with ComfyUI and a warning says so.

### The pipeline

- Stages: `art` is a stage (after `story`); `art_plan` -> `art_generate` -> `art_review` (and `art_generate-k2`, `art_review-k2` ...); `music` and `voice` stay skipped hooks (notes name EGS-16 and EGS-17). `restart from: art` works. `STAGE_FILES.art` clears `art.json` and `reviews/art_review-*` (the manifest and the files stay: a version already made is not made again).
- `art_generate` is one job for all (resumable: the manifest is saved after each asset; idempotent: an asset with a file is skipped).
- A provider that is down, or a picture that fails, gives a placeholder and a note, never a failed run. ComfyUI down is detected once (`withCircuit`): the rest of the run does not retry.
- The art-critic runs only with a vision model (`router.candidates(... visionOnly)`) and `art.review`; the job carries `vision: true`. Not must-pass; rejected after the last round stays, marked.
- `edu_status {slug}` has a `media` block (`images`, `made`, `placeholders`, `rejected`, a note when placeholders are left).
- New standalone jobs `asset_plan` and `asset_generate` (ids `<slug>--<task>--q<time>--r0`) for the tools, so they work on a hand-made course.

### Roles, seed, tools

- `ROLES` gets `art-director` and `art-critic`; `ROLE_DIMENSIONS['art-critic'] = [relevance, clarity]`; agents `art-director-mira-castellan`, `art-critic-felix-ostrander`; prompts `art-director/plan.md`, `art-critic/review.md` (in `PROMPT_VARS`); `config/roles.md` (the critic's list starts with vision models, explicit refs); `config/{comfy,studios,quality,autostart}.md` notes.
- Tools: `edu_asset_list`, `edu_asset_plan`, `edu_asset_generate`, `edu_asset_set`, `edu_asset_select`, `edu_asset_replace`, `edu_asset_lock` (as planned) and `edu_media_settings` (added: read and merge-patch the `media` block, for hand-made courses and tests). `edu_studios_status` says ComfyUI is `edu_comfy_status`.

## Files touched outside `src/engine`, `src/shared/media.ts`, `seed`, `docs`, `tests`

- `src/player/main.ts` (the only player file): one capture-phase `error` listener that `console.error`s an image, audio, video or SVG image that failed to load. No CSS or markup.
- `scripts/play.mjs` (the media check).
- `src/shared/art.ts` (new), `src/shared/brief.ts` (`media`), `src/shared/schemas.ts` (`ROLES`).
- `README.md`, `ROADMAP.md` (docs).
- No file of `src/renderer/**`. `src/renderer/ui/roles.ts` (`KNOWN_ROLES`) was not updated: its two new roles show up in the Agents page anyway (it merges the roles of `config/roles.md`), and `tests/roles-config.test.ts` now checks that the renderer list is `ROLES` minus the art roles.

## Known gaps

- The quiz arena does not draw `shells.config['quiz-arena'].art` (the backdrops) yet: the visual layer is restyled elsewhere (EGS-05). The pack records the art for that and for the shells that do not exist yet.
- Music and voice: skipped hooks, as before.
- Live providers (ComfyUI, Pixel Studio, Flow, a real vision model) were not run.
