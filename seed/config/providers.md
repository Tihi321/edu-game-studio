---
kind: providers
providers:
  - id: deepseek
    kind: openai-compat
    base_url: https://api.deepseek.com
    api_key_env: DEEPSEEK_API_KEY
    concurrency: 8
    json_schema: false             # DeepSeek answers response_format json_schema with HTTP 400 ("unavailable now"), checked 2026-10-12
    models:
      - id: deepseek-flash
        family: deepseek
        context: 1000000
        price_in: 0.30
        price_out: 1.20
        price_cached_in: 0.006
        extra_body: { thinking: { type: disabled } }
      - id: deepseek-v4-pro
        family: deepseek
        context: 1000000
        price_in: 1.32
        price_out: 3.96
        price_cached_in: 0.044
        extra_body: null
  - id: openrouter
    kind: openai-compat
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    concurrency: 4
    rpm: 20                        # OpenRouter's limit for the free models
    rpd: 50                        # free-model requests per day without credits (1000 after buying 10 credits): then the next model
    discover: free                 # adds every model OpenRouter lists at price 0 (the `:free` ones); a paid one goes in the list below
    discover_skip: [content-safety]
    json_schema: false             # not every model there supports response_format; the engine checks and repairs the JSON instead
    models:
      # to verify
      - id: google/gemini-2.5-flash
        family: gemini
        vision: true
        context: 1000000
        price_in: 0.30
        price_out: 2.50
  - id: anthropic
    kind: anthropic
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
    concurrency: 4
    models:
      # to verify
      - id: claude-sonnet-4-5
        family: claude
        vision: true
        context: 200000
        max_output: 16000
        price_in: 3
        price_out: 15
        price_cached_in: 0.30
  - id: gemini
    kind: gemini
    base_url: https://generativelanguage.googleapis.com
    api_key_env: GEMINI_API_KEY
    concurrency: 4
    models:
      # to verify
      - id: gemini-2.5-flash
        family: gemini
        vision: true
        context: 1000000
        price_in: 0.30
        price_out: 2.50
        price_cached_in: 0.03
  - id: lmstudio
    kind: openai-compat
    local: true
    base_url: http://localhost:1234/v1
    concurrency: auto             # the sum of `parallel` over the loaded chat models (lms load --parallel <n>), 1 when none is loaded
    discover: true
    discover_skip: [dflash]       # LM Studio lists these, but they are not models it can load here
    load_models: true             # load a model that isn't loaded yet with lmstudio_parallel, lmstudio_context and lmstudio_ttl_minutes from settings.md
    # For the art-critic, add a vision model you have in LM Studio (for example a Qwen-VL) with `vision: true`:
    #   - id: qwen2.5-vl-7b-instruct
    #     family: qwen
    #     vision: true
    models:
      - id: ista-daslab-qwen3.8-27b-gsq-rco-unsloth-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
        load_context: 65536
        load_parallel: 2
      - id: nail-qwen3.6-35b-a3b-mtp
        family: qwen
        extra_body: { reasoning_effort: low }
        load_context: 65536
        load_parallel: 2
      - id: poolside/laguna-s-2.1
        family: poolside
        extra_body: { reasoning_effort: none }
      - id: tiel-coder-35b-a3b-mtp
        family: qwen
        extra_body: { reasoning_effort: none }
      - id: gemma-4-e4b-it
        family: gemma
        extra_body: { reasoning_effort: none }
  - id: strata
    kind: openai-compat
    local: true
    base_url: http://127.0.0.1:8080/v1
    api_key_env: STRATA_API_KEY   # optional: only sent if set
    concurrency: auto             # as many as the running Strata serves (its /v1/status): 4 or 1, by the script you started
    discover: false               # Strata answers any model name, so fixed ids keep roles.md the same across quants
    json_schema: false
    models:
      - id: qwen3.8-flash-next
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: qwen3.8-flash-next-low
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: low }
  - id: ollama
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://localhost:11434/v1
    concurrency: 1
    discover: true
    models: []
  # The ACP proxy (api-acp-proxy: Antigravity, Codex and Claude through ACP) as an OpenAI-style server. Off until you start the proxy and switch it on.
  # Text only. See "ACP proxy" below for the proxy settings it needs.
  - id: acp
    kind: openai-compat
    enabled: false
    local: true
    base_url: http://127.0.0.1:7461/v1
    concurrency: 2
    json_schema: false
    discover: true
    models: []
  # Model work done by an MCP client (Claude Code). It is on, and harmless until a role, an agent or a project names it
  # (client/claude-code in config/roles.md, `model:` in agents/<agent>.md, or the project's models). See the "Client" section below.
  - id: client
    kind: client
    local: true
    concurrency: 8                # how many jobs may wait for the client at once
    models:
      - id: claude-code
        vision: true              # the art-critic sends images
        context: 200000
      - id: antigravity           # Antigravity CLI takes these with edu_get_task {client: "antigravity"}
        vision: true
        context: 1000000
