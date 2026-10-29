# Golden course fixtures

Two hand-written courses in the course contract (`src/shared/course.ts`). Tests, the validator, the player runtime (EGS-03) and the autoplay bot (EGS-04) all use them. Each has a `course/pack.json`, a `course/text/<lang>.json` per language and `course/assets/`. `yarn test` proves both validate with 0 problems (`tests/edu-course.test.ts`).

| Fixture | Languages | What it shows |
|---|---|---|
| `solar-system/` | en and hr editions (source en) | 3 units in a prerequisite chain (The Sun and the planets, Rocky and giant planets, Moons and beyond), 9 objectives, 28 items using all 13 item kinds, every objective asked in two or more forms, a misconception explanation (`why`) for every wrong choice, "did you know" hooks, 5 encyclopedia stubs citing 24 fact-base entries with NASA sources |
| `hr-a1-greetings/` | edition en, target language hr (CEFR A1) | 3 units (greetings and goodbyes, introducing yourself, polite phrases and ti/Vi), 6 objectives, 31 items: typed answers with accepted sets, strict and lenient accent policy, cloze with word banks, match pairs, ordering a dialogue, sorting ti/Vi phrases, flashcards, listening, a word search |

## Assets

- `solar-system/course/assets/solar-system.svg` is a hand-drawn diagram (not to scale) that the hotspot items use; the hotspot regions in `pack.json` are in its 800 x 300 coordinates.
- The WAV files are **placeholder tones, not speech** (sine beeps made by `scripts/make-fixture-audio.mjs`, under 30 KB each). `solar-system/eight-beeps.wav` is a real part of an item: "each beep is one minute of the Sun's light journey: count them" (8 beeps). The two `hr-a1-greetings/placeholder-*.wav` files only stand in for a recording of "Dobar dan" and "Zovem se Ana"; their alt text and the item explanations say so. EGS-17 (voice) replaces them with text-to-speech.

## Text

- Every visible string is a key into the catalog. In `solar-system` both editions hold all the text. In `hr-a1-greetings` the English edition holds the instructions and explanations, and `text/hr.json` is the target-language catalog (the Croatian phrases and the accepted answers), shared by every edition.
- `accepted` lists: the first entry is the canonical answer; later entries are synonyms. Typo, accent and case tolerance is applied on top (`src/shared/edu/match.ts`).
- Fact-base URLs are NASA pages (checked to answer HTTP 200 on 2026-10-29).
