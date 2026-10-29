---
kind: roles
roles:
  director:
    models: [paid, strata, lmstudio]
---
# Roles

The default models for each role, as an ordered list of `provider/model` or an alias. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list.

The aliases `paid`, `strata` and `lmstudio` stand for the first row of that kind in `config/settings.md` (also on the app's Models page). A kind can repeat: `paid-2` stands for the second API row, `lmstudio-2` for the second LM Studio row. The id of any other provider works as an alias too (`client`, `acp`, or a provider you added with Add provider, such as `acp-home`). Change a row there and every role that uses the alias follows.

The Edu Studio roles (only the director exists in the skeleton; EGS-06 to EGS-08 add the team described in `docs/design.md`):
- `director`: keeps the course brief, picks the next job and decides what to redo after failures or edits.

Changing a default here applies at once: a running job asks its current request again on the new model. `fallback_shared` in `config/settings.md` (the Models page's "One fallback order for every role") gives every role the fallback rows top to bottom instead. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.
