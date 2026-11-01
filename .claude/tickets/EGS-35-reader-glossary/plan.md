# EGS-35 Reader view, glossary and passage-linked items (B2)

Copied from the HUB-22 plan (`creative-hub/.claude/tickets/HUB-22-edu-start-screen-german/plan.md`): the B2 design table, the ticket block and the acceptance rows R1 and Z. Branch `EGS-35_reader-glossary`.

## B2 design (the parts EGS-35 owns)

**Passage link.** A comprehension or cloze item names its text with `extensions.passage = { article: "<articleId>", paragraphs?: [from, to] }`. In every shell that plays items, the item screen shows a collapsible "Read the text" panel (article body or paragraph range, with tap-to-gloss); the encyclopedia reader jumps to it from the feedback. Owned by EGS-35.

**Glossary data (contract, EGS-35).** `shells.config.encyclopedia.glossary: { [articleId]: GlossEntry[] }`, `GlossEntry = { id, term: key, lemma?: key, gloss: key, pos?: 'n'|'v'|'adj'|'adv'|'prep'|'conj'|'phrase', note?: key }`. `term` is the exact surface form in the article body (target catalog, taught); `lemma` the dictionary form (nouns with article and plural: "die Entscheidung, -en"); `gloss` and `note` are edition strings (hr, en). Keys: `art.<articleId>.gl.<id>.term|lemma|gloss|note`.


## Lint codes EGS-35 owns

`GLOSS_TERM_NOT_IN_TEXT` (error), `GLOSS_DUPLICATE` (error), `GLOSS_COVERAGE` (warning, fewer than 8 entries in a reading of 300+ words). The other B2 codes (`READING_*`, `TFNG_OPTIONS`, `SELFCHECK_NO_MODEL`, `GRAMMAR_*`) belong to EGS-36 and EGS-37.

## EGS-35 Reader view, glossary and passage-linked items
- **Inputs:** B2 design above; `src/player/shells/encyclopedia/` (`view-article.ts:27-109` article spread, `articles.ts`, `data.ts`, `app.ts`, `strings.ts`), `src/shared/shells/encyclopedia.ts` (section schema + lint; `theme: 'parchment'` at :431).
- **Do:**
  1. `encyclopedia` section schema gets optional `glossary` (contract above) and `reader: boolean` (default false; true makes the reader the first screen after Start). The shell lint checks every key (`TEXT_MISSING` per edition) and `GLOSS_TERM_NOT_IN_TEXT`, `GLOSS_DUPLICATE`, `GLOSS_COVERAGE`.
  2. **Reader view** (screen `reader`; testids `reader`, `reader-chapter-<articleId>`, `reader-prev`, `reader-next`, `reader-progress`): unit-ordered articles as chapters with a table of contents; remembers chapter and scroll position in the progress store (`progress.shells.encyclopedia.reader`); marks a chapter read at its last paragraph; arrow keys change chapter. Reuses the parchment theme and article layout with larger type in a reading-width column.
  3. **Tap-to-gloss:** every glossary `term` in the body is a `button.gloss` (`gloss-<id>`) that opens a popover (lemma, gloss, note); a per-text glossary panel (`glossary-panel`) lists all entries with an "in my deck" toggle (on by default; stored as `progress.shells.encyclopedia.glossOff: string[]` and honoured by EGS-36's harvested cards). Screen readers get the gloss through `aria-describedby`.
  4. **Passage panel** for items: `extensions.passage` rendered by a shared helper in `src/player/items/common.ts` (`passage-toggle`, `passage-panel`), closed by default in a quiz round and open in the reader; works in every shell that uses `getItemRenderer`, with no per-shell code.
  5. New UI keys en + hr (de in EGS-34): `reader.*`, `gloss.*`, `passage.*`.
- **Outputs:** code, fixture `de-b2-reading` (hr + en editions, `targetLang: de`, 2 chapters of about 400 words, 12 glosses each, one item of every comprehension form with passage links), tests, bot steps in `scripts/bot/encyclopedia.mjs` (open reader, tap a gloss, read to the end), docs (`docs/player.md`), ROADMAP row.
- **Contract:** the glossary data, `extensions.passage`, the `reader` flag and the testids above (frozen for EGS-36 / 38).

## Acceptance

| # | Criterion | Proof |
|---|---|---|
| R1 | Reader, tap-to-gloss and the passage panel work in the encyclopedia and in the quiz arena | `tests/bot-encyclopedia.e2e.test.ts` on `de-b2-reading` (open reader, tap a gloss, read to the end, passage panel from a quiz item, keyboard-only, axe 0), `tests/encyclopedia-lint.test.ts` (one failing fixture per `GLOSS_*`) |
| Z | Repo health | `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` all pass on each ticket branch |
