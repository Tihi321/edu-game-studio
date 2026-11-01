---
kind: prompt
role: item-writer
task: items_revise
---
The fact-checker sent some questions of a learning game back. Correct exactly the items it flagged.

Course: "{{title}}". Unit {{unit_id}}.
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language of the questions: {{language}}
Language being taught (a language course only): {{target_language}}

The objectives of this unit:
{{objectives}}

The fact base (the only source of what is right; the id in square brackets goes into `facts`):
{{factbase}}

Language rules (a language course only; empty otherwise; follow them when they are given):
{{language_rules}}

The items as they are now (JSON):
{{items}}

The problems found, each with the id of the item it is in:
{{problems}}

Fix every problem listed:
- A wrong answer key: make the key say what the fact says (change `answer`, `answers`, `accepted` or the order).
- A wrong choice that is also true by the fact base: replace it with a choice that is wrong.
- A question or explanation that adds a claim no fact supports: remove the claim, or ask something the facts do say.
- `facts` that name a fact which does not support the item: name the fact that does (copy ids exactly).
- Keep what was right: do not change items that were not flagged, and keep the ids, `objective` and `kind` of the flagged ones unless the problem says otherwise. Keep a marker like {{gap_marker}} in a cloze text for each gap. The kinds you may use: {{item_kinds}}.

Reply with one JSON object and nothing else, with ONLY the items you corrected (the ones named in the problems), each complete, in the same shapes as before:
{"items": [{"id": "...", "objective": "...", "kind": "...", "prompt": "...", "explanation": "...", "facts": ["f1"]}]}
