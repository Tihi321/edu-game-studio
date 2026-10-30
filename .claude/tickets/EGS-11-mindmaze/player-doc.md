# The MindMaze castle (`mindmaze`): section for `docs/player.md`

Theme `castle` (castle stone and torchlight: Cinzel titles over Alegreya, torch amber, ember). You walk a castle: every unit is a WING of rooms, every door is a question, the characters in the rooms help, every wing hides a key, and the keys open the throne room. Pictures are inline SVG (`art.ts`), no image files; the torch flicker is the only animation and it stops under `prefers-reduced-motion`.

## Screens (`getState().screen`) and test ids

| Screen | What it is | Test ids |
|---|---|---|
| `title` | the kit's title with the castle gatehouse as art | kit ids (`start`, `course-title`, `shell-picker` ...) |
| `castle` | the overview: a mini-map of the castle (towers), the throne room, one card per wing in rows by prerequisite | `castle-title` (h1), `castle-keys` ("Keys: 1 of 3"), `castle-map` (SVG), `wing-map` (the list of rows), `wing-<wingId>` (`data-locked`, `data-stars`, `data-key`, `data-unit`, `data-requires`; `disabled` while sealed), `throne` (`data-locked`, `data-stars`; `disabled` until every wing has its key), `menu` |
| `room` | you stand in a room: name (h1), description, the character, the doors, the torches, the wing's map | `room-name` (h1), `room-desc`, `doors`, `door-<toRoomId>` (`data-state` = `locked` or `open`, `data-key="true"` when the key room lies beyond), `back` (to the room you came from), `to-castle`, `wing-tag`, `torches` (`data-torches`, `data-max`, a flame per torch), `minimap` (SVG: rooms, locked and open doors, you are here), `minimap-list` (the same map as a numbered list), `character-name`, `talk` (shows `character-line`), `hint` (shows `character-hint`), `character-reaction` (after an answer), `notice` (the ghost scene), `take-key` (in the key room) |
| `item`, `feedback` | the kit's `ask()`; context `door` (the hud shows the carved door and the torches) | kit ids, `leave` ("Step back"), `feedback-effect` ("The door swings open." / "Your torch gutters: 2 left." / "Your last torch dies. The castle ghost leads you back ...") |
| `wing-done` | the wing's summary after `take-key`: stars (first-try accuracy of the wing's doors), the key won at 2+ stars or the wing crumbling | `wing-title` (h1), `wing-stars`, `wing-accuracy`, `wing-key` or `wing-crumble`, `wing-unlocked` (the wings this one opened), `throne-open`, `wing-misses` and `miss-<itemId>`, `to-castle`, `retry-wing` (below 3 stars) |
| `throne` | `view.phase` `intro` (`throne-title` h1, `throne-stars`, `throne-begin`, `finish` once crowned, `to-castle`) and `result` (`throne-title`, `throne-stars`, `throne-accuracy`, `throne-lost`, `throne-misses`, `finish` when won, `retry-throne`, `to-castle`); its questions are `item` / `feedback` with context `throne` and round kind `boss` | |
| `end` | the kit's end screen after `finish`, plus `end-keys` | kit ids |

## The door loop (the door IS the question)

