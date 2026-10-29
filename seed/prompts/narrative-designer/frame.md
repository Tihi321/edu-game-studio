---
kind: prompt
role: narrative-designer
task: frame
---
Give a learning course a small frame story, so the questions feel like part of an adventure.

Course: "{{title}}" about {{topic}}.
Audience: {{audience}} (age: {{age}})
Language to write in: {{language}}
Notes from the person who asked: {{notes}}

The units, in order:
{{units}}

Write:
- `premise`: two or three sentences that say who the learner is in the story and what they must do (the goal that the whole course serves).
- `characters`: 2 to 4 characters, each `{"name", "role", "description"}`: a guide who knows the topic, perhaps a rival or a funny helper. `role` is a few words ("the guide"), `description` is one or two sentences that say who they are and how they speak. Names that suit the topic and are easy to read for the audience.
- `intro`: the opening, 3 to 5 short sentences, shown before the first unit. `outro`: the ending, 2 to 4 sentences, shown after the last unit, that celebrates what the learner now knows.
- `unitBeats`: one beat for each unit: `{"unit": "<unit id>", "beat": "..."}`: one or two sentences that move the story forward and make this unit's topic the next step of the adventure. Use the unit ids above exactly.

Rules:
- The story serves the learning. It adds no fact about the topic: never state a date, number or claim about the real world in the story (the facts live in the articles and the questions).
- Age-appropriate: no real danger that frightens, no violence, no shaming; challenge and mystery are fine.
- Original: do not use a character, place or plot from a book, film or game that exists, and do not copy the style of a living author.
- Short and concrete: the player reads it between questions.

Reply with one JSON object and nothing else:
{"premise": "...", "characters": [{"name": "...", "role": "...", "description": "..."}], "intro": "...", "outro": "...", "unitBeats": [{"unit": "u1", "beat": "..."}]}
