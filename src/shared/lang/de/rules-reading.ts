/**
 * The B2 text of the German writer rules (EGS-36). It is appended to `{{language_rules}}` when the course is at CEFR B2 (`languageRulesText`),
 * and lives in code like `rules.ts`, so every data folder gets it with the app. The reading rules and the item conventions for readings
 * (passage links, true / false / not given, self-check cards) are checked by the lint (`READING_*`, `TFNG_OPTIONS`, `SELFCHECK_NO_MODEL`, `GLOSS_*`).
 * Model-written German, not natively reviewed; whether a text is really B2 is a judgement the lint cannot make.
 */
export const DE_READING_RULES = `German rules for B2 (the course is at level B2: texts and tasks are long-form).
Readings
- A reading is informative non-fiction, a news report, an opinion piece with a stated position, a short biography or a report on a social topic. Standard German, no dialect.
- 350 to 700 words, three to eight paragraphs of three to six sentences, a "## " heading line before each paragraph. The first sentence of a paragraph carries its point.
- Sentences average 14 to 24 words and none has more than 40. Use connectors (obwohl, während, sodass, deshalb, trotzdem, indem, falls), Passiv, relative clauses, Konjunktiv II and nominal phrases often enough that the text is B2, not B1.
- The text rests on the fact base: cite facts as for any article, name sources, and never invent a quote from a real person.
- Gloss 10 to 20 words above B1 (not names, not cognates the learner knows, no word twice). The term is the exact surface form in the text; the lemma is the dictionary form (a noun with article and plural: "die Entscheidung, -en"); the gloss is short and in the language of the course.
Grammar at B2 (taught on the texts)
- Connectors: verb-final after weil, dass, obwohl, während, sodass, indem, falls, ob, damit, nachdem, bevor; inversion after deshalb, trotzdem, deswegen, außerdem, dennoch, folglich; und, aber, denn, oder, sondern do not change the word order.
- Passiv (Vorgangspassiv and Zustandspassiv), Konjunktiv II also in the past (hätte / wäre + Partizip), relative clauses with the relative pronoun in the right case (with preposition: "mit dem", "für die"), nominal style.
- Do not teach Konjunktiv I or Plusquamperfekt-Passiv as a drilled form.
Items on a reading
- Every item about a text carries "passage": {"article": "<reading id>", "paragraphs": [from, to]} (the paragraph numbers are those shown in the text; a heading line counts) and the tag "reading".
- A true / false / not given item is an mcq with the tag "tfng" and exactly three options: {"id": "t"}, {"id": "f"}, {"id": "ng"} (in the language of the course: "True", "False", "Not given"), the right one named in "answer", a "why" on both wrong ones. "Not given" is right only when the text neither says nor contradicts the statement.
- A grammar item that the lint can check carries "grammar": {"kind": "relative", "gender": "m", "case": "dat"} (relative-pronoun cloze) or {"kind": "transform"} (a typed transformation with two or more accepted variants); without it the grammar check is skipped.
- Writing and speaking are self-check cards: a flashcard with the tag "self-check" and "taught": true; the prompt is the task with its register and word count, the back is a model answer of 80 to 180 words in German. Nothing is graded by the program: the learner compares and grades themselves.
- Cloze items on the text quote a sentence of the reading with the gap; order items put events or steps of the text in sequence; a heading match is a match-pairs item (left: the opening of a paragraph, right: its heading).`

/** What only the item-writer gets for B2: the reading shapes (the generic shapes are in the item-writer prompt). */
export const DE_READING_ITEM_SHAPES = `Reading items (the readings of B1 and B2; every reading gets at least 4 items, each with its passage):
- Extra fields on any item: \`"passage": {"article": "a-u1-1", "paragraphs": [2, 4]}\` and \`"tags": ["reading"]\`.
- True / false / not given: \`"kind": "mcq", "tags": ["reading", "tfng"], "options": [{"id": "t", "text": "True"}, {"id": "f", "text": "False", "why": "..."}, {"id": "ng", "text": "Not given", "why": "..."}], "answer": "t"\` (the ids are always t, f, ng in this order; the options are not "taught").
- Self-check (writing, speaking; at most one of each per unit): \`"kind": "flashcard", "taught": true, "tags": ["self-check"], "prompt": "Write 120 words in a formal register: ...", "back": "<a model answer of 80 to 180 words in German>"\`.`
