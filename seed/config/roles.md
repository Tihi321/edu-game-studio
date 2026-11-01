---
kind: roles
roles:
  director:
    models: [paid, strata, lmstudio]
  curriculum-designer:
    models: [paid, strata, lmstudio]
  subject-expert:
    models: [paid, strata, lmstudio]
  item-writer:
    models: [paid, strata, lmstudio]
  misconception-designer:
    models: [paid, strata, lmstudio]
  explainer:
    models: [paid, strata, lmstudio]
  language-coach:
    models: [paid, strata, lmstudio]
  game-designer:
    models: [paid, strata, lmstudio]
  narrative-designer:
    models: [paid, strata, lmstudio]
  art-director:
    models: [paid, strata, lmstudio]
  art-critic:
    models: [gemini/gemini-2.5-flash, anthropic/claude-sonnet-4-5, lmstudio]
  composer:
    models: [paid, strata, lmstudio]
  voice-director:
    models: [paid, strata, lmstudio]
  translator:
    models: [paid, strata, lmstudio]
  publisher:
    models: [paid, strata, lmstudio]
  researcher:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  fact-checker:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  accessibility-reviewer:
    models: [strata, lmstudio, paid]
  child-safety-reviewer:
    models: [strata, lmstudio, paid]
  playtester:
    models: [strata, lmstudio, paid]
---
# Roles

The default models for each role, as an ordered list of `provider/model` or an alias. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list, and a course's own `models` (in `courses/<slug>/course.md`, a role or `"*"` for every role) go in front of that: the order is **course, then agent, then this list**.

The aliases `paid`, `strata` and `lmstudio` stand for the first row of that kind in `config/settings.md` (also on the app's Models page). A kind can repeat: `paid-2` stands for the second API row, `lmstudio-2` for the second LM Studio row. The id of any other provider works as an alias too (`client`, `acp`, or a provider you added with Add provider, such as `acp-home`). Change a row there and every role that uses the alias follows.

The Edu Studio team (docs/design.md):
- `director`: keeps the course brief, picks the next job and writes the run summary.
- `curriculum-designer`: the units, the learning objectives (Bloom level) and the prerequisite graph, each objective resting on facts from the fact base.
- `researcher`: answers research questions with short sourced facts (web search or, with the `client-search` provider, Claude Code searching the web). Checks and notes use Strata with thinking on `low`.
- `subject-expert`: writes the encyclopedia articles of each unit from the fact base, citing facts as `[f3]`.
- `item-writer`: writes the items of each objective, at least two forms per objective, every item resting on facts.
- `misconception-designer`: writes the wrong choices from real misconceptions, with a reason for each.
- `explainer`: the feedback after an answer, hints, "did you know" hooks, and the polish of flagged texts.
- `language-coach`: vocabulary and grammar scope for a language course, and the accepted answers of typed gaps.
- `fact-checker`: checks every article and item against the fact base. **Must pass.**
- `game-designer`: picks the shells, the round length, the boss round and the difficulty of each item.
- `narrative-designer`: the frame story and characters, or the brief for a longer story.
- `art-director`: plans the pictures of a course: one for every encyclopedia article, the art of each shell (quiz arena backdrops, castle rooms, RPG tiles and sprites ...) and a picture for an item only where it helps; writes the prompt and the alt text of each. A plan the model cannot get right after the repair round is replaced by one made from the course text.
- `art-critic`: looks at each generated picture (it needs a model with `vision: true`) and says pass or revise against the plan line; a revise makes the picture again with its note, up to `max_rounds` (`config/quality.md`). **Not must-pass**: a picture that is still rejected after the last round stays in the course. Without a vision model, or with `media.art.review: false`, the check is skipped and the step says why.
- `composer`: plans the music of the course by area (menu, one per unit or group of units, boss, end, and the castle / RPG areas of those shells) and the sound effects of the events (correct, wrong, combo, level-up, boss): mood, tempo, chip or prompt, length, and the Chiptune Studio sound of each effect. Chiptune Studio makes the RPG and castle music and every sound effect, ComfyUI (ACE-Step) the other music; Flow Music only when the course opts in to spend credits. A plan the model cannot get right after the repair round is replaced by one made from the course text.
- `voice-director`: plans what the game says aloud: a few short narration clips in the source language (unit introductions, articles) and, for a language course, the listening practice: the taught phrases that become listening items spoken in the target language, and a delivery style per language. Who speaks (Google's free Gemini voices within the day's quota, VibeTTS or ComfyUI TTS) is decided by the hub's allocation rule (`config/voice.md`), not by this role. A plan the model cannot get right after the repair round is replaced by one made from the course text.
- `translator`: makes the other editions of a course (EGS-32): translates the text catalog of the source language, leaving the taught phrases of a language course alone, and keeps keys, gap markers and placeholders. Set the course model to `client/claude-code` and Claude Code translates, like any other role.
- `playtester`: reads the bot's play of the built game and reports flow, difficulty and dead ends.
- `accessibility-reviewer`: reading level, plain wording, no meaning carried by colour alone, alt text. **Must pass.**
- `child-safety-reviewer`: age fit and safety of a course for children. **Must pass** (it reviews kids' courses only).
- `publisher`: decides from the reviews and the hard gates (see `config/quality.md`) and writes the course blurb.

Starting choices, all of them first guesses to be tuned in the model picker:
- Writers and designers (and the director and publisher): the paid default, with Strata and then LM Studio as fallbacks.
- Researcher and fact-checker: Strata with thinking on `low` (named directly, it is not the Strata default), then LM Studio, then the paid default.
- Other reviewers and the playtester: Strata (a model family different from the paid writers, and free), then LM Studio, then the paid default.
- The art-director, the composer, the voice-director and the translator are writers (paid first). The art-critic must be a vision model, so it starts with Gemini 2.5 Flash, then Claude Sonnet (both see images), then LM Studio (only when a model there has `vision: true` in `config/providers.md`); the model picker offers it vision models only.

Reviewer jobs prefer a model family different from the one that wrote the content. Changing a default here applies at once: a running job asks its current request again on the new model. `fallback_shared` in `config/settings.md` (the Models page's "One fallback order for every role") gives every role the fallback rows top to bottom instead. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.
