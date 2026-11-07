# EGS-62 Edu player on phones and an in-game audio panel (Edu Studio)

Branch `EGS-62_mobile-music` (from `master`). From hub HUB-28, tasks A1-A4 (phone layout of the six shells and the start screen) and B (audio settings and panel).

The plan is `../creative-hub/.claude/tickets/HUB-28-edu-mobile-music/plan.md`: sections "Scope" 1-2, "Audio settings contract" and "Tasks for workers" A and B; research in `research.md` next to it. The VN reference is `../visual-novels-orchestrator/src/engine/game/player-runtime.ts:236-258, 2400-2444, 4248-4275`.

## Checklist

- [x] B: `GameAudio` volume channels and the gain curve `volumeGain` (`src/player/audio.ts`), `voice(el)`, music at 0 stops the track
- [x] B: `musicVolume`, `sfxVolume`, `voiceVolume` in `progress.settings` (default 100, clamped parse) (`src/player/progress.ts`)
- [x] B: `kit/audio-menu.ts` + `.css`: speaker button `audio-settings` and panel `audio-panel`, mounted by `ShellSession.render` and the arena's `go()`
- [x] B: voice clips routed through `audio.voice` (listening, encyclopedia article and reader, role-play); the role-play clip ducks the music
- [x] B: i18n keys in en, hr, de; `audio-close` first in `BACK_TESTIDS`; `--edu-corner`
- [x] B: tests: `player-audio` (2), `player-progress` (extended), `audio-shells.e2e` (6 shells); `docs/player.md`
- [x] A1-A4: phone layout (shell CSS, bot runs at 375x667, `android-mobile.e2e`)
- [x] Local merge to `master`, not pushed (the hub run does it)

The changelog is written at the end of the run.
