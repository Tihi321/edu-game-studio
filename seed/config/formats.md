---
kind: formats
formats:
  - id: quick
    label: Quick course
    description: Two units, about 20 minutes of play. A first look at a topic.
    units: 2
    objectives_per_unit: 3
    items_per_objective: 3
    articles_per_unit: 1
    research_questions_per_unit: 2
    item_kinds: [mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, flashcard]
  - id: standard
    label: Standard course
    description: Four units with two articles each. The usual size.
    units: 4
    objectives_per_unit: 3
    items_per_objective: 3
    articles_per_unit: 2
    research_questions_per_unit: 3
    item_kinds: [mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, flashcard]
  - id: deep
    label: Deep course
    description: Six units with more objectives and items, for a topic worth studying.
    units: 6
    objectives_per_unit: 4
    items_per_objective: 4
    articles_per_unit: 2
    research_questions_per_unit: 4
    item_kinds: [mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, flashcard]
  - id: language-a1
    label: Language course (A1)
    description: Four units of everyday vocabulary and phrases for a beginner, with typed answers and one verb unit (conjugation drills).
    language: true
    cefr: A1
    units: 4
    objectives_per_unit: 3
    items_per_objective: 3
    articles_per_unit: 1
    research_questions_per_unit: 1
    verb_units: 1
    verbs_per_unit: 6
    item_kinds: [mcq, cloze, typed, match-pairs, flashcard, sort-groups, conjugation]
  - id: language-a2
    label: Language course (A2)
    description: Five units for an elementary learner, two of them verb units (perfect tense, separable and reflexive verbs).
    language: true
    cefr: A2
    units: 5
    objectives_per_unit: 3
    items_per_objective: 4
    articles_per_unit: 1
    research_questions_per_unit: 1
    verb_units: 2
    verbs_per_unit: 6
    item_kinds: [mcq, cloze, typed, match-pairs, flashcard, sort-groups, conjugation, true-false, order, multi-select]
  - id: language-b1
    label: Language course (B1)
    description: Six units for an intermediate learner with short reading texts and two verb units (past tense, subjunctive, future).
    language: true
    cefr: B1
    units: 6
    objectives_per_unit: 3
    items_per_objective: 4
    articles_per_unit: 2
    research_questions_per_unit: 2
    verb_units: 2
    verbs_per_unit: 6
    item_kinds: [mcq, cloze, typed, match-pairs, flashcard, sort-groups, conjugation, true-false, order, multi-select]
---
# Formats

How big a course is. The brief names a format (`format`, default `quick`) and the pipeline sizes its jobs from it; the brief can also override single numbers (`units`, `objectivesPerUnit`, `itemsPerObjective`).

- `units`: how many units the course has.
- `objectives_per_unit`: learning objectives per unit. Each one rests on at least one fact.
- `items_per_objective`: items asked for each objective, in at least two different forms.
- `articles_per_unit`: encyclopedia articles per unit (0 for none), each citing facts.
- `research_questions_per_unit`: questions the researcher is asked per unit (the course's total is capped by `research_limit_per_course` in `config/factory.md`).
- `item_kinds`: the item forms the item-writer may use. Hotspot and listening items need images and audio, so they come with the generators; crossword and word search are built by code.
- `language: true`: a language course. The language-coach writes the vocabulary and grammar scope and the accepted answers of typed gaps; `cefr` is the level it is pitched at.
- `verb_units` and `verbs_per_unit` (language formats, default 0 and 6): how many units are verb units (every objective about one verb group) and how many verbs the language-coach picks for each. The conjugation item kind needs the verb-table tickets (EGS-27); until it exists the pipeline leaves `conjugation` out of the kinds it asks for.
- `enabled: false` hides a format from the pickers.

Add your own format with a new `id` (lower-case letters, digits and `-`). The engine reloads this file when it changes.