- Entering a wing starts a WALK: one run of the shared round logic (`session.startRun`) over the pool of every door of the wing. Each locked door asks the next question of the run from ITS OWN pool (`pickForDoor` in `walk.ts`): a missed question whose gap has passed comes first, then a fresh item of the door, then any fresh item of the wing, and when the run is used up a practice question from the door's own pool (a retry: no stars, half points). A door never has nothing to ask.
- Right: the door swings open and stays open for this walk, you walk through (the feedback's `next` goes to the next room); the character cheers on a streak. Wrong: the feedback explains (the why of the chosen distractor, the answer, the explanation); a torch goes out (`feedback-effect`), the door stays shut and asks a different question next time (the missed one returns after 2-4 others).
- With 0 torches the castle ghost leads you back to the wing's entrance hall and relights the torches (`view.ghost` true, `notice` shown until your next answer or step). The opened doors stay open. You are sent around, never locked out.
- `back` retraces the way you came for free; an open door is walked through without a question (`door-<to>` `data-state="open"`, a check mark).
- The key room has `take-key`: the wing's stars come from the first-try accuracy of the answers of the walk (`session.recordUnit`: 1 star from 50 %, 2 from 70 %, 3 from 90 %). 2+ stars win the key (mastery: the wings of the units that require it unlock). Fewer: "Walk the wing again" (`retry-wing`: a fresh walk, the doors shut again).
- The throne room opens when every wing holds its key. The gauntlet is a boss run (`size` questions, default 8, from every unit's items, misses return); every wrong answer puts a torch out and the last torch is relit at once (the gauntlet is never lost, only harder to earn stars in). 1+ star wins the crown, then `finish` goes to `end`.
- Keyboard: Tab / Enter reach everything; in a room the number keys 1-9 walk through the n-th door. A door's question also has `leave` ("Step back") that returns to the room unanswered.

## `view` (JSON-safe)

- `castle`: `{ wings: [{ id, unit, stars, locked, key, walking }], keys, total, throneOpen, crowned }`
- `room`, `item`, `feedback` of a door: `{ wing, unit, room, entry, keyRoom, torches, maxTorches, trail, open, doors: [{ to, state }], ghost, mood, answered }`
- `wing-done`: `{ wing, stars, key, accuracy, unlocked, misses }`
- `throne`: `{ phase: 'intro' | 'question' | 'result', torches, maxTorches, size, asked, crowned, stars?, accuracy?, misses? }`
- `end`: `{ keys, total, crowned }`

## Debug helpers (`EduEngine.debug.shell`, read-only)

- `route()`: `{ wing, room, found, path, locked, door, state, takeKey }`, the next door on the cheapest way from the room you stand in to the key room (a shut door costs 1, an open door almost nothing, so open doors come first; ties keep the author's order of doors); `door` is the test id to press, `null` in the key room (`takeKey` true) or when no route exists.
- `view()`: the room view above (null outside a walk).
- `maze()`: `{ torches, throne, wings: [{ id, unit, entry, auto, rooms, keys, doors, solvable }] }`, the shape of the castle (`doors` = doors on the shortest route).

## The course section `pack.shells.config.mindmaze` (optional)

```jsonc
{
  "torches": 3,                         // 0-9, default 3; a wrong answer puts one out
  "wings": [{
    "id": "w-sun", "unit": "u-sun-planets", "name": "maze.w.w-sun", "description": "maze.w.w-sun.desc",
    "entry": "sun-hall",
    "rooms": [
      { "id": "sun-hall", "name": "maze.r.sun-hall", "description": "maze.r.sun-hall.desc",
        "character": { "name": "maze.c.sun-hall.name", "line": "maze.c.sun-hall.line", "hint": "maze.c.sun-hall.hint",
                       "right": "maze.c.sun-hall.right", "wrong": "maze.c.sun-hall.wrong", "portrait": "maze-astronomer" },
        "doors": [{ "to": "sun-orrery", "items": ["q-order-mcq", "q-order-card"] }] },
      { "id": "sun-orrery", "name": "...", "objective": "obj-sun", "doors": [...] },
      { "id": "sun-key", "name": "...", "key": true, "asset": "maze-lens-room" }
    ]
  }],
  "throne": { "name": "maze.throne", "description": "maze.throne.desc", "size": 8 }   // size 3-20, default 8
}
```

Every text is a catalog key (names, descriptions, the character's `line` / `hint` / `right` / `wrong`); `portrait` and `asset` name pack assets. A door lists `items` (its question pool); a door with none takes the items of the objective of the room beyond (`objective` on that room). A door is one way: it leads from its room to `to`. The character's `hint` is what `hint` shows for the doors of the room (missing: the hints of the items its shut doors ask); `right` and `wrong` are their reactions (missing: the shell's own). Without a section, or for a unit no authored wing covers, the shell builds the wing itself (`autoWing`): an entrance hall (the gatekeeper), one room per objective that has items (named after the objective's text, characters alternate), galleries when the route would be shorter than 4 doors, a key room, and one side chamber that gives a second route; every door asks the items of the objective of the room beyond. Wings are shown in the order of the units' prerequisites.

## Lint codes

Validator (block the build): `MAZE_WING_UNIT_MISSING`, `MAZE_ENTRY_MISSING`, `MAZE_DOOR_TARGET_MISSING`, `MAZE_DOOR_ITEM_MISSING`, `MAZE_OBJECTIVE_MISSING`, `MAZE_DUPLICATE` (a wing, a room or a door twice). Lint (errors): `MAZE_UNIT_NO_WING` (a unit no authored wing covers; the castle still builds an automatic wing for it), `MAZE_DOOR_NO_ITEMS`, `MAZE_ROOM_UNREACHABLE` (BFS from the entrance), `MAZE_NO_KEY_ROOM`, `MAZE_KEY_UNREACHABLE`, `MAZE_KEY_AT_ENTRY` (no door would ask anything), `MAZE_DEAD_END` (a room from which no key room can be reached). Warnings: `MAZE_DOOR_ITEM_OTHER_UNIT`, `MAZE_TOO_FEW_TORCHES` (under 1). The automatic layout is linted too (a course with the shell enabled and no section). Text keys of the section are checked per edition like the pack's own.

## Bot driver `scripts/bot/mindmaze.mjs`

`maxSteps` = ceil((30 per unit + 4 per throne question) * factor) + 20. The driver adds `summary.maze` = `{ wings: { <wingId>: bestStars }, doors, questions, ghosts, keys, backs, digitDoors, shape }`.

- `perfect`: every wing in prerequisite order to 3 stars (a wing whose unit needs another starts sealed, the throne starts sealed, the torches never drop, no ghost; once per wing it steps `back` through a door it opened and forward again without a question), then the throne gauntlet (`finish`) and the end screen; the review queue ends empty.
- `wrong`: every door of the first wing answered wrong: the torches go out one by one, the last sends the ghost (screen `room`, `view.room` = the entrance, `view.ghost`, the `notice`, the torches relit), the door still asks (`--rounds N` more ghost scenes, default 1 so 2 in all), the review queue fills, no key is won, the other wings and the throne stay sealed. It cannot finish.
- `random`: a seeded learner (`--accuracy`) wins every wing to mastery (2 stars; a wing that crumbles is walked again) and then the crown (a gauntlet that gives no star is faced again), within `maxSteps`.
- `--keyboard`: Tab / Enter reach every control, the number keys walk through the doors (the door you step back through again, and every other open door). `--axe`: runs on `castle`, `room`, `room-key`, `room-ghost` (wrong mode), `wing-done`, `castle-keys`, `castle-after` (wrong mode), `throne-intro`, `throne-result`, `end`, every item kind and every feedback kind.
