# EGS-27 conjugation item kind (HUB-22)

Copied from the HUB-22 plan (creative-hub, `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`), sections "Files and modules" and "Tasks for workers" for EGS-27.

- `src/shared/course.ts:~246` (add `conjugationSchema`, add to `itemKindsBuiltin` :34-48 and `builtinItemSchema` :~215), `src/shared/edu/kinds.ts` (a `def({kind:'conjugation', ...})` next to `cloze`), `src/shared/edu/checkers.ts` (`checkConjugation`), `src/shared/edu/registry.ts` (nothing, unless `ItemKindDef` needs `drill`), `src/shared/schemas.ts:155` `AUTHORED_ITEM_KINDS` (+ `conjugation`).
- Authoring: `src/engine/edu/authoring.ts:~399-416` (`conjugationItem` zod + add to `authoredItemSchema`), `src/engine/edu/assemble.ts` (item to pack + catalog keys; default pronoun labels), `src/engine/edu/pipeline-handlers.ts:~100-115` (`renderItemForReview` case), `src/engine/mcp/tools-course.ts` (`edu_item_add` shape + description), `docs/mcp-guide.md`.
- Lint: `src/engine/edu/lint.ts` (kind-specific problems through `validate` of the kind def; new codes below), `lint.ts:~62-78` code list.
- Player: NEW `src/player/items/conjugation.ts`, register in `src/player/items/index.ts`; `src/player/feedback.ts:55-150` (per-person marking, `fb.detail.forms`), `src/player/debug.ts:46` (bot solver exposure), `src/player/round.ts:214-228` (`gradeOf`, `timerApplies`).
- Bot: `scripts/play.mjs:438,511,554` (perfect / wrong / random answers for the new kind), `scripts/bot/generic.mjs`.
- Studio editor: `src/renderer/ui/course/ItemEditor.tsx:~303` (a form editor), `src/renderer/lib/items.ts`.
- Live quiz: `src/shared/live/questions.ts` (explicitly **excluded** from live questions; add a test that it is skipped, not crashed).
- Fixture + tests: NEW `tests/fixtures/courses/de-verbs-a1/` (hr + en editions, `targetLang: de`), `tests/edu-checkers.test.ts`, `tests/edu-lint.test.ts`, `tests/edu-authoring.test.ts`, `tests/bot.e2e.test.ts` (new fixture runs perfect / wrong / random), `tests/edu-course.test.ts`.

### EGS-27 `conjugation` item kind
- **Inputs:** EGS-26 contract; decision 3.
- **Schema** (`course.ts`, strict, in the pack; all strings are catalog keys):
  ```
  kind: 'conjugation'
  ...itemBaseShape                      // id, objective, prompt, explanation, hint?, difficulty, tags, extensions
  verb: keySchema                       // the infinitive, shown ("gehen"); taught catalog when taught
  tense: idSchema                       // metadata: 'praesens' | 'perfekt' | 'praeteritum' | 'futur1' | 'imperativ' | 'konjunktiv2' (free id for other languages)
  forms: [{ person: idSchema,           // 'ich','du','er','wir','ihr','sie','Sie' for de; any id for other languages
            label: keySchema,           // pronoun shown beside the input ("er / sie / es"); assemble fills it for de
            answer: keySchema,          // accepted list per language, first = canonical, WITHOUT the pronoun (see rules)
            given: boolean = false }]   // shown filled in, not asked
         .min(2).max(7)
  ask: int >= 1 optional               // how many of the non-given forms are asked per presentation (a drill); missing = all
  strictDiacritics: boolean optional
  ```
  Catalog keys (assemble): `item.<id>.verb`, `item.<id>.form.<person>` (strings + `accepted`), `item.<id>.form.<person>.label`; with `taught: true` the verb, forms and labels go to the target-language catalog, prompt / explanation / hint / why stay in the edition catalogs.
