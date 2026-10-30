# Golden course fixtures

Three hand-written courses in the course contract (`src/shared/course.ts`). Tests, the validator, the player runtime (EGS-03) and the autoplay bot (EGS-04) all use them. Each has a `course/pack.json`, a `course/text/<lang>.json` per language and `course/assets/`. `yarn test` proves all of them validate with 0 problems (`tests/edu-course.test.ts`).

| Fixture | Languages | What it shows |
|---|---|---|
| `solar-system/` | en and hr editions (source en) | 3 units in a prerequisite chain (The Sun and the planets, Rocky and giant planets, Moons and beyond), 9 objectives, 28 items using all 13 item kinds, every objective asked in two or more forms, a misconception explanation (`why`) for every wrong choice, "did you know" hooks, 5 encyclopedia stubs citing 24 fact-base entries with NASA sources |
| `hr-a1-greetings/` | edition en, target language hr (CEFR A1) | 3 units (greetings and goodbyes, introducing yourself, polite phrases and ti/Vi), 6 objectives, 31 items: typed answers with accepted sets, strict and lenient accent policy, cloze with word banks, match pairs, ordering a dialogue, sorting ti/Vi phrases, flashcards, listening, a word search |
| `european-capitals/` | en and hr editions (source en) | History and geography, a preview of the pilot: 3 units with a branching prerequisite graph (Western Europe, then Central Europe and Southern Europe, each requiring only Western Europe), 9 objectives, 34 items using 12 of the 13 kinds (no listening: no audio), every objective asked in two or more forms, a misconception explanation (`why`) for every wrong choice, Croatian exonyms (Beč, Prag, Budimpešta, Rim, Atena, Pariz, Lisabon) in the accepted answers, dated landmark events for the timeline items, a hotspot on a map, 12 encyclopedia articles (one per capital but Valletta) citing 29 fact-base entries with Wikipedia sources |

## Assets

- `solar-system/course/assets/solar-system.svg` is a hand-drawn diagram (not to scale) that the hotspot items use; the hotspot regions in `pack.json` are in its 800 x 300 coordinates.
- `european-capitals/course/assets/europe.svg` is a hand-drawn, schematic map of Europe (800 x 600, equirectangular, longitude -11 to 30 and latitude 35 to 61, north up; not to scale) with a dot at the real coordinates of each of the 13 capitals and no labels, so the hotspot items do not give the answer away. The hotspot regions in `pack.json` are circles of radius 18 around the dots, in its coordinates.
- The WAV files are **placeholder tones, not speech** (sine beeps made by `scripts/make-fixture-audio.mjs`, under 30 KB each). `solar-system/eight-beeps.wav` is a real part of an item: "each beep is one minute of the Sun's light journey: count them" (8 beeps). The two `hr-a1-greetings/placeholder-*.wav` files only stand in for a recording of "Dobar dan" and "Zovem se Ana"; their alt text and the item explanations say so. EGS-17 (voice) replaces them with text-to-speech.

## Text

- Every visible string is a key into the catalog. In `solar-system` both editions hold all the text. In `hr-a1-greetings` the English edition holds the instructions and explanations, and `text/hr.json` is the target-language catalog (the Croatian phrases and the accepted answers), shared by every edition.
- `accepted` lists: the first entry is the canonical answer; later entries are synonyms. Typo, accent and case tolerance is applied on top (`src/shared/edu/match.ts`).
- Fact-base URLs are NASA pages (`solar-system`) and Wikipedia articles (`european-capitals`), checked to answer HTTP 200 on 2026-10-29.

## The broken fixture

`broken/` is wrong on purpose and is NOT a golden fixture: the validator refuses it, so it is built with `--force` and the lint must report the codes listed in `broken/EXPECTED.md` (`tests/edu-lint.test.ts` asserts them). The golden fixtures above must lint with exit 0.

## Game shell sections (EGS-10+)

A fixture enables a shell in `shells.enabled` and may author its section in `shells.config.<shell>` (`src/shared/shells/<shell>.ts`, `docs/player.md` "Shells"). The shell text keys carry the shell prefix (`enc.`, `maze.`, `rpg.`, `rp.`, `det.`). Every golden fixture lints with 0 shell errors and 0 shell warnings.

- `encyclopedia` (EGS-10): `solar-system` has a timeline of 8 events, a map with 9 pins on `solar-system.svg` and a hunt of 3 steps per unit; `european-capitals` has 12 events, a pin per capital on `europe.svg` and 3 hunts (4, 4 and 3 steps). Every hunt sends you to an article whose body holds the answer.
- `mindmaze` (EGS-11): `solar-system` and `european-capitals` have 3 wings of 6 rooms each (characters whose lines and hints come from the course facts, two routes per wing, every item of a unit asked at some door) and an authored throne room.
- `rpg` (EGS-12): `solar-system` has 3 hand-written areas, a frame story (a young astronomer restarting the orrery, true to the facts), quest givers who teach, 9 foes named after misconceptions, 3 area bosses and a final boss.
- `roleplay` (EGS-13): `hr-a1-greetings` has a scene per unit (a café in Zagreb, a language school in Split, a hotel desk), a finale, and the garden words of the course. The Croatian is A1 and was written without a native speaker: review is welcome.

The broken shell fixtures (`broken-encyclopedia/`, `broken-mindmaze/`, `broken-rpg/`, `broken-roleplay/`) are wrong on purpose like `broken/`: each has an `EXPECTED.md` with the codes its test asserts.
