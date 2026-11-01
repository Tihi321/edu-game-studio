# The broken-detective fixture

A tiny course (3 units, 6 items, one edition `en`) whose detective section (`shells.config.detective`) is wrong on purpose, once per lint code that a real section can reach. Nothing else is wrong with the course. It cannot be built the normal way (the validator refuses the references), so `tests/lint.test.ts` builds it with `force: true`, lints it, and asserts that the build and the lint report each of the codes below.

| Where | What is wrong | Code |
|---|---|---|
| section | `final` names `room-gone`, which is no room | `DET_FINAL_MISSING` (and `UNKNOWN_ROOM` from the validator) |
| chase | neither the challenge of a unit (`unit`) nor the final challenge (`final`) | `DET_FINAL_MISSING` |
| room `room-b` | belongs to the unit `u-nope` | `DET_ROOM_UNIT_MISSING` (and `UNKNOWN_UNIT` from the validator) |
| room `room-loose` | has no unit and is not the final room | `DET_ROOM_UNIT_MISSING` |
| units `u-b`, `u-c` | no escape room | `DET_UNIT_NO_ROOM` |
| room `room-a` | the suspect `s1` of the puzzle has no name | `DET_NAME_MISSING` |
| room `room-a` | a clue item `i-gone` does not exist | `DET_CLUE_ITEM_MISSING` (and `UNKNOWN_ITEM` from the validator) |
| rooms `room-a`, `room-b`, `room-loose` | fewer clue items than the case has clue cards (6) | `DET_TOO_FEW_CLUE_ITEMS` |
| room `room-a` | an alias ("the striped animal") for "zebra", which no item of the room asks about | `DET_ALIAS_NOT_FACT` (warning) |
| chase leg 1 | `decoys: []` | `DET_CHASE_FEW_DECOYS` |
| chase leg 2 | starts at `p-nine`, which is no place (and the trail is at `p-two`) | `DET_CHASE_PLACE_MISSING`, `DET_CHASE_ROUTE_BROKEN` |
| chase leg 2 | its clue item `i-gone` does not exist | `DET_CHASE_ITEM_MISSING` (and `UNKNOWN_ITEM`) |

`DET_PUZZLE_INVALID`, `DET_PUZZLE_NOT_UNIQUE` and `DET_PUZZLE_UNSOLVABLE` cannot be provoked by a section: the generator makes a proved puzzle for every kind, size, band and seed the schema allows (the proof test runs 200 seeds of each). They are covered in `tests/lint.test.ts` with an injected case builder that fails the way `generate()` and `verify()` do.

## Expected problem codes of the forced build

- `UNKNOWN_ITEM`
- `UNKNOWN_UNIT`
- `UNKNOWN_ROOM`

## Expected lint error codes

- `UNKNOWN_ITEM`
- `UNKNOWN_UNIT`
- `UNKNOWN_ROOM`
- `DET_FINAL_MISSING`
- `DET_ROOM_UNIT_MISSING`
- `DET_UNIT_NO_ROOM`
- `DET_NAME_MISSING`
- `DET_CLUE_ITEM_MISSING`
- `DET_TOO_FEW_CLUE_ITEMS`
- `DET_CHASE_PLACE_MISSING`
- `DET_CHASE_ROUTE_BROKEN`
- `DET_CHASE_ITEM_MISSING`
- `DET_CHASE_FEW_DECOYS`

## Expected lint warning codes

- `DET_ALIAS_NOT_FACT`
