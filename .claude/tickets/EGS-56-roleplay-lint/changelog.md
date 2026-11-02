# EGS-56 changelog

- `src/shared/shells/roleplay.ts`: five warnings `RP_REPLY_NO_HELP`, `RP_UNIT_VOCAB_UNUSED`, `RP_SCENE_LENGTH`, `RP_SAY_GIVES_ANSWER`, `RP_REGISTER_MIXED` (in `ROLEPLAY_CODES` and `ROLEPLAY_WARNINGS`); exports `ROLEPLAY_VOCAB_COVERAGE`, `ROLEPLAY_SCENE_LINES` (6 to 14), `ROLEPLAY_SCENE_REPLIES` (2 to 6), `replyAnswerTexts`. The 14 existing codes are unchanged.
- `src/shared/lang/de/register.ts` (new).
- `tests/fixtures/courses/broken-roleplay`: two unused garden words (`w-unused-1`, `w-unused-2`, strings in hr and en); `EXPECTED.md` lists the new warnings. The other three warnings already fire on its short, help-less scenes.
- `tests/lint.test.ts`: the four generated rows work unchanged; one hand-written row for `RP_REGISTER_MIXED` (German only).
- `docs/player.md`: lint code list.

Checked: golden fixtures (solar-system, european-capitals, hr-a1-greetings) lint with no shell problem; `yarn test:e2e tests/bot-roleplay.e2e.test.ts` passes (2 tests).

DONE: the five warnings, fixture rows, lint row, docs. UNTESTED: the warnings on a real generated German course.
