# The broken-roleplay fixture

The course of `hr-a1-greetings` (3 units, 30 items, editions `en`, target language `hr`) whose role-play section (`shells.config.roleplay`) is wrong on purpose, once per lint code of the shell. Nothing else is wrong with the course (the two placeholder clips of the original are still warned about). It cannot be built the normal way (the validator refuses the doubled speaker id), so `tests/lint.test.ts` builds it with `force: true`, lints it, and asserts that the build and the lint report each of the codes below. The scenes `sc-*` exist only to be wrong; the first scene (`cafe`) is the golden one.

| Where | What is wrong | Code |
|---|---|---|
| speakers | the speaker `ana` is listed twice | `DUPLICATE_ID` (a validator error: blocks the normal build) |
| section | `finale: "sc-gone"` is not a scene | `RP_FINALE_MISSING` |
| unit `u-polite` | no scene practises it | `RP_UNIT_NO_SCENE` |
| scene `sc-ghost` | belongs to the unit `u-nope`, which the course does not have | `RP_SCENE_UNIT_MISSING` |
| scene `sc-nostart` | its `start` is the line `zz`, which does not exist | `RP_START_MISSING` |
| scene `sc-badnext` | a line goes on to `l9`, which does not exist | `RP_NEXT_MISSING` |
| scene `sc-loop` | `l2` leads back to `l1`: the talk never ends | `RP_NO_END` |
| scene `sc-island` | the line `l3` is on no path from the start | `RP_LINE_UNREACHABLE` |
| scene `sc-badspeaker` | a line is said by `nobody`, who is not a speaker | `RP_SPEAKER_MISSING` |
| scene `sc-badreply` | a turn asks the unknown item `i-nope` | `RP_REPLY_ITEM_MISSING` |
| scene `sc-noreply` | two spoken lines and no turn for the learner | `RP_SCENE_NO_REPLY` |
| garden word `w-ghost` | is watered with the unknown item `i-nope` | `RP_GARDEN_ITEM_MISSING` |
| scene `sc-choices` | level `B2` in an `A1` course | `RP_CEFR_ABOVE_COURSE` (warning) |
| scene `sc-choices` | the line's text exists only in the English catalog | `RP_TEXT_NOT_TARGET` (warning) |
| unit `u-introductions` | every reply of its scenes is a choice: nothing is typed | `RP_REPLY_NOT_PRODUCTION` (warning) |

## Expected problem codes of the forced build

- `DUPLICATE_ID`

## Expected lint error codes

The lint repeats the validator's code and adds its own.

- `DUPLICATE_ID`
- `RP_FINALE_MISSING`
- `RP_UNIT_NO_SCENE`
- `RP_SCENE_UNIT_MISSING`
- `RP_START_MISSING`
- `RP_NEXT_MISSING`
- `RP_NO_END`
- `RP_LINE_UNREACHABLE`
- `RP_SPEAKER_MISSING`
- `RP_REPLY_ITEM_MISSING`
- `RP_SCENE_NO_REPLY`
- `RP_GARDEN_ITEM_MISSING`

## Expected lint warning codes

- `PLACEHOLDER_ASSET`
- `RP_CEFR_ABOVE_COURSE`
- `RP_TEXT_NOT_TARGET`
- `RP_REPLY_NOT_PRODUCTION`