---
# Providers

One entry per provider. Edit this file and the engine picks the change up without a restart. API keys are never written here: `api_key_env` names an environment variable, and the engine also looks in the Windows credential store under that name (`yarn key:set <NAME>`).

Prices were checked 2026-10-08 from third-party listings; the DeepSeek ones were updated 2026-10-11 from the DeepSeek docs. `deepseek-flash` is DeepSeek-V4.1-Flash (the old name `deepseek-v4-flash` still works, but is served by V4.1 at the Flash price) and `deepseek-v4-pro` is DeepSeek-V4-Pro-0813. DeepSeek charges a peak and an off-peak price; the config holds the peak price, so the budget never counts too little (off-peak is half of it). Verify them at api-docs.deepseek.com/quick_start/pricing and the other providers' pricing pages. The OpenRouter, Anthropic and Gemini entries are examples marked "to verify": model ids and prices there may be out of date.

## Fields of a provider

- `id`: the name used in model references. A model is written `provider/model`, for example `lmstudio/nail-qwen3.6-35b-a3b-mtp`.
- `kind`: `openai-compat` (any OpenAI-style API), `anthropic`, `gemini`, `client` (an MCP client answers, see below), or `mock` (scripted answers, only for the tests: the app's own config has none, so the model pickers never offer one).
- `enabled`: `false` switches the provider off. A provider whose key can't be found is skipped automatically.
- `name`: the name shown in the app (the id when missing).
- `custom`: `true` for a provider added in the app's **Models** page (Add provider). The app can edit and remove those entries, and only those: it never touches the others or the comments here. A custom provider is its own group in the fallback order, named by its id, and can be written in `roles.md` as `acp-home` (the id) like `strata`. Its key is stored under `CUSTOM_<ID>_API_KEY`; removing the provider deletes that key.
- `local`: `true` for models on this machine. Local models cost nothing and never count against the caps. Their tokens and time are still recorded.
- `base_url`, `api_key_env`: where to call and which variable holds the key.
- `concurrency`: how many requests may run at once. `auto`: as many as the server says it serves at once, asked at start and every 10 seconds, 1 while the server is down. A server that doesn't answer is skipped: its jobs go straight to the next model in the role (no failed retries first) until it answers again, and the office shows the model that really answers. The first request that can't connect marks it down at once for every agent, and the status bar shows it as off with a **Check now** button for right after you start it. Strata reports it as `concurrency.serving` of `<base_url>/status`, so it follows the script you started: 4 with a `-parallel` script, 1 with a `-solo` one, and nothing in this file changes when you switch. For LM Studio it is the sum of `parallel` over the loaded chat models (from LM Studio's `/api/v1/models`): load a model with `--parallel 4` and four requests go to it at once. Requests in parallel share the GPU, so each one is slower, but the total is higher.
- `rpm`, `tpm`: optional rate limits (requests and tokens per minute). Only `rpm` is enforced for now.
- `rpd`: optional requests per day, counted from midnight UTC (when OpenRouter's daily limit starts again), also across restarts. A provider that reached it, or that answers that its daily limit is used up, is skipped until then: its jobs go to the next model in their role.
- The app's **Models** panel sets requests at once, per minute and per day for each API provider. It saves them in `limits` of `config/models.md`, which win over the values here.
- `discover`: ask the provider for its models (`GET /v1/models`) and add the ones not listed here. `discover_skip` leaves out models whose id contains one of its words (any case): LM Studio skips `dflash`, which it lists but can't load here. `discover: free` adds only the models the provider lists at price 0. A model of a paid provider is only added with the price the provider lists, so the budget always counts its cost: one listed without a price is left out (add it below with its price). Models that answer with something besides text (music, images) are left out. Discovery runs at start, when a key is stored and when this file changes.
- `json_schema`: `true` (the default) sends the JSON schema of a structured answer as `response_format`. Set `false` for a server that answers a bad JSON reply with an error instead of constraining it. The prompt then asks for the JSON shape and the engine checks it and repairs it.

## Client (Claude Code does the model work)

`kind: client` has no server and no key: a request waits in the engine's in-memory client task queue until an MCP client takes it (`edu_get_task`) and answers (`edu_submit_task`). It is `local: true`, so it is free, never paid and never budget-checked, and it has no timeout and is never marked down. Give it `concurrency` (8 is enough for the scheduler not to stall on `waiting-provider`) and a model such as `claude-code` (`vision: true` if the client can look at images; the art-critic needs that).

Each model is a named client: a task made for `client/antigravity` is only handed to a client that asks for `antigravity` (`edu_get_task {client: "antigravity"}`); a `edu_get_task` without `client` takes the `claude-code` ones. The seed has `claude-code` and `antigravity`; add another with **Add a model by its id** on the `client` provider (the Models page). See the guide, "Antigravity CLI as a client".

- It is on by default (the entry above), and nothing uses it until you pick it. `context` is only recorded: nothing here sizes a prompt by it. Use it for one project: `edu_update_settings {slug, models: {"art-director": "client/claude-code"}}` (saved as `models` in the project's `project.md`, first in that project's model lists). Or for every project: put `client/claude-code` first in a role's list in `config/roles.md`, or set one agent's `model:` in `agents/<agent>.md` (reloaded at once; a running request is asked again on the new model).
- A role left on `client` with nobody answering stalls every job of that role. Put the models back when the run is done.
- The queue is lost when the engine restarts: the running job is asked again (a new task). See the guide (`edu-studio://guide`, "Do the model work yourself").

## ACP proxy

The `acp` entry (off by default) is for `api-acp-proxy`, a server on `http://127.0.0.1:7461/v1` that answers OpenAI-style requests through Antigravity, Codex or Claude over ACP. Start it yourself, then set `enabled: true` (or use the Models page), press **Detect models** and tick the models you want.

- Start it with `PROXY_IGNORE_SAMPLING=1`: Edu Studio sends `temperature`, `max_tokens` and `stream_options`, which the proxy otherwise passes on or rejects.
- It is text only: no vision, so it can't serve the art-critic (use `client/antigravity`, `client/claude-code` or a vision model there).
- `PROXY_TIMEOUT_MS` (5 minutes by default) must cover your longest request, or long jobs fail.
- `local: true` makes it free here (no key, never counted against the caps), but the subscription behind it has its own limits and terms. Using Antigravity's models through a proxy may break Google's terms: see the creative-hub `ROADMAP.md`, "Antigravity models and the ACP proxy", before relying on it.
- Any other OpenAI-style server can be added in the Models page with **Add provider**.

## Strata

Strata (`<your Strata folder>`) is a fast local server for Qwen3.8-Flash-Next with an OpenAI-style API. Edu Studio only connects to it, you start it:

- Four agents at once or one: every model has two scripts in `<your Strata folder>`, `run-<model>-parallel.bat` (`"parallel": 4`, without `--batch-mtp`, which was slower) and `run-<model>-solo.bat` (one at a time), for `iq3_s`, `iq2_xs` and `coder-iq1_m`. The older `run-iq3_s.bat` is solo, `run-iq2_xs.bat` and `run-coder-iq1_m.bat` are four at once. Measured on 2026-10-11 (2.5K-token prompt, 600 tokens out): one request about 28 tok/s, four at once about 41 tok/s in total (about 10 each); solo four in a queue about 29 tok/s; with `--batch-mtp` about 31. IQ3_S stays solo (one request at a time). Each slot takes about 1.8 GB of VRAM from the expert cache.
- Run `<your Strata folder>\run-iq3_s.bat` (or `run-iq2_xs.bat`). Loading the model takes 1 to 3 minutes. Check `curl http://127.0.0.1:8080/health` and wait for `loaded: true`. Until it answers, jobs skip it and use the next model in the role; a few seconds after it answers (the check runs every 10 seconds) they go back to Strata.
- It serves one model per process, and every quant uses port 8080. It ignores the `model` field of a request, so the two ids above (no thinking, and thinking on `low`) only differ in `extra_body`. They stand in for the 27B editors and the 35B checks.
- The IQ3_S quant takes about 84 GB, so it does not fit beside the big LM Studio models: keep only the nomic embedding model loaded in LM Studio while it runs. The IQ2_XS quant (`run-iq2_xs.bat`) takes about 48 GB, at some cost in quality. Both answer to the same model ids, so `config/roles.md` stays the same whichever you start.
- `context` must match `--max-context` in the run config (131072).
- `json_schema: false` because Strata checks a structured answer after the fact and fails the request (502 `structured_output_failed`) when it is bad. That would be retried and then sent to a paid model, while the engine's own parse-and-repair step already copes with a loose JSON answer.
- No key is needed. `STRATA_API_KEY` is only sent if you set it.

## OpenRouter

One key (`OPENROUTER_API_KEY`, stored in the app's settings) gives many models. `discover: free` adds every free one OpenRouter lists, with its context and output limit, so they show in the model pickers as `openrouter/<maker>/<model>:free` (19 on 2026-10-12, `openrouter/openrouter/free` among them: OpenRouter picks a free model for each request). Free models cost nothing and never count against the caps. OpenRouter limits them to 20 requests a minute and 50 a day, or 1000 a day once the account has bought $10 of credit. A rate-limited request is retried with backoff, then the next model in the role takes it. For a paid OpenRouter model, tick it in the app's Models panel (the Models button in the top bar; Detect models lists them all), or add it there by its id: it is saved in `config/models.md` with the price OpenRouter lists. You can also add it to the list here with its price from openrouter.ai/models, or set `discover: true` to add all of them (about 450) with the prices OpenRouter lists. The Models panel also unticks models you don't want in the pickers.

## DeepSeek

- `json_schema: false`: DeepSeek answers `response_format: json_schema` with HTTP 400 ("This response_format type is unavailable now"), so every structured job failed there at once. The prompt asks for the JSON shape instead, and the engine checks and repairs the answer. Checked 2026-10-12.

## Fields of a model

- `id`, `family` (used so reviewers can avoid the writer's family), `context`, `max_output`.
- `price_in`, `price_out`, `price_cached_in`: USD per 1M tokens. Cached input falls back to `price_in` when missing.
- `embedding: true` marks an embedding model.
- `vision: true` marks a model that accepts images in a message. The art-critic is only offered these. Anthropic's Claude and Gemini models are vision models; for a local model, set it on the entry (or in `picked` of `config/models.md`).
- LM Studio models load with a small context window (8192 tokens) unless you change it. Long books need more: the engine reads the loaded window from LM Studio and keeps its prompts within it, but a window of 8192 makes long-book prompts fail. Load the models you use with 32768 or more, for example `lms load nail-qwen3.6-35b-a3b-mtp -c 32768 --parallel 1 --ttl 28800 -y`, or set it in LM Studio's model settings. With `--parallel <n>` the requests running at once share that window, so give it more room when several long requests run together, for example `lms load gemma-4-e4b-it -c 131072 --parallel 4 --ttl 28800 -y`.
- `load_models: true` (LM Studio): before a request to a model that isn't loaded, the engine loads it with `lmstudio_parallel`, `lmstudio_context` and `lmstudio_ttl_minutes` from `config/settings.md`, using `lms load` (or LM Studio's API when `lms` isn't installed). A model that is already loaded is used as it is, so one you loaded yourself keeps your settings. A model entry can override the context and parallel count with `load_context` and `load_parallel` (the big Qwen models use 65536 and 2: their context cache takes far more memory than Gemma's). A model LM Studio doesn't have fails at once and the next model in the role's list is tried.
- `extra_body`: optional JSON fields merged into the request body. The LM Studio chat models here send `reasoning_effort: none`, which turns thinking off (checked 2026-10-08 on the Qwen models: a 500-word story took 25 s instead of 3.5 minutes, because the model otherwise spends thousands of hidden tokens thinking). The Qwen 35B MoE (used for review) uses `low` so its verdicts are steadier. Remove it, or set `low` or `medium`, if you want thinking back for the other models. DeepSeek V4 has thinking on by default and bills it as output. `deepseek-flash` sends `thinking: { type: disabled }` (checked 2026-10-11: with thinking on, a 15k-token continuity check spent all 6000 answer tokens thinking and returned nothing). `deepseek-v4-pro` keeps thinking on. Empty means nothing extra is sent.
