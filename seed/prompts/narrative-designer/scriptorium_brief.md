---
kind: prompt
role: narrative-designer
task: scriptorium_brief
---
A learning course will come with a longer story, written by Scriptorium, a book factory. Write the brief it needs.

Course: "{{title}}" about {{topic}}.
Audience: {{audience}} (age: {{age}})
Language of the course: {{language}}
Notes from the person who asked: {{notes}}

The units of the course, in order:
{{units}}

Write:
- `idea`: the story idea in 4 to 8 sentences: who the main character is, where and when it happens, what they want, what stands in the way, and how the topic of the course is part of the story (the learner should meet the places, people and problems of the topic). Say what kind of story it is (an adventure, a mystery, a diary ...). The story is fiction or fiction around true events; it must not state real-world facts that are wrong.
- `audience`: who the story is for, in a short phrase ("children aged 9 to 12", "teenagers who like mysteries"). It must match the audience of the course.
- `length`: how long it should be, in words and in kind ("a short story of about 2000 words", "a novella of about 20000 words in 10 chapters"). A younger audience gets a shorter story.

Rules:
- Age-appropriate: no real danger that frightens, no violence, no shaming.
- Original: no character, place or plot from a book, film or game that exists; no imitation of a living author's style.
- Write the brief in English, whatever the language of the course; Scriptorium writes the book in the language named in `idea` ("written in {{language}}").

Reply with one JSON object and nothing else:
{"idea": "...", "audience": "...", "length": "..."}
