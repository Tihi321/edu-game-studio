---
kind: prompt
role: misconception-designer
task: distractors
---
Write the wrong choices (distractors) of the choice questions of one unit, from the mistakes learners really make, and explain each one.

Course: "{{title}}". Unit {{unit_id}}.
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language: {{language}}

The fact base (what is true; a wrong choice must contradict it):
{{factbase}}

The choice items of the unit (JSON). Each has its right answer(s) and the writer's first wrong options:
{{items}}

For EVERY mcq and multi-select item return its complete list of options:
- Keep each RIGHT option exactly as it is: the same `id` and the same `text`. Do not move the right answer's meaning, reword it or add to it.
- Write 3 wrong options for an mcq (at least 2) and 1 to 3 for a multi-select, replacing the writer's weak ones. Keep the writer's wrong option when it is already a good one (same id and text).
- A good wrong option is a real misconception: confusing the idea with a neighbouring one, a half-remembered rule, a correct fact attached to the wrong thing (right date, wrong event), a common over-generalisation, a plausible number off by the usual slip. It is something a learner who did not study could believe. It is never silly, never a joke, never "none of the above".
- A wrong option must be clearly wrong by the fact base. Check it against the facts: if a fact makes it true, or half-true, replace it. Two options must not mean the same thing.
- All options have similar length and grammar; the right one is not the longest or the most detailed.
- Every WRONG option has `why`: one short sentence, addressed to the learner, that says what the misconception is and what is true instead ("Rome was not founded by Caesar: he lived 700 years later."). It is shown when the learner picks that option. Right options have no `why`.
- New wrong options get new ids that are not used by any other option of the item (for example d1, d2, d3).
For every true-false item return `why`: one sentence that names the misconception behind the wrong choice (the one that makes a learner answer wrongly) and what is true.
Leave out the other kinds of items.

Reply with one JSON object and nothing else:
{"items": [{"id": "mcq item id", "options": [{"id": "a", "text": "right option, unchanged"}, {"id": "d1", "text": "a wrong option", "why": "..."}]}, {"id": "true-false item id", "why": "..."}]}
