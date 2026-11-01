---
kind: prompt
role: curriculum-designer
task: curriculum
---
Design the curriculum of a course: its units, their prerequisites, and the learning objectives of each unit.

Course: "{{title}}". {{summary}}
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language of the course: {{language}}
Size: exactly {{units}} unit(s), {{objectives_per_unit}} objective(s) in each.
Notes from the person who asked: {{notes}}
{{verb_units_note}}

The plan of the units (use it, in this order):
{{unit_plan}}

The fact base. Each line is one fact: its id in square brackets, the claim, and the numbers of its sources. Objectives may rest ONLY on these facts:
{{factbase}}

Write:
- `units`: one entry per planned unit, in order: `id` (u1, u2, u3 ...), `title`, `summary` (one or two sentences: what the unit covers) and `requires`: the ids of the units a learner must master first, and `verb` (true only for a verb unit when the task above asks for verb units; leave it out otherwise). The first unit requires nothing. Require only earlier units, and only a unit that is really needed (a straight chain u1 -> u2 -> u3 is fine for a story-like topic; a topic with independent parts can have units that share the same prerequisite). The graph must have no cycle.
- `objectives`: exactly {{objectives_per_unit}} per unit. `id` is the unit id, `-o` and a number (u1-o1, u1-o2 ...). `unit` is the unit id. `bloom` is the level of thinking: remember, understand, apply, analyze, evaluate or create. Mix the levels inside a unit and let the later units ask for more than "remember", as far as the facts allow. `text` is what the learner will be able to do, starting with a verb ("Name the three ...", "Explain why ...", "Put the events in order"), in {{language}}, pitched for the audience. `facts` is the list of fact ids (at least one) that a learner needs to reach the objective, copied exactly from the fact base above.

Rules:
- Every objective must be reachable with the facts it lists; do not write an objective the fact base cannot support.
- Use each id exactly as shown; do not invent fact ids.
- Spread the facts: each unit should use its own facts, and every important fact should end up in at least one objective.

Reply with one JSON object and nothing else:
{"units": [{"id": "u1", "title": "...", "summary": "...", "requires": [], "verb": false}], "objectives": [{"id": "u1-o1", "unit": "u1", "bloom": "remember", "text": "...", "facts": ["f1", "f2"]}]}
