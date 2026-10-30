# EGS-15: art, the art-director and the art-critic

Phase 6 of `HUB-19` (`../creative-hub/.claude/tickets/HUB-19-edu-game-studio/plan.md`), first ticket. Branch `EGS-15_art`, stacked on `EGS-08_pipeline` (worktree `edu-game-studio-p3`). One commit. Phase 2 (EGS-05) is restyling `src/renderer/**` and the player's visual layer in the other checkout at the same time, so renderer and player edits stay minimal and are listed in the changelog.

This ticket also lays the **media foundation** that EGS-16 (music) and EGS-17 (voice) build on: the course media settings, the asset manifest of a course, the placeholder rule, how media reaches the pack, the generator fakes, and the bot's media check.

## Goal

The pipeline's `art` hook (recorded `skipped` by EGS-08) becomes real: the art-director plans images for a course, the providers make them, the art-critic checks them with a vision model, post-processing fits them, and they land in the pack with stable ids so the build carries them and `edu_lint` finds no `ASSET_MISSING`. A course whose images could not be made gets labelled placeholders, which are lint warnings (`PLACEHOLDER_ASSET`) until replaced.

## Port from VN Studio (read-only: `../visual-novels-orchestrator`)

EGS-01 left these out because they were bound to VN Studio's book service (see `.claude/tickets/EGS-01-skeleton/plan.md`). Port what art needs, adapted to a course (no `VnService`, no `VnBook`):

- `src/engine/assets/generate.ts` (`generateAsset`, `finishImage`, `removeBackground`, `generateAll`): image kinds only in this ticket, audio branches can stay for EGS-16 to fill, or be ported with it.
- `src/engine/assets/flow-image.ts` (Flow images, only when a course enables Flow).
- the parts of `assets/derive.ts` / `assets/import.ts` that a course needs (framing words, fallback prompts, the import of a hand-made file for `edu_asset_replace`); not the VN scene/character derivation.
- `themes/{emit,pick}.ts` only if the build needs them; the player has its own CSS themes, so likely not: say so in the changelog either way.
- The kept copies (`assets/{postprocess,palettes,manifest}.ts`, `studios/{pixel,draw,pixelate,flow}.ts`, `comfy/*`) stay as they are unless a change is needed; name each change in the changelog.
- Test fakes: `tests/assets-fixtures.ts` from VN Studio (adapted), and use the existing `tests/studio-fakes.ts` and `tests/flow-fakes.ts`; add a ComfyUI fake that returns a real PNG (sharp) if none exists. Port the VN tests that cover ported code (`assets-generate`, `flow-generate`, `studios-generate`, `assets-import` as far as they apply).

## Design

### Settings

- A course's media settings live in `course.md` frontmatter under `media` (parsed with the existing `courseSettingsSchema` pieces in `src/shared/media.ts`: `art`, `music`, `voice`, `sound`; add what a course needs, keep it loose so old files parse). The brief may carry an optional `media` block that `createFromBrief` writes there.
- Defaults: art provider `comfy` (ComfyUI, direct HTTP 8188); RPG tiles and sprites go to Pixel Studio (MCP 7457; built-in pixelate when it is down, with a warning on the asset); **Flow only when the course sets `art.provider: flow`** (never by default; Flow images are free, but nothing Flow is used unless asked).
- `media.art.enabled` (default true) and `media.art.review` (default true): the art-critic runs.

### Files of a course

- Manifest `courses/<slug>/course/assets.json` (the existing `assets/manifest.ts` shape, `projectDir` = `courses/<slug>/course`), files `courses/<slug>/course/assets/<id>/v<n>.<ext>`. The pack's `assets[]` entry points at the selected version (`assets/<id>/v<n>.webp`). If the course loader or build objects to `assets.json` in `course/`, put it next to `course/` instead and say so.
- The art plan `pipeline/art.json`: what the art-director asked for (asset id, kind, target, prompt, alt text, provider, size).
- A placeholder is a real file named `assets/<id>/placeholder.<ext>` (a simple SVG or PNG card for an image) so `PLACEHOLDER_ASSET` flags it; it is replaced as soon as a real version exists.

