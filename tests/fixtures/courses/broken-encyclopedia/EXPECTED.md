# The broken-encyclopedia fixture

A tiny course (3 units, 6 items, 3 articles, one edition `en`, one audio asset) whose encyclopedia section (`shells.config.encyclopedia`) is wrong on purpose, once per code of the shell. Nothing else is wrong with the course. It cannot be built the normal way (the validator refuses the section), so `tests/encyclopedia-lint.test.ts` builds it with `force: true` and then lints it, and asserts that the build and the lint report **exactly** the codes below.

| Where | What is wrong | Code |
|---|---|---|
| hunt `h-b` (second one) | the hunt id is used twice | `DUPLICATE_ID` (validator) |
| hunt `h-ghost` | belongs to the unit `u-nope`, which the course does not have | `UNKNOWN_UNIT` (validator) |
| hunt `h-b` (second one), step `s-b2` | the collectible name `enc.step.nope` has no string | `MISSING_TEXT` at build time, `TEXT_MISSING` in the lint |
| hunt `h-a`, step `s-a2` | sends the learner to the article `art-nope` | `ENC_HUNT_TARGET_MISSING` |
| hunt `h-a`, step `s-a3` | asks the item `i-nope` | `ENC_HUNT_ITEM_MISSING` |
| hunt `h-a`, step `s-a4` | asks `i-a1` again (step `s-a1` asked it already) | `ENC_HUNT_ITEM_DUPLICATE` |
| hunt `h-empty` | has no steps | `ENC_HUNT_EMPTY` |
| unit `u-c` | no hunt covers it | `ENC_UNIT_NO_HUNT` |
| timeline event `t-gone` | opens the article `art-nope` | `ENC_TIMELINE_ARTICLE_MISSING` |
| map | its asset `aud-sound` is audio | `ENC_MAP_NO_IMAGE` |
| map place `p-gone` | opens the article `art-nope` | `ENC_MAP_ARTICLE_MISSING` |
| map place `p-out` | sits at (500, 20) on a 100 x 100 image | `ENC_MAP_PLACE_OUTSIDE` |
| hunt `h-a`, step `s-a5` | asks `i-b1`, an item of the unit `u-b`, in a hunt of `u-a` | `ENC_HUNT_ITEM_OTHER_UNIT` (warning) |
| hunt `h-a`, step `s-a5` | the right answer of `i-b1` ("A cat") is not in the article `art-a` | `ENC_ANSWER_NOT_IN_ARTICLE` (warning) |
| hunt `h-ghost`, step `s-g1` | asks `i-a2`, an item of the unit `u-a`, in a hunt of `u-nope` | `ENC_HUNT_ITEM_OTHER_UNIT` (warning, again) |

## Expected problem codes of the forced build

- `DUPLICATE_ID`
- `UNKNOWN_UNIT`
- `MISSING_TEXT`

## Expected lint error codes

The lint repeats the validator's codes (a missing string is `TEXT_MISSING` there) and adds its own.

- `DUPLICATE_ID`
- `UNKNOWN_UNIT`
- `TEXT_MISSING`
- `ENC_HUNT_TARGET_MISSING`
- `ENC_HUNT_ITEM_MISSING`
- `ENC_HUNT_ITEM_DUPLICATE`
- `ENC_HUNT_EMPTY`
- `ENC_UNIT_NO_HUNT`
- `ENC_TIMELINE_ARTICLE_MISSING`
- `ENC_MAP_NO_IMAGE`
- `ENC_MAP_ARTICLE_MISSING`
- `ENC_MAP_PLACE_OUTSIDE`

## Expected lint warning codes

- `ENC_HUNT_ITEM_OTHER_UNIT`
- `ENC_ANSWER_NOT_IN_ARTICLE`
