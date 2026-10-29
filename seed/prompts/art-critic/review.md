---
kind: prompt
role: art-critic
task: review
---
Look at the picture that comes with this message and judge it against what it was made for. It is round {{round}} of the review.

Course: "{{title}}". Asset: {{asset_id}} (a {{kind}}, style: {{style}}). It is {{target}}.
The prompt it was made from: {{prompt}}
The alt text a learner who cannot see it will read: {{alt}}

Judge from the picture only, and be fair: a game picture does not have to be perfect, it has to be clear and right.
- `relevance` (1 to 10): does it show what the prompt and the alt text say? A picture of the wrong thing, or one that misses the main subject, is below 5.
- `clarity` (1 to 10): is the subject readable at a small size? Is it free of text, letters, numbers, labels and watermarks (any text in the picture is a fault, models cannot spell), of garbled shapes, extra or missing limbs, cut-off subjects and strong artefacts? A backdrop must have an empty middle. A sprite must be one figure. A tile sheet must be a grid of tiles.
- `verdict`: "pass" when it is good enough to use; "revise" when the picture must be made again. Say "revise" only for a real fault, not for taste.
- `notes`: one or two sentences: what is right and what is wrong.
- `problems`: for a revise, each `{"ref": the asset id, "issue": what is wrong in the picture, "fix": what to say differently in the prompt}`. The fix is added to the prompt for the next try, so make it a short, concrete instruction ("show the whole figure", "no text in the picture").

Reply with one JSON object and nothing else:
{"verdict": "pass", "scores": {{scores_example}}, "notes": "...", "problems": []}
