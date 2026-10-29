---
kind: prompt
role: director
task: plan_brief
---
A new course is being made. Plan it before any research is done.

Topic: {{topic}}
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language of the course: {{language}}
Size: {{format_label}}, exactly {{units}} unit(s)
Notes from the person who asked: {{notes}}

Do three things:
1. Give the course a short, clear title (at most 8 words, in {{language}}) and a summary of two sentences: what a learner will be able to do after the course.
2. Split the topic into exactly {{units}} unit(s), in the order a good teacher would teach them. Each unit has a `title` (at most 8 words) and a `focus`: one sentence that says what the unit covers and what is left to the other units, so they do not overlap.
3. For each unit write the research questions the researcher must answer before anything is written: {{questions_per_unit}} questions per unit at most, at least 1. A research question is a complete, specific question that a web search can answer with facts (names, dates, numbers, causes), for example "When did the Western Roman Empire end, and who was its last emperor?". Not "Tell me about Rome". Write the questions in English, whatever the language of the course, because the web is searched in English. `unit` is the number of the unit the question is for, starting at 1.

Rules:
- Do not write any course content (no articles, no questions) and do not state facts: only plan.
- Pitch the units for the audience: an age and a level that fit them.
- Every unit must be answerable with facts a researcher can find; leave out a part of the topic that nobody can source.

Reply with one JSON object and nothing else:
{"title": "...", "summary": "...", "units": [{"title": "...", "focus": "..."}], "research": [{"question": "...", "unit": 1}]}
