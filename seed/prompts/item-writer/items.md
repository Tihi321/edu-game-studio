---
kind: prompt
role: item-writer
task: items
---
Write the questions (items) of one unit of a learning game. A learner answers them in rounds; wrong answers come back later, so every question must be fair, clear and rest on a fact.

Course: "{{title}}". Unit {{unit_id}}: {{unit_title}}.
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language of the questions: {{language}}
Language being taught (a language course only; empty otherwise): {{target_language}}

The objectives of this unit (each with the facts it rests on). Write items for EVERY objective:
{{objectives}}

The fact base. The id in square brackets is what an item names in `facts`. Ask only what these facts say:
{{factbase}}

The articles of this unit, for context (the learner can read them in the game):
{{articles}}

Vocabulary and grammar of the unit (a language course only; empty otherwise):
{{scope}}

How many and which kinds:
- At least {{items_per_objective}} items for each objective, in AT LEAST TWO DIFFERENT KINDS per objective (the same fact asked in a second form is the point). The kinds you may use: {{item_kinds}}.
- Ids: {{item_id_prefix}}1, {{item_id_prefix}}2 ... (letters, digits, - and _ only). Option, gap, pair, step, group and entry ids are short and unique inside their item (a, b, c ...; g1 ...).
- Every item has: `id`, `objective` (an id from the objectives above), `kind`, `prompt` (the question or the statement), `explanation` (one or two sentences: why the right answer is right), `facts` (the fact ids it rests on, at least one, copied exactly), and optionally `difficulty` (1 easy to 5 hard; most are 2 to 4) and `hint`.
- A language course: set `"taught": true` on an item whose answers (options, gaps, typed answers, pair sides, steps, back of a card) are phrases in the language being taught; leave it out when the answers are in {{language}}. The prompt and the explanation are always in {{language}}.

The shapes (use the fields exactly; one JSON object per item):
- mcq: `"options": [{"id": "a", "text": "..."}, ...]` (3 or 4 options, exactly one right), `"answer": "a"` (the id of the right option). Give each WRONG option a plausible reason to be chosen; a later step adds the reason text.
- true-false: `"answer": true` or `false`; the prompt is a statement. Make false statements the kind of mistake a learner makes, not an absurd one.
- multi-select: `"options": [...]` (4 to 6), `"answers": ["a", "c"]` (every right id; at least one option must be wrong).
- cloze: `"text": "The Roman Senate met in the {{gap_marker}}."` with a marker like {{gap_marker}} for each gap, `"gaps": [{"id": "g1", "accepted": ["Curia", "the Curia"], "bank": ["Curia", "Forum", "Colosseum"]}]`. `accepted` lists every correct answer, the first is the canonical one. `bank` is optional (a word bank including the right word); without it the learner types the answer.
- typed: `"accepted": ["476", "the year 476"]`: the short answer to the prompt, the first is the canonical one. Ask for one word, name or number, never a sentence.
- match-pairs: `"pairs": [{"id": "p1", "left": "...", "right": "..."}, ...]` (3 to 6 pairs, every left matches exactly one right).
- order: `"items": [{"id": "s1", "text": "...", "when": "476"}, ...]` listed in the CORRECT order (3 to 6 steps), `"timeline": true` when the order is chronological (`when` is then a date or label shown after solving).
- sort-groups: `"groups": [{"id": "g1", "title": "..."}, ...]` (2 or 3 groups) and `"items": [{"id": "e1", "text": "...", "group": "g1"}, ...]` (4 to 8 entries, each in exactly one group, every group used).
- flashcard: the prompt is the front, `"back": "..."` the answer; for a term, a name or a short definition.

Rules for good questions:
- One fact per question; the answer is unambiguous and stated by the fact. Do not ask what the facts do not say.
- Recall beats recognition: include typed, cloze, order or sort items, not only choices.
- Wrong choices are plausible but clearly wrong by the fact base; never make a wrong choice that is also true. Never give the answer away in the prompt or by the length of an option.
- No trick questions, no "all of the above", no "none of the above", no negative wording ("which is NOT ...") unless the objective needs it.
- Keep every text short and in plain words the audience knows.

Reply with one JSON object and nothing else:
{"items": [{"id": "{{item_id_prefix}}1", "objective": "u1-o1", "kind": "mcq", "prompt": "...", "options": [{"id": "a", "text": "..."}, {"id": "b", "text": "..."}, {"id": "c", "text": "..."}], "answer": "a", "explanation": "...", "facts": ["f1"], "difficulty": 2}]}
