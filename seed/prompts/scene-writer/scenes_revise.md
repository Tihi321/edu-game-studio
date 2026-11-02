---
kind: prompt
role: scene-writer
task: scenes_revise
---
The fact-checker sent your role-play scenes of a language course back. Write them again with every problem fixed and keep what was right.

The role-play scenes of a language course are written like this. A scene is a short conversation in the language being taught: other characters speak, and the learner takes the turns that are marked as replies by answering a question of the course. Wrong replies are never a dead end: the other character says the line again, simpler, with a hint.

Course: "{{title}}". Level (CEFR): {{cefr}}.
Audience: {{audience}}
Language of the course (translations, hints, titles and settings are written in it): {{language}}
Language being taught: {{target_language}}

This call: {{unit_id}}: {{unit_title}}
{{unit_summary}}

The objectives of the unit (a language course; for a finale call, empty):
{{objectives}}

The fact base. The id in square brackets is what a NEW item names in `facts`:
{{factbase}}

Vocabulary, verbs and grammar of the unit (for a finale call: empty). Build the conversation from these words; use at least half of the vocabulary terms and, for a verb unit, let the learner answer with forms of its verbs:
{{scope}}

The items that already exist, each with its id, kind and the answer the learner gives (a reply can point at any of them; prefer these):
{{items}}

Speakers written by earlier calls (use their ids as they are, do not list them again; empty at the first call):
{{speakers}}

Language rules (follow them for every sentence in the language being taught):
{{language_rules}}

What to write
- Scenes: {{scene_count}}. Scene ids start with `{{scene_id_prefix}}` (for example {{scene_id_prefix}}cafe). {{finale_note}}
- Each scene is a short chain of lines: {{scene_lines}} lines in all, of which {{scene_replies}} are replies of the learner. Line ids are l1, l2, l3 ... in order. Every line has `next`: the id of the following line; the last line has `"next": null`. `start` is the id of the first line. There is one path and no branches, and every line is on it.
- A say line: `{"id": "l1", "say": "<speaker id>", "text": "<a sentence in the language being taught>", "translation": "<its meaning in the language of the course>", "next": "l2"}`. The text is correct, natural and at the level; short sentences at A1 and A2, longer turns and polite or formal register at B1 and B2.
- A reply line: `{"id": "l2", "reply": "<item id>", "help": "<what the other character says if the learner misses: the same line in simpler words and a hint, in the language of the course>", "next": "l3"}`. The reply names an item (an existing one, or a new one you write below); the learner answers it by choosing or typing. Optional `"youSay"`: the words of the learner's bubble in the language being taught, only when the item's answer is not already the sentence.
- Every reply has a `help`. A say line never contains the answer of a reply of its scene: the learner finds the words.
- One scene keeps one register: du (friends, children, informal places) or Sie (strangers, officials, shops, hotels, a doctor). Do not mix them inside a scene.
- Make the replies vary: choose a sentence, type a word or a phrase. The scenes of a unit have at least {{typed_replies}} typed reply (a typed item, or a cloze with a gap and no word bank).
- Scenarios (choose what fits the unit): introductions, ordering in a café, shopping, asking the way, a hotel check-in, a visit to the doctor, a phone call, a complaint, a job interview. Give each scene a clear place and a goal in `setting`.
- Level gates. A1: du, greetings, introductions, ordering with sein, haben and möchten, present tense only. A2: Perfekt, separable verbs, requests, dative after the usual prepositions. B1: Präteritum of sein, haben and the modals, Konjunktiv II for polite requests, complaints and polite requests with Sie. B2: longer turns, register shifts, Konjunktiv I only in reported speech. Never use a form above the level of the course.
- Speakers: list only new speakers in `speakers`, 2 to 4 characters with a first name, and one learner (`"learner": true`, name "You" in the language of the course) when no earlier speaker is the learner.

Reply items
- {{new_items_rule}}
- A new item has a fresh id that starts with `{{item_id_prefix}}`, a kind of mcq, typed or cloze (with at least one gap; from B1 also order), `"taught": true` (its answers are in the language being taught), `objective` (an id from the objectives above), `prompt` (the question the learner sees, in the language of the course: say what the learner should answer, for example "Order a coffee politely."), `explanation` (one sentence on why the answer is right), `facts` (fact ids that say it, at least one) and the fields of its kind:
  - mcq: `"options": [{"id": "a", "text": "...", "why": "<the mistake a learner makes>"}, ...]` (3 or 4, exactly one right, a `why` for every wrong option), `"answer": "a"`.
  - typed: `"accepted": ["<canonical answer>", "<other correct answer>"]` (a full sentence or phrase with its pronoun, the best one first).
  - cloze: `"text": "Ich {{gap_marker}} Kaffee."`, `"gaps": [{"id": "g1", "accepted": ["möchte"]}]` (add `"bank"` for a word bank).
- Every new item must be used by a reply.

Your scenes as they are now (JSON, with the new items):
{{previous}}

The problems the reviewer found (a ref is a scene id, a line, or an item id):
{{problems}}

Correct the German, the translations, the help and the items where the problems say so. Return the whole answer again: all the speakers you list, all the scenes and all the new items (the same ids, unless a problem asks for a new one). Do not leave a scene or an item out.

Reply with one JSON object and nothing else:
{"speakers": [{"id": "anna", "name": "Anna"}, {"id": "you", "name": "You", "learner": true}], "scenes": [{"id": "u1-cafe", "unit": "u1", "title": "A café", "setting": "You order a coffee.", "cefr": "A1", "start": "l1", "lines": [{"id": "l1", "say": "anna", "text": "Guten Tag! Was möchten Sie?", "translation": "Hello! What would you like?", "next": "l2"}, {"id": "l2", "reply": "rp-u1-1", "help": "Say: I would like a coffee. Ich möchte...", "next": null}]}], "newItems": [{"id": "rp-u1-1", "objective": "u1-o1", "kind": "typed", "taught": true, "prompt": "Order a coffee politely.", "explanation": "Ich möchte is the polite way to order.", "facts": ["f1"], "accepted": ["Ich möchte einen Kaffee."]}]}
