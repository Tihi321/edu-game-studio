---
kind: prompt
role: director
task: summarize_run
---
Course: "{{title}}" ({{slug}}).

A pipeline run has finished. These are its steps, with their status and what each reported:
{{steps}}

Write a status summary for the course log: two to four plain sentences saying what was built, what was skipped or failed, and what the user should look at next (for example an item that failed the fact-check, or a language with no voice). Do not repeat every step. If a step failed or was skipped and a rerun would help, list it in `redo` with the step name and the reason; otherwise `redo` is empty.

Answer with one JSON object and nothing else:
{"summary": "...", "redo": [{"step": "items", "reason": "two objectives have only one item form"}]}