### Stable asset ids

Derived from what they illustrate, never from a counter: `img-article-<articleId>`, `img-item-<itemId>`, `img-<shell>-<slot>` (for example `img-quiz-arena-bg-u1`, `img-mindmaze-room-u2`, `img-encyclopedia-plate-<articleId>`, `img-rpg-tiles`, `img-rpg-hero`, `img-rpg-npc-<n>`). A rerun of the plan keeps ids and the versions already made; an asset with `locked` or `promptByHand` keeps its prompt.

### What the art-director plans

New role `art-director` (agent + prompt `seed/prompts/art-director/plan.md` + `config/roles.md` + its zod output contract in the style of `edu/authoring.ts`, with a repair round):

- per encyclopedia article: one picture (dual coding: it shows the fact, nothing decorative off-topic);
- per item where a picture helps (the art-director chooses; a flashcard front/back, an item with `asset`); hotspot items that have an asset keep their geometry: their image is a generated illustration fitted to the item's `width` x `height` with the regions drawn faintly by code over it (no text labels: the label is the question);
- per shell in the brief's shells (any shell id; the slots are a table in code): quiz arena backgrounds per unit (and boss), MindMaze castle rooms per unit, encyclopedia plates per article, RPG tiles (a tileset) and sprites (hero, NPCs) through Pixel Studio, in pixel style with a palette. Shells that do not exist in the player yet (EGS-10..14) still get their art; the pack records it in `shells.config[<shell>].art = {slot: assetId}` (any shell id is accepted there).
- With no model answer usable after the repair round, a deterministic fallback plan from the course text (`fallbackPrompt`-style) is used, so the step never blocks the course.

### Making, checking, post-processing

- Generation per asset through `generateAsset` with the course's providers; ComfyUI engines from `config/comfy.md`; sizes per kind (backgrounds 16:9, article pictures 4:3 or 16:9, sprites with background removal, tiles pixelated to the palette).
- Studios go through `svc.comfy({autoStart: true})` / `svc.studios({autoStart: true})`: autostart from the hub's `services.json`, only `pixel-studio`, `chiptune-studio`, `comfyui` (`config/autostart.md`, `EDU_AUTOSTART=0` off; already copied in EGS-01; check it is wired on these job paths and documented). Tests run with autostart off.
- `art-critic` (new role, a vision model: images as `ChatMessage` parts) reviews each new version against its plan line: `{verdict, scores, notes, problems}`; a `revise` regenerates that asset with the critic's note, up to `max_rounds` (`config/quality.md`); the critic is **not** must-pass (a rejected image after the last round stays, with `review.status: rejected` and a note in the status). With `review: false` or no vision model, the check is skipped with the reason.
- Post-process with the copied `postprocess.ts` (fit, webp, sprite trim, pixelate, palettes).

### Pipeline

- Replace the `art` media hook with real steps: `art_plan` (art-director) -> `art_generate` (no model; the generators; per asset or one job for all: your call, but resumable and idempotent: a version already made is not made again) -> `art_review` (art-critic) with its regenerate rounds. Job ids follow EGS-08 (`<slug>--<task>[-k<round>]--all--r<run>`). `music` and `voice` stay skipped hooks in this ticket ("EGS-16" / "EGS-17").
- A provider that is down (after autostart, or with autostart off) must not fail the run: the asset gets its placeholder and a warning, the step finishes, the course builds, lint warns `PLACEHOLDER_ASSET`. A course with placeholders can still publish (warnings are not a gate), and `edu_status` says how many placeholders are left.
- `assemble` merges the media: `pack.assets` (with alt-text keys `asset.<id>.alt` in the catalog), `item.asset` / `article.asset` / `shells.config[*].art` links, from the manifest's selected versions or the placeholders. The polish/re-assemble loop keeps them.
- `restart from: art` must work (add the stage to `STAGES` / the stage map).

### MCP tools (`src/engine/mcp/tools-media.ts` or similar, added to `docs/mcp-guide.md`)

