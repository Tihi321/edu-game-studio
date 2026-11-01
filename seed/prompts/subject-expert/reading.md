---
kind: prompt
role: subject-expert
task: reading
---
Write the readings of one unit of a language course: graded long-form texts in {{target_language}}, from the fact base only. A learner reads them in a reader with tap-to-gloss words, then answers questions about them.

Course: "{{title}}". Unit {{unit_id}}: {{unit_title}}. {{unit_summary}}
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language of the text: {{target_language}}. Language of the glosses and notes: {{language}}.

What the unit teaches (its objectives, with the facts each rests on):
{{objectives}}

The fact base. Each line is one fact: its id in square brackets, the claim, and the numbers of its sources. You may state ONLY what these facts say:
{{factbase}}

Vocabulary and grammar of the unit (the readings may use these words and structures):
{{scope}}

Language rules (follow them):
{{language_rules}}

Readings already written for other units (do not repeat them; you may relate to them):
{{other_articles}}

Write exactly {{articles_per_unit}} reading(s) for this unit. Use the ids {{article_id_prefix}}1, {{article_id_prefix}}2 ... Each reading:
- `id`, `unit` (exactly "{{unit_id}}"), `title` (a short noun phrase in {{target_language}}), `body`, `related` (ids of other readings it links to, or an empty list) and `glossary`.
- `body`: {{reading_min}} to {{reading_max}} words of {{target_language}}, in three to eight paragraphs of three to six sentences, separated by a blank line. Put a heading line before each paragraph, written as "## " and a short heading. The first sentence of a paragraph carries its point. Register: informative non-fiction, a news report, an opinion piece with a stated position, a short biography or a report on a social topic. Standard language, no dialect.
- Sentences: on average 14 to 24 words, none over 40. Use connectors (obwohl, während, sodass, deshalb, trotzdem, indem, falls), the passive, relative clauses, the subjunctive and nominal phrases often enough that the text really is at the level of the course.
- Cite every claim: right after the sentence that states a fact, put the id of the fact in square brackets, like "Die Stadt wurde 476 aufgegeben [f3]." Several ids in one bracket: [f3, f5]. Cite only ids from the fact base above, never a source number. Use only what the facts say: do not add a date, number, name, cause or comparison that is not in a fact. Name the sources in the text when a fact does ("laut ..."). Never invent a quote from a real person.
- `glossary`: {{glossary_min}} to {{glossary_max}} entries of words ABOVE the level of the course: not names, not words the learner already knows from cognates, no word twice. Each entry is `{"term": ..., "lemma": ..., "pos": ..., "gloss": ..., "note": ...}`. `term` is the EXACT surface form as written in the body (same letters, same case, the inflected form as it stands in that sentence), so it can be found in the text. `lemma` is the dictionary form (a noun with article and plural: "die Entscheidung, -en"; a verb in the infinitive). `pos` is one of n, v, adj, adv, prep, conj, phrase. `gloss` is a short meaning in {{language}}; `note` is optional (a usage hint in {{language}}).
- Write in your own words; never copy a long phrase from a fact verbatim.

Reply with one JSON object and nothing else:
{"articles": [{"id": "{{article_id_prefix}}1", "unit": "{{unit_id}}", "title": "...", "body": "## Heading\n\nFirst paragraph [f1].\n\n## Next heading\n\nSecond paragraph [f2, f4].", "related": [], "glossary": [{"term": "...", "lemma": "...", "pos": "n", "gloss": "...", "note": "..."}]}]}
