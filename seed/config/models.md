---
kind: models
picked: []
hidden: []
limits: {}
---
# Models in the pickers

Which models the model pickers offer (the agent panel, Role defaults and the default models). The app writes this file from its **Models** panel (the Models button in the top bar): pick a provider, press **Detect models** to list everything it has, and tick the models you want, or add one by its id (with its price for a paid provider). You can also edit it by hand.

- `picked`: models that are not in `providers.md`, ticked from a provider's list or added by id, each with its `provider`, `id`, `context` and the price the provider listed when you picked it (or the one you typed) (`price_in`, `price_out`, `price_cached_in`, USD per 1M tokens). The budget counts them at that price. A paid model is only ticked with a listed price; for one whose price the provider doesn't list (DeepSeek's), add it by id with its price.
- `hidden`: `provider/model` refs the pickers leave out: models from `providers.md` or found by `discover` that you unticked. A role list in `roles.md` can still name a hidden model.
- `limits`: per provider, the limits set in the Models panel, over the ones in `providers.md`: `concurrency` (requests at once), `rpm` (per minute) and `rpd` (per day, from midnight UTC). 0 means no limit.
