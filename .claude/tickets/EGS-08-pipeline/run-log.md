# EGS-08 live check: "The Roman Empire" through the client provider

Date: 2026-10-29. Done by the orchestrator acting as the MCP client (Claude Code answered every task itself). Cost: $0.

## Setup

- Worktree `edu-game-studio-p3`, branch `EGS-08_pipeline` (uncommitted state of the ticket), `yarn build:engine`.
- Engine: `node out/engine/index.js --mcp-only --port 7473` with `EDU_DATA=.claude/temp/live-egs08` (fresh, seeded at start), `EDU_MCP_PORT=7473`, `EDU_SHARED_KEYS=0`, `EDU_AUTOSTART=0`. Ports 7463, 7473 and 7341 were free before the start (phase 2's engine was not running); Scriptorium was not started or called.
- Data folder `config/providers.md`: `search_order: [client-search]`, `tavily` and `wikipedia` set `enabled: false` (picked up by the watcher, no restart). LM Studio and Strata were down; no role used them, because the brief's `model: client/claude-code` put the client first for every role.
- MCP calls: a small JSON-RPC client script in `.claude/temp/` (`mcp.mjs`, `sub.mjs`), not committed.

## Run

1. `edu_run_pipeline {brief: {topic: "The Roman Empire", audience: "teenagers and adult beginners", age: 14, sourceLang: "en", units: 2, model: "client/claude-code", story: "none"}}` -> slug `the-roman-empire`, run 1, job `the-roman-empire--plan--all--r1`.
2. Loop: `edu_wait` (returned each time with `clientTasks`), `edu_get_task`, `edu_submit_task`, until `pipeline.stage` = `published`.

Tasks answered: 30 (26 model calls plus 4 web searches; spend rows: 30, total $0.000000).

| Step | Tasks | Notes |
|---|---|---|
| plan (director) | 1 | title "The Roman Empire: Rise and Fall", 2 units, 4 research questions |
| research (searcher + researcher) | 4 searches + 4 notes + 2 follow-ups | The search answers were written from the orchestrator's own knowledge (no live web fetch), as short paraphrased excerpts attributed to named pages: Wikipedia (Augustus, Roman Empire, Trajan, Tetrarchy, Romulus Augustulus, Fall of the Western Roman Empire) and Britannica (Pax Romana, Constantinople). The `copiesPage` guard dropped two facts that repeated 12 words of the excerpt; the missing-figures follow-up asked for them again (31 BC, AD 475) and the reworded facts were kept. One cause sentence (causes of the fall) was also dropped and not re-asked. |
| factbase (no model) | 0 | 36 facts from 8 sources, 0 unverified |
| curriculum | 1 | 2 units (u2 requires u1), 6 objectives |
| articles | 2 + 1 repair | u2 first related to `a-u1-1`, which the parallel u1 job had not written when the u2 prompt was made: the check sent it back, answered with `related: []` (see follow-ups) |
| items | 2 | 10 items per unit, 9 kinds over the course, >= 2 kinds per objective |
| distractors | 2 | a `why` per wrong option |
| fact_check | 2 | both units pass in round 1 (accuracy 9) |
| explain | 2 | explanations, hints, did-you-know with fact ids |
| design | 1 | quiz-arena (encyclopedia recorded for later), round 7, boss 10, timer 30 s |
| story, art, music, voice, editions | 0 | skipped with reasons |
| assemble (no model) | 0 | 20 items, 2 articles, 208 texts |
| review_accessibility | 1 | revise (2 minor problems: two sort-group prompts did not say what to do) |
| polish-k2, assemble-k2, review_accessibility-k2 | 2 | the two prompts rewritten; round 2 pass. The audience revise loop ran live. |
| build, lint (no model) | 0 | lint clean, 0 warnings |
| playtest (bot) + playtest_report | 1 | 5 learners (perfect, wrong, 0.9, 0.75, 0.55) all passed, 0 console errors |
| publish | 1 | published, score 8.82 (accuracy 9, accessibility 9, readability 9, flow 9, difficulty 8) |
| summarize (director) | 1 | appended to course.md |

Child safety was not reviewed (age 14, not a kids' course), as designed.

## Checks after the run

- `edu_wait`: `stage: published`, 29 jobs done, 0 failed, 0 client tasks left.
- `edu_lint {slug}`: ok, 0 errors, 0 warnings.
- `pack.json`: 20 items, every item has `extensions.facts` naming existing fact-base ids (0 without); 36 facts, each with a source title and URL; articles cite 19 and 17 facts.
- Bot run by hand on `courses/the-roman-empire/build`: `--mode perfect` ok (24 steps, finished, 0 console errors); `--mode random --accuracy 0.75 --seed 7` ok (31 steps, finished, 0 console errors).
- The engine was stopped afterwards (process ended, port 7473 free).

## Not verified

- A real web search (the searcher answers came from the orchestrator's knowledge, not fetched pages).
- A human playing the course (the pilot, EGS-09, is where the user plays).
- The fact-check revise loop live (it passed in round 1; the loop is covered by the mock tests).

## Follow-ups

- Units run in parallel, so the subject-expert of unit 2 cannot know the article ids of unit 1 and a `related` link to them is refused (one repair round). Either list the planned article ids (`a-u<n>-1`) of every unit in the prompt, or check `related` after all units are written.
- The objective text of u2-o3 says "name its causes", but the causes fact was dropped by the copy guard; the curriculum check could flag objective verbs the listed facts cannot support (left to the curriculum-designer's judgement now).
