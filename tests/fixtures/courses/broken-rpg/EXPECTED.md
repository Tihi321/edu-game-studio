# The broken-rpg fixture

The `solar-system` course with a RPG section (`shells.config.rpg`) that is wrong on purpose. It cannot be built the normal way (the validator refuses the unknown unit and item), so `tests/lint.test.ts` builds it with `force: true` and then lints it. The test asserts that the lint reports each of the codes below (the lint repeats the validator's `UNKNOWN_*` problems). Rebuild the folder with `node .claude/temp/rpg-make-broken.mjs` (phase 5 helper, not committed): everything but the section is the golden course.

It has one quiz-arena config and the RPG shell enabled, 3 units (`u-sun-planets`, `u-rocky-giant`, `u-moons-beyond`) and 3 broken areas. Each mistake is in `course/pack.json`, `shells.config.rpg`:

| Where | What is wrong | Code |
|---|---|---|
| `story` | no intro lines (the frame story is empty) | `RPG_NO_STORY` (warning) |
| area `a-ragged`, `map` | the last row is one tile short | `RPG_MAP_RAGGED` |
| area `a-ragged`, `npcs[0]` (`n-mute`) | nobody has `"quest": true`; the person has no lines | `RPG_NO_QUEST_GIVER`, `RPG_DIALOGUE_EMPTY` |
| area `a-ragged`, foe `f-pocket`, boss `b-pocket` | they stand in a pocket walled off from the start | `RPG_MAP_UNREACHABLE` |
| area `a-ragged`, foe `f-empty` | no items: its battle has no questions | `RPG_FOE_NO_ITEMS` |
| area `a-ragged`, foe `f-other` | asks `q-types-mcq`, an item of the unit `u-rocky-giant` | `RPG_FOE_ITEM_OTHER_UNIT` (warning) |
| area `a-ragged`, foe `f-ghost` | asks `q-ghost`, which does not exist: nothing can be asked | `RPG_FOE_ITEM_MISSING`, `RPG_QUEST_UNWINNABLE` (and `UNKNOWN_ITEM` from the validator) |
| area `a-nostart`, `map` | no `@` start tile | `RPG_MAP_NO_START` |
| area `a-nostart`, `npcs[0]` (`n-wall`) | the quest giver stands on a wall | `RPG_SPOT_BLOCKED` |
| area `a-ghost`, `unit` | names `u-nowhere` | `RPG_AREA_UNIT_MISSING` (and `UNKNOWN_UNIT` from the validator) |
| unit `u-moons-beyond` | no area covers it | `RPG_UNIT_NO_AREA` |

## Expected problem codes of the forced build

- `UNKNOWN_ITEM`
- `UNKNOWN_UNIT`

## Expected lint error codes

- `RPG_AREA_UNIT_MISSING`
- `RPG_DIALOGUE_EMPTY`
- `RPG_FOE_ITEM_MISSING`
- `RPG_FOE_NO_ITEMS`
- `RPG_MAP_NO_START`
- `RPG_MAP_RAGGED`
- `RPG_MAP_UNREACHABLE`
- `RPG_NO_QUEST_GIVER`
- `RPG_QUEST_UNWINNABLE`
- `RPG_SPOT_BLOCKED`
- `RPG_UNIT_NO_AREA`
- `UNKNOWN_ITEM`
- `UNKNOWN_UNIT`

## Expected lint warning codes

- `RPG_FOE_ITEM_OTHER_UNIT`
- `RPG_NO_STORY`
