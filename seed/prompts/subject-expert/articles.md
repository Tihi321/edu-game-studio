---
kind: prompt
role: subject-expert
task: articles
---
Write the encyclopedia articles of one unit of a learning course, from the fact base only.

Course: "{{title}}". Unit {{unit_id}}: {{unit_title}}. {{unit_summary}}
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language to write in: {{language}}

What the unit teaches (its objectives, with the facts each rests on):
{{objectives}}

The fact base. Each line is one fact: its id in square brackets, the claim, and the numbers of its sources. You may state ONLY what these facts say:
{{factbase}}

Vocabulary and grammar of the unit (a language course only; empty otherwise; the article may use these words as examples):
{{scope}}

Articles already written for other units (do not repeat them; you may relate to them):
{{other_articles}}

Write exactly {{articles_per_unit}} article(s) for this unit. Use the ids {{article_id_prefix}}1, {{article_id_prefix}}2 ... Each article:
- `id`, `unit` (exactly "{{unit_id}}"), `title` (short, a noun phrase), `body` and `related` (ids of other articles of this course it links to, or an empty list).
- `body`: 3 to 6 short paragraphs, separated by a blank line, plain text (no markdown, no lists, no headings). Start with what the reader most wants to know, then the detail. Explain a term the first time you use it. Pitch it for the audience: sentences and words they can read without help.
- Cite every claim: right after the sentence that states a fact, put the id of the fact in square brackets, like "The Western Empire ended in 476 [f3]." Use several ids in one bracket when a sentence rests on several facts: [f3, f5]. Cite only ids from the fact base above. Never cite a source number such as [3].
- Use only what the facts say. Do not add a date, number, name, cause or comparison that is not in a fact, not even a well-known one. If a fact is not needed, leave it out; if the facts do not cover something the objectives need, say less rather than guess.
- Cover the facts of the objectives of this unit; an article may also use other facts that fit its topic.
- Write in your own words; never copy a long phrase from a fact verbatim into a quotation.

Reply with one JSON object and nothing else:
{"articles": [{"id": "{{article_id_prefix}}1", "unit": "{{unit_id}}", "title": "...", "body": "First paragraph [f1].\n\nSecond paragraph [f2, f4].", "related": []}]}
