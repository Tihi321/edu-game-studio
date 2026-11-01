---
kind: prompt
role: explainer
task: explain
---
Write the feedback of the questions of one unit: what the learner sees after answering.

Course: "{{title}}". Unit {{unit_id}}.
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language: {{language}}

The fact base (the only source of claims; the id in square brackets is what `didYouKnowFact` names):
{{factbase}}

Language rules (a language course only; empty otherwise; use the part on feedback, and never state a rule that contradicts them):
{{language_rules}}

The items of the unit (JSON), with their answer keys and the facts they rest on:
{{items}}

For EVERY item return:
- `explanation`: two or three short sentences shown after the answer, right or wrong. Say what the right answer is and why, in words the audience knows. Rest it on the item's facts only; never add a claim no fact supports. Do not repeat the question; do not scold; do not start with "Correct" or "Wrong" (the game says that).
- `hint` (optional): one short sentence shown before answering when the learner asks. It points at where to think, and never gives the answer away. Leave it out when a hint would give the answer away.
- `didYouKnow` and `didYouKnowFact` (optional, for about one item in three): one surprising or memorable sentence, shown after a right answer, that goes a step beyond the question, together with the id of the ONE fact in the fact base it rests on. Both or neither. It must be a different fact from the answer when one is available, and must be stated by that fact.
Keep a wrong option's own reason out of the explanation: the game shows that separately.

Rules:
- Short beats long: no explanation over 45 words.
- Warm, concrete, plain. No jargon the audience does not know; explain a term the first time.
- Use the item ids exactly as given. Do not change the answer keys or the questions.

Reply with one JSON object and nothing else:
{"items": [{"id": "...", "explanation": "...", "hint": "...", "didYouKnow": "...", "didYouKnowFact": "f3"}]}
