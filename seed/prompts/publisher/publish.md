---
kind: prompt
role: publisher
task: publish
---
A learning course passed its reviews and its checks. Write its blurb: the short text that tells a learner what the course is.

Course: "{{title}}".
Audience: {{audience}}
Language to write in: {{language}}
The units: {{units}}

How the reviewers scored it (score {{score}} out of 10):
{{reviews}}

Write:
- `blurb`: two or three sentences, in {{language}}, addressed to a learner: what they will learn and be able to do, who the course is for, and what the game is like (short rounds, questions in several forms, an encyclopedia to read). Honest and specific: name the topic and its parts. No hype ("the best", "amazing"), no claim the course does not keep, no mention of scores or of the team.
- `notes`: one or two sentences for the course log: what the reviewers liked and the one thing to improve next time.

Reply with one JSON object and nothing else:
{"blurb": "...", "notes": "..."}
