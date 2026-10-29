# Engine protocol

The UI talks to the engine with `Command`s and receives `EngineEvent`s (`src/shared/protocol.ts` has the types, and describes the transport). In the app the link is an Electron `utilityProcess` port; headless, MCP tools call the same `EduService` that handles these commands (`src/engine/edu/service.ts`).

This page lists what the skeleton (EGS-01) has. Later tickets add the course commands (EGS-02), build and lint (EGS-03) and the pipeline (EGS-08).

## Commands the engine accepts

| Command | Answer |
|---|---|
| `{ type: 'snapshot' }` | `snapshot`: agents, models, providers, spend, settings, role defaults, secrets that are set (never their values) |
| `{ type: 'ping', id? }` | `pong` |
| `{ type: 'listCourses' }` | `courses.listed { courses: { slug, title, updatedAt }[] }`: the folders of `courses/` that have a `course.md` or a `course/pack.json` |
| `{ type: 'hire' / 'fire' / 'pause' / 'resume' / 'stop', agent }`, `pauseAll`, `resumeAll`, `stopNow` | `agent.*`, `factory.paused` |
| `{ type: 'setModel', model, agent? / role? }` | `agent.updated`, `snapshot` |
| `{ type: 'detectModels' / 'showModels' / 'addModel' / 'setProviderLimits' }` | `models.catalog`, `snapshot` |
| `{ type: 'saveCustomProvider' / 'removeCustomProvider' / 'testCustomProvider' }` | `provider.saved`, `provider.tested` |
| `{ type: 'saveSettings', ... }` | `snapshot` (the fallback list, LM Studio loading) |
| `{ type: 'setSecret', name, value }` | `secrets.updated` (stored in the credential store, never in a file) |
| `{ type: 'mcpStatus' }`, `{ type: 'saveMcpConfig', enabled, port, token? }` | `mcp.status` |
| `{ type: 'comfyStatus' / 'comfyFree' / 'listEngines' / 'listCustomWorkflows' }` | `comfy.status`, `comfy.freed`, `engines.listed`, `workflows.listed` |
| `{ type: 'voiceStatus' }`, `{ type: 'studiosStatus' }` | `voice.status`, `studios.status` |
| `{ type: 'checkServers' }` | `servers` |

A command that fails answers with `command.error { command, message, slug? }`.

## Events the engine sends

`engine.ready`, `engine.heartbeat`, `engine.warning`, `snapshot`, `agent.state`, `agent.hired`, `agent.removed`, `agent.updated`, `agent.problem`, `factory.paused`, `job.started`, `job.model`, `job.token`, `job.done`, `handover`, `spend`, `servers`, `secrets.updated`, `provider.tested`, `provider.saved`, `models.catalog`, `mcp.status` and the answers above.

## The data folder

```
~/EduGames/                 (EDU_DATA or --data change it)
  config/                   providers, roles, models, settings, budget, mcp, studios, autostart, comfy, voice, languages
  agents/                   one markdown file per agent (the starter staff is copied once)
  prompts/<role>/<task>.md  the prompt templates
  courses/<slug>/           one folder per course (EGS-02 defines its files)
  jobs/{queued,running,done,failed}/   one markdown file per job
  logs/                     agent logs, spend rows
  engine.lock               which engine owns the folder, and where it serves MCP
```

`seed/` in the repo is copied into a new data folder. A seeded file you did not edit gets the newer version at the next start; one you edited is kept and an "update available" note is logged.
