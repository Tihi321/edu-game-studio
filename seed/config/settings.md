---
kind: settings
fallbacks:
  - deepseek/deepseek-flash
  - strata/qwen3.8-flash-next
  - lmstudio/gemma-4-e4b-it
fallback_shared: false
lmstudio_parallel: 4
lmstudio_context: 131072
lmstudio_ttl_minutes: 60
---
# Settings

## Default models

`fallbacks` is the list of models the pipeline falls back through, first row first. It can have any length, and a kind may repeat: for example API, API, LM Studio, API. Each row is one `provider/model`. Its **kind** comes from the model's provider, so a row can't disagree with its model: an API provider (free or paid) is `paid`, any other provider is named by its id (`strata`, `lmstudio`, `client` ...). Edit the list here or on the app's Models page (a kind, then its model, with add, remove, up and down). A change applies at once, to running jobs too.

The role lists in `roles.md`, an agent's `model` and a course's `models` can name a kind instead of a model: `paid` is the first API row, `paid-2` the second, `strata` the first Strata row, `lmstudio-2` the second LM Studio row, `client` the first client row. A name with no matching row is skipped (the engine logs it once). An agent's own model, picked in the app, still goes first.

- `fallbacks`: the rows, for example the three below. At least one.
- `fallback_shared`: `true` gives every role the rows top to bottom (the Models page's "One fallback order for every role"). A role's own concrete model of the same kind takes the place of the first row of that kind not taken yet (the checks name Strata's `-low` model, so it takes the Strata row's place). A model with no row of its kind, such as that one without a Strata row, comes after the rows. A role gets every row, even for a kind its own list leaves out. `false` keeps each role's own order from `roles.md`, and the rows only say what `paid`, `strata`, `lmstudio` ... stand for.

```yaml
fallbacks:
  - deepseek/deepseek-flash                 # paid
  - openrouter/google/gemma-4-31b-it:free   # paid-2
  - lmstudio/gemma-4-e4b-it   # lmstudio
  - deepseek/deepseek-v4-pro                # paid-3
```

## LM Studio loading

When a request goes to an LM Studio model that isn't loaded, the engine loads it first with these settings (also in the app's Models panel, under lmstudio) (through `lms load`, or LM Studio's API when the `lms` command isn't installed). A model that is already loaded is used as it is.

- `lmstudio_parallel`: how many requests the model serves at once (`--parallel`). 1 means one at a time.
- `lmstudio_context`: the context window (`-c`). The parallel requests share it: one request may use all of it (checked 2026-10-11). A long fact-check takes about 23,000 tokens with its answer, so plan about 25,000 per request that runs at once: 131072 suits Gemma 4 E4B with 4 at once. A model in `providers.md` can have its own `load_context` and `load_parallel` (the big Qwen models use 65536 and 2).
- `lmstudio_ttl_minutes`: LM Studio unloads the model after this many idle minutes (`--ttl`).
