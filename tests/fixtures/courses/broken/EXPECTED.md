# The broken fixture

A small course that is wrong on purpose. It cannot be built the normal way (the validator refuses it), so the tests build it with `force: true` (`yarn engine -- build broken --force`) and then lint it. `tests/lint.test.ts` asserts that the lint reports each of the error codes below, and that the forced build reports exactly the build problem codes below. Nothing is a warning here.

It has one edition (`en`), 12 items, 4 units and 8 objectives. The commented source of each mistake:

| Where | What is wrong | Code |
|---|---|---|
| `i-multi` (mcq) | names two right answers (`answers: [paris, lyon]`) | `ITEM_MULTI_KEY` (and `SCHEMA` from the validator: the item does not fit its kind) |
| `i-multi-tf` | explanation is "TODO write the explanation" | `PLACEHOLDER` |
| `i-dup` (mcq) | two distractors read the same ("Venus", "venus!") | `DISTRACTOR_DUPLICATE` |
| `i-iskey` (multi-select) | a distractor reads like the right option ("Mars", "MARS") | `DISTRACTOR_IS_KEY` |
| `obj-one-form` | both items (`i-one-a`, `i-one-b`) are multiple choice | `OBJECTIVE_ONE_FORM` |
| `i-nokey` (mcq) | the answer `indian` is none of the options | `ITEM_NO_KEY` (and `UNKNOWN_OPTION` from the validator) |
| `i-missing` | the prompt key has no string | `TEXT_MISSING` (the validator's `MISSING_TEXT` at build time) |
| `i-typed-none` (typed) | the answer key has no accepted list | `ACCEPTED_INCOMPLETE` |
| `i-cloze-blank` (cloze) | the accepted entry of the gap is blank | `ACCEPTED_INCOMPLETE` |
| `obj-empty`, `obj-loop-b` | no items | `OBJECTIVE_NO_ITEMS` |
| `u-empty` | no objectives | `UNIT_NO_OBJECTIVES` |
| `u-loop-a`, `u-loop-b` | require each other | `PREREQ_CYCLE`, `UNIT_UNREACHABLE` |
| asset `a-gone` | `assets/gone.png` is not in `course/assets/` | `ASSET_MISSING` (the build's `MISSING_ASSET_FILE`) |

## Expected lint error codes

- `SCHEMA`
- `UNKNOWN_OPTION`
- `ITEM_MULTI_KEY`
- `ITEM_NO_KEY`
- `TEXT_MISSING`
- `ACCEPTED_INCOMPLETE`
- `DISTRACTOR_DUPLICATE`
- `DISTRACTOR_IS_KEY`
- `OBJECTIVE_ONE_FORM`
- `OBJECTIVE_NO_ITEMS`
- `UNIT_NO_OBJECTIVES`
- `PREREQ_CYCLE`
- `UNIT_UNREACHABLE`
- `ASSET_MISSING`
- `PLACEHOLDER`

## Expected problem codes of the forced build

- `SCHEMA`
- `UNKNOWN_OPTION`
- `MISSING_TEXT`
- `MISSING_ASSET_FILE`
