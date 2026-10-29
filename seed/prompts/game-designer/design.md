---
kind: prompt
role: game-designer
task: design
---
Design how the game plays: the shells, the length of a round and of the boss round, and the difficulty of every question.

Course: "{{title}}".
Audience: {{audience}} (age: {{age}})

The units (each with its number of items by kind):
{{units}}

All items with their kind and the first difficulty the writer gave (id, kind, difficulty):
{{item_summary}}

The shells the player has today: {{shells_available}}. A shell is a way to play the same questions. Name only shells from that list in `shells`; you may also name others you would want later (they are recorded, not played yet). The quiz arena is always on.

Notes from the person who asked: {{notes}}

Decide:
- `shells`: the shells to switch on.
- `quizArena.roundLength`: questions in one round of a unit, 3 to 12. A younger audience gets shorter rounds (5 for a young child, 7 to 8 for a teenager or adult). `quizArena.bossLength`: questions in the boss round that mixes the units, 4 to 20, about 1.5 times the round length. `quizArena.timerSeconds`: seconds per question when the learner plays with the timer, 5 to 120: more for reading-heavy or typed questions, fewer for true-false.
- `difficulty`: for every item, a number from 1 (easy) to 5 (hard). Judge from the kind and the content: a true-false about a well known fact is 1 or 2; a typed answer, an order of five events or a sort into groups is 3 to 4; combining two facts is 4 to 5. Make the first items of a unit easier than the last. Spread the numbers: aim for about 20 percent easy (1 to 2), 60 percent middle (3) and 20 percent hard (4 to 5) over the course, so most learners succeed about 70 to 85 percent of the time.
- `notes`: two sentences on why you chose this.

Use the item ids exactly as given. Do not change any question.

Reply with one JSON object and nothing else:
{"shells": ["quiz-arena"], "quizArena": {"roundLength": 7, "bossLength": 10, "timerSeconds": 30}, "difficulty": [{"item": "q1", "difficulty": 2}], "notes": "..."}
