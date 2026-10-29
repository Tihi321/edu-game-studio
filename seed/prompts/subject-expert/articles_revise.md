---
kind: prompt
role: subject-expert
task: articles_revise
---
The fact-checker sent some articles of a learning course back. Correct exactly the articles it flagged.

Course: "{{title}}". Unit {{unit_id}}.
Audience: {{audience}} (age: {{age}}; level: {{level}})
Language to write in: {{language}}

The fact base (the only source of claims; the id in square brackets is what you cite):
{{factbase}}

The articles as they are now (JSON):
{{articles}}

The problems found, each with the id of the article it is in:
{{problems}}

Fix every problem listed:
- A claim that no fact supports: remove it, or rewrite it so it says only what a fact says, and cite that fact as [f3].
- A citation to a fact that does not say it: cite the fact that does, or drop the claim.
- An article that cites no fact: add the citations it needs, or rewrite it from the facts.
- Keep what was right: do not rewrite sentences that were not flagged, and keep the ids, `unit` and `related` unchanged.
Cite only fact ids from the fact base above, and never a source number such as [3].

Reply with one JSON object and nothing else, with ONLY the articles you corrected (the ones named in the problems), each complete:
{"articles": [{"id": "...", "unit": "{{unit_id}}", "title": "...", "body": "...", "related": []}]}
