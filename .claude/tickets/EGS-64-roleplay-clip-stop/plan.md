# EGS-64 Role-play clip stop, bot-detective timeout, EGS-60 pointer paths

From the HUB-28 discoveries (hub `.claude/tickets/HUB-28-edu-mobile-music/discoveries.md`).

- A role-play line clip no longer plays on when the learner goes to the question, leaves the question or goes to the title (`src/player/shells/roleplay/index.ts`: `stopAudio()` in `title()`, `askTurn()` and its `onLeave`).
- `tests/bot-detective.e2e.test.ts`: the keyboard + axe run takes 105-124 s here, its timeout is 180 s (was 120 s).
- `.claude/tickets/EGS-60-strata-model-discovery/plan.md`: the personal absolute paths are relative (`../creative-hub/...`).

Test: the role-play case of `tests/audio-shells.e2e.test.ts` plays a line clip, goes on to the turn and checks the clip is paused and the music is loud again (fails without the fix).
