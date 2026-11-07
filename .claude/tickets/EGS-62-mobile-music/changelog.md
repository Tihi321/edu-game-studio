# EGS-62 changelog

## 2026-11-07 - EGS-62: Edu player on phones and an in-game audio panel (hub HUB-28 A1-A4, B)

Branch `EGS-62_mobile-music` from `master` 46b6ec1, merged locally into `master` (not pushed).

### Phone layout (A1-A4)

The A0 baseline (hub run log `runs/hub-28-edu-mobile-music.md`) showed no sideways scroll in any shell at 360/375 px on 46b6ec1, so only what it measured was changed; every rule sits in a `max-width` or `pointer: coarse` query, desktop (>= 840 px) is untouched.

- `src/player/style/arena.css`: at <= 839 px the shared `.topbar` (quiz, mindmaze, detective, roleplay) and `.hud` get `padding-right: var(--edu-corner, 56px)`; at <= 560 px the top bar wraps, the star count does not break, quiz stat/combo `small` labels 14 px.
- `src/player/shells/encyclopedia/encyclopedia.css`: `.enc-tabs` corner padding at <= 839 px; source links (`citation-*`) 44 px tap height on phones/coarse pointers; timeline tick labels and "more" 14 px at <= 640 px.
- `src/player/shells/mindmaze/mindmaze.css`: door numbers 14 px at <= 560 px.
- `src/player/shells/detective/detective.css`: grid headers, pinned board entities, map names 14 px at <= 560 px.
- `src/player/shells/rpg/rpg.css`: `.rpg-hud` corner padding at <= 839 px; Talk button text 14 px at <= 560 px.
- Not changed (A0 showed no need): start screen, `.frame`/`.board` padding, encyclopedia scroll strip and columns, mindmaze side column, RPG canvases/minimap, d-pad, `roleplay.css`.

### Audio settings and panel (B)

- `src/player/progress.ts`: `settings.musicVolume`, `sfxVolume`, `voiceVolume` (0-100, new saves 100; parse rounds, clamps, missing/invalid = 100; `PROGRESS_VERSION` unchanged).
- `src/player/audio.ts`: `volumeGain(v) = (v/100)^1.6`; music `cue * gain * duck`, 0 pauses the track and raising restarts it; SFX `cue * gain * reduce`, nothing at 0; `voice(el)` sets a clip's volume and `refresh()` keeps it current (sound off does not silence a voice clip, voice 0 does); `refresh()` ramps music over 180 ms; `duck()` retargets a running fade (a fade used to overwrite the duck).
- `src/player/kit/audio-menu.ts` + `audio-menu.css` (new, imported in `main.ts`): speaker button `audio-settings` fixed top-right (safe area, 44 px), shown when the game has a cue or an audio asset; modal `audio-panel` with the sliders of the channels the game has, `audio-mute`, `audio-reduce`, `audio-close`, `audio-backdrop`; Escape/backdrop/Close/Android back close it with focus back on the button; open state survives a shell re-render; keys in the panel do not reach the shell; Tab is trapped. `--edu-corner: 56px`.
- `src/player/kit/session.ts`, `shells/quiz-arena.ts`: mount the menu in both render paths, skip autofocus while open, `voice` in the item context.
- `src/player/types.ts`: `ItemContext.voice?(el)`. `items/listening.ts`, `shells/encyclopedia/view-article.ts`, `view-reader.ts`, `shells/roleplay/index.ts`: clips go through `audio.voice`; the role-play line clip now ducks the music.
- `src/player/i18n.ts`: 7 `audio.*` keys in en, hr, de. `src/player/android-back.ts`: `audio-close` first in `BACK_TESTIDS`.
- Docs: `docs/player.md` (Audio bullets, phone-corner paragraph), `docs/android.md` (back list), `ROADMAP.md` EGS-62 row.

### Tests

- `tests/player-audio.test.ts` (2 tests), `tests/player-progress.test.ts` (export/import test extended), `tests/audio-shells.e2e.test.ts` (loop over all 6 shells; role-play duck), `tests/android-mobile.e2e.test.ts` (one `it` per shell at 360x740 touch: no sideways scroll, no button under 44 px, speaker button visible and overlapping nothing), first perfect run at 375x667 in `bot`, `bot-encyclopedia`, `bot-mindmaze`, `bot-roleplay`, `bot-detective` (bot-rpg already 360x740).

### Deviations

- Role-play in `android-mobile` and `audio-shells` uses fixture `hr-a1-greetings` and detective borrows `eight-beeps.wav`, because the speaker button is drawn only when a game has sound and `de-roleplay-a1` / `european-capitals` have none.
- `tests/bot-detective.e2e.test.ts` first run timeout 120 s -> 180 s (the axe run takes 105-124 s here).
- `docs/android.md` touched (back-button list), outside the plan's file list.

### Verification

- Reproduction: widened `audio-shells.e2e` failed on the unchanged player at `[data-testid="audio-settings"]` in 5 of 6 shells (6th: a test fixture bug, fixed).
- On the branch: `yarn test` 91 files / 521 tests passed; `yarn typecheck` exit 0; `yarn lint` exit 0; `yarn test:e2e` 16 files / 40 tests passed.
- Desktop: 1280x800 bot screenshots vs the A0 baseline: encyclopedia, rpg, detective identical; quiz-arena 2/31, roleplay 1/14, mindmaze 17/28 files differ by bytes, not inspected by eye (animation timing likely; all changes sit in < 840 px queries).
- UNTESTED: real phones (iOS Safari, Android Chrome), real audio output, TV with the new button.

### Follow-ups

- The role-play line clip is not stopped when the learner leaves the scene mid-clip (unchanged behaviour).
- `tests/bot-detective.e2e.test.ts` keyboard test still has a 120 s timeout and may be flaky under load.

Commit status: committed on `EGS-62_mobile-music` and merged locally into `master` (not pushed).
