---
kind: prompt
role: researcher
task: from_knowledge
---
The authors of a learning course need facts, but no web source could be used for this question. Answer from your own knowledge as carefully as you can.

Question: {{question}}
{{context}}

Write only facts you are fairly sure of, as short sentences a learner could be taught, one claim per fact. Prefer concrete numbers, dates and names, but say "about" or "roughly" when you are not exact. If you are unsure about something, leave it out. Do not invent sources. These notes will be marked as unverified, and the course keeps them out of its fact base unless it allows unverified facts.

Between 2 and 8 facts. If you know nothing reliable, return an empty list.

Reply with one JSON object like this:
{"facts": [{"fact": "..."}]}
