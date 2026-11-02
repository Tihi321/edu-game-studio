# EGS-57 German role-play fixture and bot (HUB-23)

Copied from the approved hub plan `HUB-23-edu-roleplay-generator/plan.md`, section "EGS-57". On the branch `EGS-39_roleplay-generator` with EGS-39, EGS-55 and EGS-56 (uncommitted, the user forbade commits).

## Task (from the plan)
- **Inputs:** EGS-39, EGS-55 output shape; fixture `hr-a1-greetings` and `de-verbs-a1` as models.
- **Do:** [x] the fixture `de-roleplay-a1` (hr + en, `targetLang: de`); [x] bot runs on it: perfect, wrong (help lines appear, third miss shows the reply, scene ends), random, keyboard-only (umlauts typed). [x] Added to the existing e2e list; `scripts/bot/roleplay.mjs` untouched (no real gap). [x] Docs.
- **Outputs:** [x] fixture, [x] e2e rows, [x] docs, [x] ROADMAP row (EGS-57 done; EGS-58 noted as reserved and not needed unless the live check finds something).
- **Contract:** none new.
- **Acceptance B1:** the German section plays in the real player, all modes, 0 console errors, axe 0.

## Decisions and deviations
- Two units (`u-sein`, `u-cafe`), 7 reused items and one new typed item `rp-u-cafe-1` (tag `scene`, taught, accepted `Tschüss`, `Tschüs`, `Auf Wiedersehen`). Scenes `u-sein-kennenlernen` (11 lines, 4 replies, du), `u-cafe-bestellen` (9 lines, 4 replies, Sie), `finale` (12 lines, 5 replies, du, no `unit`). One `youSay` (`rp.sc.<scene>.<line>.you`) in each of two replies.
- The garden has 12 words, not the 13 the generator's course-wide minimum names: two units at the cap of 6 each cannot reach 13, and the lint has no minimum. All garden items are scene replies, so after the scenes nothing is due and the perfect run does no watering run (`gardenRuns` 0). The e2e case table got `watering: boolean` for that; the bot is unchanged (it waters "until nothing is due").
- No audio, so `clips: false` in the case table; keyboard lower bounds are per case (the short German course makes fewer presses than the Croatian one).
- E2E trim (EGS-45): both fixtures keep one perfect and one keyboard+axe run; only `de-roleplay-a1` also gets wrong and random, because it stands for generated courses. Timeouts of the perfect and keyboard tests raised from 120 s to 240 s (five bots run at once).
- `tests/lint.test.ts`: `de-roleplay-a1` joins the existing "every golden fixture builds and lints end to end with no shell problem" list instead of a new test.
- Not added to `FIXTURE_NAMES` (like `de-verbs-a1`, `de-b2-reading`): those generic suites (mindmaze, rpg) are not meant for it.
- The bot types umlauts with `page.keyboard.type`; the `letter-<char>` buttons are not pressed by any bot mode. Judged not a real gap (the buttons are reachable and axe-checked); documented in `docs/player.md`.