`edu_asset_list {slug}` (entries, selected version, placeholder or not, review status), `edu_asset_plan {slug}` (run the art plan for an existing course, also a hand-made one), `edu_asset_generate {slug, ids?, force?, kind?}` (queues the generation jobs, returns job ids), `edu_asset_set {slug, id, prompt?, negative?, provider?}`, `edu_asset_select {slug, id, version}`, `edu_asset_replace {slug, id, file}` (import a hand-made file; sets `source: custom`, locks it), `edu_asset_lock {slug, id, locked}`. They write the manifest and re-link the pack (so a built course picks it up on the next `edu_build`). `edu_studios_status` keeps working and shows ComfyUI too, or says to use `edu_comfy_status`.

### The bot

`scripts/play.mjs` gets a media check (on by default): every asset URL of `game-data.json` is loaded in the page (an image must decode, audio must reach `canplaythrough` or `loadedmetadata`); failures are `mediaErrors` in the summary and fail the run, like console errors. The player logs `console.error` when an image or audio element fails to load (smallest possible change in the player). `EDU_PLAY_SCRIPT` users keep working.

## Tests (fakes only, autostart off, no network)

- Ported VN tests for the ported code.
- Art plan: the contract, the repair round, the fallback plan, stable ids across two runs, `promptByHand` / `locked` kept.
- Generation with fakes: a ComfyUI image (article picture, a quiz background), a Pixel Studio tile set and sprite (RPG), the built-in pixelate when Pixel Studio is down (warning), a hotspot image with the regions drawn, Flow only when enabled (a test that Flow is never called by default).
- Art-critic: `revise` -> regenerate with the note -> `pass` in round 2; a never-passing critic leaves the image with `rejected` and does not block.
- Pipeline end to end (mock provider, extend `tests/pipeline-helpers.ts` for the new roles; shells `[quiz-arena, rpg]` or similar): published, the pack has every planned image, the build carries the files, `edu_lint` has 0 errors and 0 `PLACEHOLDER_ASSET`; with ComfyUI down the same run publishes with placeholders and lint lists them as warnings only; the real bot (when Chromium launches) plays it with 0 console errors and 0 media errors.
- The MCP tools above, and `restart from: art`.

## Acceptance

`yarn typecheck`, `yarn lint`, `yarn test` pass (counts in the changelog; baseline before this ticket: 52 files, 746 tests). `yarn build` still works. Docs: `docs/mcp-guide.md` (the tools, the art step, providers, placeholders), `README.md`, `ROADMAP.md` (EGS-15 to Done), `config` docs in `seed/config/*.md` where a setting was added. Live generation is not run unless a provider is already running (the orchestrator decides).

## Results

Implemented by the implementer agent, 2026-10-29. Not committed (the orchestrator commits). The changelog is `changelog.md` next to this file.

### Verification (all run, all passing)

| Command | Result |
|---|---|
| `yarn typecheck` | passes (no output) |
| `yarn lint` | passes (no output) |
| `yarn test` | **59 files, 833 tests, all passing** (baseline 52 files, 746 tests: +7 files, +87 tests) |
| `yarn build` | passes |

New test files: `art-plan` (20 tests), `art-pipeline` (15), `art-tools` (8), `assets-generate` (24), `flow-generate` (10), `studios-generate` (5), `assets-import` (5). The real autoplay bot test ran (Chromium launches on this machine): a published RPG course with 10 images is played by the perfect and 75 % learners with 0 console errors and 0 media errors (`media: {checked: true, images: 10, audio: 0}`), and a corrupted image in the build is reported as a media error that fails the run. One run of the full suite (of four) had a single failure in the existing `tests/bot.e2e.test.ts` (`random` on `hr-a1-greetings`: Playwright "element is not stable" on the Next button) under CPU load from parallel test files; it passes alone and in the three other full runs. I lowered the load of my own bot test (one persona at a time) afterwards. If it shows up again, it is the existing bot test under load, not a change of behaviour.

### The plan items

