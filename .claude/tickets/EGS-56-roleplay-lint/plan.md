# EGS-56 role-play lint additions (HUB-23)

Copied from the approved hub plan `HUB-23-edu-roleplay-generator/plan.md`, section "EGS-56". On the branch `EGS-39_roleplay-generator` with EGS-39 (uncommitted, the user forbade commits).

## Task (from the plan)
- **Inputs:** research "Reply checking" and the current 14 `RP_*` codes.
- **Do:** [x] add warnings only (they never fail an existing course): `RP_REPLY_NO_HELP`, `RP_UNIT_VOCAB_UNUSED` (threshold `ROLEPLAY_VOCAB_COVERAGE`, shared with EGS-39), `RP_SCENE_LENGTH` (outside 6 to 14 lines or 2 to 6 replies), `RP_SAY_GIVES_ANSWER`, `RP_REGISTER_MIXED` (du and Sie in one scene, German courses only).
- **Outputs:** [x] code in `src/shared/shells/roleplay.ts`, fixture rows in `tests/fixtures/courses/broken-roleplay` and its `EXPECTED.md`, [x] the lint table (`tests/lint.test.ts`: the four codes the Croatian fixture can show are generated rows; `RP_REGISTER_MIXED` is one hand-written row because it is German-only), [x] `docs/player.md`.
- **Contract:** the five codes; no change to the 14 existing codes.

## Decisions and deviations
- The pack carries no unit scope, so `RP_UNIT_VOCAB_UNUSED` uses the unit's garden words (the garden is the unit's vocabulary: each word names an item, the item names its unit). It fires when fewer than `ROLEPLAY_VOCAB_COVERAGE` of them appear in the unit's scenes, only for units with at least two garden words.
- `RP_SAY_GIVES_ANSWER` ignores a `listen` line (a dictation: the learner types what was heard); the golden `hr-a1-greetings` has one.
- The words are compared with `normalizeText(..., { fold: true })`; the answer texts come from typed `accepted`, the right mcq option and cloze gaps.
- New `src/shared/lang/de/register.ts` (`registerOf`) finds `du` and `Sie`; it is conservative (a capital `Sie` at the start of a sentence is ignored).