- **Answer shape** `{ [person]: string }` for the asked persons only. **Check** = per form `matchAnswer` with `typos: false`, `lang` from the context, policy from EGS-26; `score = right / asked`, `correct` only when all asked forms are right, `detail = { [person]: boolean }`, `expected = { [person]: canonical }` (all forms, so feedback can show the full table), `partial` when some are right; `translit`/`caps` true if any form used them.
- **Writing rules** (also in the EGS-30 prompts): the answer is the verb form without the pronoun ("gehe"); compound tenses and separable verbs include every word the learner types ("bin gegangen", "werde gehen", "würde gehen", "stehe auf"); imperativ persons are only `du`, `ihr`, `Sie` (`Sie` form includes the pronoun: "gehen Sie"); `er` covers er / sie / es, `sie` is the plural, `Sie` the formal; alternate correct forms go in `accepted` (du: "arbeitest"; Präteritum "wurde"; imperative du: "Geh", "Gehe"); an irregular verb must show at least one irregular form asked.
- **Grade:** `gradeOf` (`round.ts:214`): all right -> `good` (the `translit` / `caps` notes never cost a grade, EGS-26; `gradeOf` must not treat them like `typo`); some right (score >= 0.5) -> `hard`; else `again`. `timerApplies`: false (typing).
- **Lint codes (errors unless noted):** `CONJ_PERSON_DUPLICATE`, `CONJ_ASK_TOO_MANY` (`ask` > asked forms), `CONJ_IMPERATIVE_PERSON` (tense `imperativ` with a person outside du / ihr / Sie, only when `targetLang` is `de`), `CONJ_FORM_DUPLICATE_AMBIGUOUS` (two persons with the same canonical form in an item that asks both without a `given`: allowed, but **warning** because the learner cannot tell them apart: wir/sie/Sie in Präsens). EGS-28 adds `CONJ_FORM_MISMATCH` and `CONJ_VERB_UNKNOWN` to the same list.
- **Player:** `items/conjugation.ts`: the verb as a heading, the tense as a badge, one labelled input per asked form in a table (given forms are read-only rows), on-screen letter buttons ä ö ü ß (`SPECIAL_LETTERS`), speech button on each input if speaking is on (`speak.ts`), `Check` button; feedback marks each person, shows the full table afterwards (right forms in the table, wrong ones with the expected form). Testids: `conj-<person>` (input), `conj-<person>-result`, `check`. Keyboard: Enter in an input moves to the next, Enter on the last submits.
- **Other consumers (each must handle or explicitly skip):** studio ItemEditor (a table editor), `edu_item_add` shape, `renderItemForReview` (fact-checker sees `verb/tense/forms`), bot (`play.mjs` perfect = canonical forms, wrong = reversed forms, random = random persons right), live quiz (skip, tested), crossword / word search builders do not take it.
- **Outputs:** code, fixture `de-verbs-a1` (editions hr + en, `de.json` target; one unit "Verben", items for sein, haben, gehen, machen in Präsens; a Perfekt item; an Imperativ item; one with `ask: 3`; one `given` form), tests, docs (`docs/player.md` item table, `docs/mcp-guide.md`), ROADMAP row.
- **Contract:** the schema above is final; EGS-28 / 30 / 31 / 32 / 34 code against it. Pack extension used by 29 / 31: `pack.extensions.language = { verbUnits: string[], verbsPerUnit?: number }`.


## Decisions made while building
- **Which forms are asked.** The pack item says which forms are never asked (`given`) and how many open forms one presentation asks (`ask`). The player picks the asked persons with the seeded generator (`askedPersons`); the answer holds exactly those persons. The checker accepts an answer whose open persons number `min(ask, open)`, so the check needs no knowledge of the seed. `solve` (lint, bot helper) returns the first `ask` open forms; `window.EduEngine.debug.solve` returns every open form and the bot types only the inputs on the page.
- **Check button test id** is `check` (as the plan says), not the shared `submit`.
- **Lint codes** all four structural ones live in `lint-conjugation.ts` (with the EGS-28 ones) because they need the edition's text and a severity; the kind's own `validate` only reports `CONJ_NOTHING_ASKED` (every form given).
- `AUTHORED_ITEM_KINDS` gets `conjugation`, but a format's default `item_kinds` leaves it out (only language formats list it).
