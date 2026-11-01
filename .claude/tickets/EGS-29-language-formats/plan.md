Copied from the HUB-22 plan (creative hub, `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`). Acceptance E1 and Z.

## Files and modules
- `seed/config/formats.md:31-41` (edit `language-a1`; add `language-a2`, `language-b1`), `src/shared/brief.ts:80` (default format from `cefr`: `language-<cefr lower>` when present), `src/shared/brief.ts:18` (fix the stale "only quiz-arena" comment), `src/shared/schemas.ts:155-173` (format schema: new optional `verb_units`, `verbs_per_unit`), `src/engine/edu/pipeline-handlers.ts:271` (curriculum + scope pass the verb-unit info), `seed/prompts/curriculum-designer/*.md`, `seed/prompts/language-coach/scope.md`, `src/engine/edu/assemble.ts` (write `pack.extensions.language = { verbUnits: [unitId], verbsPerUnit }`), docs `docs/mcp-guide.md`, tests `tests/edu-formats.test.ts` (new or existing), `tests/edu-brief.test.ts`.
- Seed sync gotcha: seeds are copied to `~/EduGames` only when absent (ROADMAP "Later": "Starter agents ... not copied when `~/EduGames/agents` already exists"). The worker must find out how `config/formats.md` and `prompts/` reach an existing data folder and either fix it (copy missing files without overwriting, warn about changed ones) or document the manual step, because the live check depends on it.

## Task: EGS-29 Formats A1 / A2 / B1, brief defaults, verb-focused units
- **Inputs:** `seed/config/formats.md` (current `language-a1`), `brief.ts:80`, decision 2 and 3.
- **Formats** (all `language: true`, kinds exclude hotspot / crossword / word-search as today):
  | id | cefr | units | objectives / unit | items / objective | articles / unit | research q / unit | verb units | kinds |
  |---|---|---|---|---|---|---|---|---|
  | `language-a1` (edit) | A1 | 4 | 3 | 3 | 1 | 1 | 1 | mcq, cloze, typed, match-pairs, flashcard, sort-groups, **conjugation** |
  | `language-a2` (new) | A2 | 5 | 3 | 4 | 1 | 1 | 2 | the A1 kinds + true-false, order, multi-select |
  | `language-b1` (new) | B1 | 6 | 3 | 4 | 2 | 2 | 2 | all of A2; articles are short reading texts (B1 reading comprehension = article + items that cite it) |
  `verb_units` / `verbs_per_unit` are new optional format fields (default 0): the number of units that are **verb units** (a unit whose objectives are all about one verb group: A1 sein / haben / regular Präsens / modals; A2 Perfekt, separable, reflexive, Präteritum of sein / haben / modals; B1 Präteritum, Konjunktiv II, Futur I) and verbs per verb unit (default 6). Item mix inside a verb unit: at least 40 % `conjugation`, the rest cloze (verb in a sentence), typed, mcq, sort-groups (regular / irregular, haben / sein).
- **Brief:** `resolveBrief` chooses `language-<cefr>` when `cefr` is given and `targetLang` is set and no `format` (A1 stays the default for `targetLang` alone); B2 selects `language-b2` once EGS-36 has merged (until then it fails with "no format for B2 yet"); C1 and C2 without a format fail with "out of scope (HUB-22)". `brief.cefr` already exists.
- **Curriculum:** the curriculum-designer prompt receives `verb_units` and must mark that many units as verb units (a convention in the unit title and objectives; the assembled pack gets `extensions.language.verbUnits`). `language-coach/scope` returns, for a verb unit, `verbs: [{ inf, tense, level }]` (instead of / besides `vocabulary`) and the item-writer receives them in `{{scope}}`.
- **Outputs:** formats, schema, brief, prompts for curriculum / scope (the German rules text is EGS-30), seed-sync fix or documented step, tests (`resolveBrief` per CEFR; a mock-provider pipeline run on `language-a2` gives verb units in `extensions.language`), docs, ROADMAP row.

## Acceptance
- E1: tests/edu-brief (here: tests/pipeline.test.ts) cefr A2 -> language-a2; B2 without a format -> clear error; verb-unit numbers; mock pipeline run on language-a2 has extensions.language.verbUnits of the right length.
- Z: yarn typecheck, lint, test pass on the branch.
