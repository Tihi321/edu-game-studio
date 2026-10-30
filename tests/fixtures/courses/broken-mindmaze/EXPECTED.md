# The broken-mindmaze fixture

A tiny course (5 units, 10 items, one edition `en`) whose MindMaze castle section (`shells.config.mindmaze`) is wrong on purpose, once per lint code of the shell. Nothing else is wrong with the course. It cannot be built the normal way (the validator refuses the section), so `tests/mindmaze-lint.test.ts` builds it with `force: true` and then lints it, and asserts that the build and the lint report **exactly** the codes below.

| Where | What is wrong | Code |
|---|---|---|
| wing `w-ghost` | belongs to the unit `u-nope`, which the course does not have | `MAZE_WING_UNIT_MISSING` |
| wing `w-f` | its entrance `nowhere` is not a room | `MAZE_ENTRY_MISSING` |
| wing `w-f`, room `f-hall` | a door leads to `f-gone`, which is not a room | `MAZE_DOOR_TARGET_MISSING` |
| wing `w-f`, room `f-hall` | a door asks the unknown item `i-nope` | `MAZE_DOOR_ITEM_MISSING` |
| wing `w-f`, room `f-two` | stands for the unknown objective `o-nope` | `MAZE_OBJECTIVE_MISSING` |
| wing `w-f` | two rooms are called `f-two` | `MAZE_DUPLICATE` |
| unit `u-c` | no wing covers it | `MAZE_UNIT_NO_WING` |
| wing `w-a`, room `a-hall` | the door to `a-empty` lists no items and the room has no objective | `MAZE_DOOR_NO_ITEMS` |
| wing `w-a`, room `a-island` | nothing leads to it | `MAZE_ROOM_UNREACHABLE` |
| wing `w-a`, room `a-trap` | a room you can walk into with no door out and no key | `MAZE_DEAD_END` |
| wing `w-b` | no room has `key: true` | `MAZE_NO_KEY_ROOM` |
| wing `w-d` | the key lies in the entrance hall, so no door would ask anything | `MAZE_KEY_AT_ENTRY` |
| wing `w-e` | the key room `e-key` cannot be reached | `MAZE_KEY_UNREACHABLE` |
| wing `w-a`, room `a-mid` | the door asks `i-b1`, an item of the unit `u-b` | `MAZE_DOOR_ITEM_OTHER_UNIT` (warning) |
| section | `torches: 0` | `MAZE_TOO_FEW_TORCHES` (warning) |

## Expected problem codes of the forced build

- `MAZE_WING_UNIT_MISSING`
- `MAZE_ENTRY_MISSING`
- `MAZE_DOOR_TARGET_MISSING`
- `MAZE_DOOR_ITEM_MISSING`
- `MAZE_OBJECTIVE_MISSING`
- `MAZE_DUPLICATE`

## Expected lint error codes

The lint repeats the validator's codes and adds its own.

- `MAZE_WING_UNIT_MISSING`
- `MAZE_ENTRY_MISSING`
- `MAZE_DOOR_TARGET_MISSING`
- `MAZE_DOOR_ITEM_MISSING`
- `MAZE_OBJECTIVE_MISSING`
- `MAZE_DUPLICATE`
- `MAZE_UNIT_NO_WING`
- `MAZE_DOOR_NO_ITEMS`
- `MAZE_ROOM_UNREACHABLE`
- `MAZE_NO_KEY_ROOM`
- `MAZE_KEY_UNREACHABLE`
- `MAZE_KEY_AT_ENTRY`
- `MAZE_DEAD_END`

## Expected lint warning codes

- `MAZE_DOOR_ITEM_OTHER_UNIT`
- `MAZE_TOO_FEW_TORCHES`
