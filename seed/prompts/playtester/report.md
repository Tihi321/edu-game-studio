---
kind: prompt
role: playtester
task: report
---
Judge a playtest of a built learning game. Simulated learners played it with the autoplay bot: it always answers right, always wrong, or right with a fixed chance (90, 75 and 55 percent), and it follows the game's own rules, so what it reports is what a real learner would meet.

Course: "{{title}}". Audience: {{audience}} (age: {{age}}).
The units: {{units}}

What each simulated learner did:
{{personas}}

The lint of the built game (answer keys, accepted answers, forms per objective, assets):
{{lint}}

Judge from these numbers only; do not invent what you did not see. Think of the real audience:
- `flow` (1 to 10): did the game run smoothly from the title to the end? Did every learner who should finish, finish, within the step bound? Were there console errors or failed checks? Did the feedback screens explain the wrong answers? A game that the 75 percent learner could not finish is below 5.
- `difficulty` (1 to 10, 10 = just right): do the results fit the audience? A strong learner (90 percent) should finish without many retries; a struggling learner (55 percent) should still be able to finish, taking more steps; the learner who is always wrong should see the review queue fill. Many more steps than the number of questions means the game is too hard or too repetitive.
- `deadEnds`: a list of short sentences, each a place where a learner got stuck, could not finish or met an error (empty when none). Name the persona and the failure.
- `verdict`: "pass" when every persona that must finish finished, no console error was logged and no failure is listed; otherwise "revise", with each cause as a problem. A failed bot run is also a hard gate of the publisher, whatever you say.
- `notes`: two sentences: how the game felt and what to change first.
- `problems`: each `{"ref": the persona or the unit, "issue": what went wrong, "fix": what to change}`.

Reply with one JSON object and nothing else:
{"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "problems": [], "deadEnds": []}
