---
kind: prompt
role: researcher
task: check_notes
---
A question was sent to the research notes of a course:

Question: {{question}}

These notes are already there (found by the words they share with the question; they may be about something else):

{{notes}}

Decide whether the notes already answer the question well enough for a course writer to use the facts. They must contain the specific facts the question asks for, not only the same subject. If a fact asked for is missing, they do not cover it. Notes marked unverified do not count as an answer.

Reply with one JSON object like this:
{"covered": false, "missing": "what is still missing"}