| Item | Status |
|---|---|
| Port `assets/generate.ts` (`generateAsset`, `finishImage`, `removeBackground`, `generateAll`), image kinds | DONE (`src/engine/assets/generate.ts`; audio branches left for EGS-16: skipped with a reason) |
| Port `assets/flow-image.ts` | DONE (no sheet references; used only when a course or an asset asks for Flow) |
| `derive.ts` / `import.ts` parts a course needs | DONE (`import.ts` for `edu_asset_replace`; framing words and fallback prompts became `shared/art.ts` + `edu/art.ts`; VN scene/character derivation not ported) |
| `themes/{emit,pick}.ts` | NOT NEEDED, said so in the changelog (the player has its own CSS themes) |
| Kept copies unchanged unless needed | DONE (only two comments of `assets/manifest.ts` changed) |
| Test fakes: `assets-fixtures.ts`, studio and flow fakes, a ComfyUI fake with a real PNG | DONE (`FakeComfy` already returned real PNGs; it got `down`, a sprite figure and removal modes) |
| Ported VN tests | DONE: `assets-generate`, `flow-generate`, `studios-generate` (Pixel Studio part), `assets-import`, adapted |
| Settings in `course.md` `media`, brief `media`, defaults (comfy, Pixel Studio for RPG, Flow only on request, `art.enabled`, `art.review` default true) | DONE |
| Manifest `course/assets.json`, files `course/assets/<id>/v<n>.<ext>`, `pipeline/art.json`, placeholder files | DONE (the loader, build and lint did not object to `assets.json` in `course/`) |
| Stable asset ids | DONE (`img-article-*`, `img-item-*`, `img-<shell>-<slot>`, a hotspot keeps its asset id) |
| art-director role (agent, prompt, `roles.md`, zod contract, repair round, fallback plan) | DONE |
| Generation, sizes per kind, Pixel Studio / built-in pixelate with a warning, autostart on the job paths | DONE (autostart is requested on the job path only; a test proves status and list tools never ask for it) |
| art-critic (vision, `{verdict, scores, notes, problems}`, regenerate rounds, not must-pass, skipped with the reason) | DONE |
| Post-process with `postprocess.ts` | DONE |
| Pipeline `art_plan` -> `art_generate` -> `art_review`, job ids per EGS-08, `music`/`voice` stay skipped, `restart from: art` | DONE |
| A provider down does not fail the run; placeholder + warning; lint warns; `edu_status` says how many | DONE |
| `assemble` merges the media; polish loop keeps it | DONE |
| MCP tools (7 planned + `edu_media_settings`), `edu_studios_status` / ComfyUI | DONE |
| Bot media check, `mediaErrors`, player `console.error`, `EDU_PLAY_SCRIPT` users keep working | DONE |
| Tests (all bullets of the Tests section) | DONE |
| Docs: `mcp-guide.md`, `README.md`, `ROADMAP.md`, `design.md`, `player.md`, `seed/config/{roles,comfy,studios,quality,autostart}.md` | DONE |
| ROADMAP: EGS-15 moved to Done | DONE |

### Deviations

