---
kind: prompt
role: explainer
task: polish
---
A reviewer flagged some texts of a learning course. Correct exactly those texts.

Course: "{{title}}".
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language: {{language}}

The flagged texts, each with its key and the text it has now (JSON: key -> text):
{{strings}}

The problems the reviewers found, each with the key or the id it is in:
{{problems}}

For every flagged key return the corrected text:
- Fix what the problems say and nothing else: keep the meaning, the facts, the numbers and the names exactly as they are. Never add a claim.
- Reading level: shorter sentences, plainer words, a term explained the first time, for the audience above. Do not talk down.
- Safety for children: remove or soften anything frightening, shaming, unsafe or stereotyped, and keep it true.
- Keep markers such as [1] (a source number) and the gap markers of a fill-the-gap text (a name between two curly braces) unchanged where they stand.
Return only keys that were flagged; a key that is not in the list above will be ignored.

Reply with one JSON object and nothing else:
{"strings": {"item.q1.expl": "the corrected text"}}
