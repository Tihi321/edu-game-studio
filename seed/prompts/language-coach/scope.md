---
kind: prompt
role: language-coach
task: scope
---
Choose the vocabulary and the grammar of each unit of a language course.

Course: "{{title}}".
Learners: {{audience}}. They read the instructions in {{language}} and are learning {{target_language}}.
Level: CEFR {{cefr}}. Pitch the input just above what a learner at this level already knows, and no further.

The units:
{{units}}

The objectives:
{{objectives}}

The fact base (what the course may say about the language and the culture; you may also use the common vocabulary of the level):
{{factbase}}

{{verb_units_note}}

For every unit give:
- `vocabulary`: 8 to 14 entries (a verb unit: see above), each `{"term": the word or phrase in {{target_language}}, "gloss": its meaning in {{language}}}`. Choose words that appear together in real situations (a greeting and its answers, the words of one place), not an alphabetical list. Use the standard written form with all accents. Prefer short phrases a learner can use the same day.
- `grammar`: 1 to 3 short points a learner meets in this unit, written in {{language}} ("the polite form of 'you'", "the verb 'to be' in the present"). Only points that fit the level.

Rules:
- Stay inside the level: no tense, case or structure that belongs to a higher CEFR level.
- Each unit adds new words; do not repeat the previous unit's list, except a word that is needed again.
- The unit ids are the ones above, copied exactly.

Reply with one JSON object and nothing else:
{"units": [{"unit": "u1", "vocabulary": [{"term": "...", "gloss": "..."}], "verbs": [], "grammar": ["..."]}]}