1. **`edu_media_settings {slug, set?}` added** (not in the plan's tool list): the settings live in `course.md`, which no other tool edits; a hand-made course and the tests need a way to set `art.provider: flow`, `art.enabled`, ...
2. **`src/renderer/ui/roles.ts` (`KNOWN_ROLES`) not updated** (the renderer is restyled elsewhere). `tests/roles-config.test.ts` now says the renderer list equals `ROLES` minus `art-director` and `art-critic`; the Agents page lists them anyway because it merges the roles of `config/roles.md`. Whoever restyles the renderer adds the two roles and restores the equality (also the composer and the voice-director later).
3. **New asset kinds** `illustration` and `tileset` in `ASSET_KINDS` / `IMAGE_KINDS` (the VN kinds `cg`, `cover`, `sheet` stay). New optional fields on `AssetEntry`: `alt`, `style`, `provider`, `fit`, `placeholder`, `review.version`, `review.rounds`.
4. **`art.review` default is now true** (it was false in the copied schema), as the plan says.
5. **`pixel-studio-draw`** (the drawing agent) is not used for courses: the provider is accepted and ComfyUI makes the image, with a warning on the version.
6. **Image sizes**: backgrounds are fitted to 1280x720 (not VN's 1920x1080), article pictures to 960x720, the RPG tile sheet to 512x512 (a 128 px grid), sprites to 384 px tall (a 64 px grid, a whole factor of 6).
7. **Two standalone jobs** (`asset_plan`, `asset_generate`, ids `<slug>--<task>--q<time>--r0`) run the tools' plan and generation; they are not pipeline steps, so they work on a hand-made course.
8. **`edu_asset_replace` takes the file as it is** (no fit or cut-out): what you made is what the player shows.
9. **The critic's score dimensions** are `relevance` and `clarity` (`ROLE_DIMENSIONS['art-critic']`); its model list in `roles.md` uses explicit refs (`gemini/gemini-2.5-flash`, `anthropic/claude-sonnet-4-5`, `lmstudio`) because the alias `gemini` does not resolve when the provider has no key.
10. **The quiz arena does not draw `shells.config['quiz-arena'].art`** (the backdrops): the player's visual layer is out of this ticket's scope. The art is in the pack and the build; EGS-05 or a later ticket draws it.

### What was NOT run (UNTESTED)

- No live ComfyUI, Pixel Studio, Chiptune Studio, Google Flow or flow-music-mcp call, and no real vision model: every test uses fakes (ComfyUI, Pixel Studio, Flow) and the mock provider. The autostart is off in tests, so the real start path of the services on this job path is covered only through the existing `autostart` tests and the spy test that proves the job path asks with `autoStart: true`.
- `yarn dev` (the desktop window) and the Generators/Assets UI (EGS-05) were not opened; nothing in `src/renderer/**` changed.
- No `client/claude-code` run of the art-critic with real image content over MCP (the client-loop test answers the critic's task from its text; images are checked as message parts in the mock run: one image per review).

### For EGS-16 and EGS-17 (the foundation)

- Settings: `parseCourseMedia(...)` and `MediaService.settings(slug)` give the `music`, `voice`, `sound` blocks; the schemas (`resolveMusicProvider`, `resolveSfxEngine`, `resolveVoiceEngine`) are in `src/shared/media.ts`.
- Manifest: the same `course/assets.json`; audio kinds `music`, `sfx`, `ambience` already exist; `MediaService.mergeFor` and `applyMedia` only handle images (`kind: 'image'`): add audio links and `cues` there. `generateAsset` skips the audio kinds with a reason: add the branches next to the image ones (VN's code is in `visual-novels-orchestrator/src/engine/assets/generate.ts`).
- Pipeline: `MEDIA_HOOKS` in `pipeline.ts` holds the `music` and `voice` skipped hooks; replace them like `artFlow` replaced `art`. `STAGE_OF` maps `music` and `voice` to the `art` stage today.
- Placeholders: `writePlaceholder` makes an SVG card; for audio write a short WAV named `placeholder.wav` (the lint matches the file name) and extend `PlaceholderRecord` use in `MediaService`.
- Providers, circuit breaker and fakes: `withCircuit`, `isDownError` (`edu/media.ts`), `makeEduEnv({studios: true})` hands fakes of Pixel Studio, Chiptune Studio and Flow to the engine; the bot already checks audio URLs (`canplaythrough` / `loadedmetadata`).
- `tests/pipeline-helpers.ts` scripts roles by `on(role, ...)`: add `composer` and `voice-director` answers there; `ROLES` in `src/shared/schemas.ts` needs them too (and `PROMPT_VARS`).

### Re-verification (2026-10-30, EGS-17 orchestrator)

The committed tree (40a6b28) checked on its own: typecheck and lint pass, `yarn test` 59 files, 833 tests: 832 pass; the failure is the bot's hr "random 75 %" run, a hover-jitter bug of the player's `.btn` (EGS-03), fixed in the EGS-17 commit. See `changelog.md`.
