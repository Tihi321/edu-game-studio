---
kind: quality
threshold: 7.0
max_rounds: 2
revise_below: 7
must_pass: [fact-checker, accessibility-reviewer, child-safety-reviewer]
weights:
  accuracy: 1.5
  accessibility: 1
  readability: 1
  age_fit: 1.5
  flow: 1
  difficulty: 1
---
# Quality

How the publisher decides.

- Every reviewer returns `{verdict, scores, notes, problems}`: a verdict (`pass` or `revise`), scores from 1 to 10 for its own dimensions, a short note, and a list of problems, each with the `ref` of what is wrong (an item id, an article id, a text key), what is wrong, and what to change.
- The dimensions: the fact-checker scores `accuracy`; the accessibility reviewer `accessibility` and `readability`; the child-safety reviewer `age_fit`; the playtester `flow` and `difficulty`.
- If a reviewer says `revise` and fewer than `max_rounds` revise rounds have happened, its problems go back to the writer of the flagged content, which fixes exactly those refs. Then the reviewers read it again.
- A `revise` from a reviewer that is not in `must_pass` only counts when one of its scores is below `revise_below`: "revise" with only good scores is treated as "pass". Must-pass reviewers always count.
- After the last round the publisher decides. A reviewer in `must_pass` that still says `revise` blocks the course. So does a hard gate (lint errors in the built game, the autoplay bot failing). Otherwise the weighted average of all scores must reach `threshold`.
- `weights` say how much each dimension counts. A dimension that isn't listed counts 1.
- The fact-checker also runs a script first: every item and article must name facts that exist in the fact base. A problem there forces `revise` whatever the model says.
- A blocked course stays in `courses/` with its reasons; nothing is deleted.
