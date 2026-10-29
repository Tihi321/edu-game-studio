# Edu Studio MCP guide

Edu Studio turns a topic into a playable educational game: a course (objectives, articles, items with answer keys, game shells) that a self-contained web player plays. This server lets an agent such as Claude Code drive the studio: see the courses and the job queue, and do the model work of the jobs itself, at no cost.

**Status: skeleton (EGS-01).** The course store, the player, the build and the content pipeline arrive in later tickets (see `ROADMAP.md`), so the tools below are the generic ones. Each later ticket adds its tools to this guide.

## Connect

- Port **7463** on 127.0.0.1 (`config/mcp.md`; `EDU_MCP_PORT` overrides it for one run, `yarn mcp --port N` too).
- Token: none by default. With a `token` in `config/mcp.md` (or `EDU_MCP_TOKEN`) every request must send `Authorization: Bearer <token>`. Settings > MCP sets and clears it.
- Only requests with a loopback `Host` and no foreign `Origin` are served.
- Claude Code: `claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp`
- Headless (no window): `yarn mcp` (= `node out/engine/index.js --mcp-only`). The app runs the same server while it is open.
- Stdio, for clients that cannot speak HTTP: `claude mcp add edu-studio -- yarn --cwd <repo> engine -- mcp`. It relays to the running engine when there is one, else it starts its own.
- Only one engine can use a data folder (`engine.lock` in it names the running one). A second start prints where the running one serves MCP.
- The data folder is `~/EduGames` (`--data <dir>` or `EDU_DATA` change it). A course lives in `courses/<slug>/`.

## Tools

All tool names start with `edu_`. Every call returns JSON, also as `structuredContent`; a failure is an error result with a message.

| Group | Tools |
|---|---|
| Courses | `edu_list_courses` (the courses in `courses/`), `edu_status {slug?}` (the job counts of a course, or of every course; `clientTasks`), `edu_wait {slug, timeoutSeconds?}` (waits until the course has nothing left to run), `edu_languages` |
| Queue | `edu_pause_all`, `edu_resume_all`, `edu_stop_now {drop?, slug?}`, `edu_clear_queue {slug?, confirm: true}` |
| Client provider | `edu_client_tasks`, `edu_get_task {client?, role?, book?, task?}`, `edu_submit_task {taskId, text}`, `edu_release_task {taskId}` |
| Generators | `edu_studios_status` (Pixel Studio, Chiptune Studio, flow-music-mcp), `edu_comfy_status`, `edu_comfy_free`, `edu_voice_status` |

A job id is `<slug>--<task>--<unit>--r<run>`, so `edu_status {slug}` finds the jobs of a course by their prefix.

## Do the model work yourself

The roles of the studio (the director now, the content team from EGS-06) ask a model for most of their work. Instead of LM Studio, Strata or a paid API you can answer them yourself, with nothing spent. Set a role (or one agent) to the model `client/claude-code`; its jobs then wait until you take them over MCP.

**Setting it up.** The `client` provider is on in the seed's `config/providers.md` and nothing uses it until you pick it:

```yaml
- id: client
  kind: client
  local: true
  concurrency: 8
  models:
    - id: claude-code
      vision: true     # the art-critic sends images
      context: 200000  # recorded only: Edu Studio sizes nothing by it
```

**Named clients.** Each model of the `client` provider is one named client: `client/claude-code` (what an `edu_get_task` without `client` takes) and `client/antigravity` (for Antigravity CLI). A task made for `client/antigravity` is never handed to a call without `client`, and the other way round; `edu_client_tasks` shows each task's `client`, and `edu_get_task` puts it in `meta.client`. Add another client with "Add a model by its id" on the `client` provider (Models page), and take its tasks with `client: "<id>"`.

**Choosing what the client does.** Put `client/claude-code` first in a role's `models` list in `config/roles.md` (for example `director: {models: [client/claude-code, strata]}`); it is reloaded at once, and a request that is already waiting is asked again on the new model. One agent: `model: client/claude-code` in `agents/<agent>.md`. Put things back when you are done: a role left on `client` with nobody answering stalls every job that uses it.

**The loop.**
1. Start the work (the pipeline tools come in EGS-08), then `edu_wait {slug}`. It returns as soon as nothing runs except jobs that wait for you, with `clientTasks: n` and a hint (it does not block until the timeout). `edu_status` shows `clientTasks: {waiting, leased}` too, and `edu_client_tasks` lists the tasks (id, role, task, course, age).
2. `edu_get_task {client?, role?, book?, task?}` leases the oldest matching task to you for 30 minutes (`client` is the client model you are: `claude-code`, the default, or `antigravity`; `book` is the course slug). You get `{taskId, meta: {job, call, role, task, book, agent, unit, client}, turns, system, user, schema?, maxTokens?, output, leaseMinutes}`, or `{none: true, waiting}`. Each text is sent once. `turns: "single"` (nearly every task) has `system` and `user`. `turns: "multi"` (a repair round) has `system` and `messages: [{role, content}]`, the turns after the system text in order, and no `user`: answer the last user turn.
3. Write the answer as `output` says: one JSON object that matches `schema` (no prose, no code fence), or the text only.
4. `edu_submit_task {taskId, text}`. When the task has a schema the text is checked first: `{accepted: false, problems}` means fix it and submit again (the task stays yours, so the engine does not spend a repair round). `{accepted: true}` lets the job go on as if a model had answered. `edu_release_task {taskId}` gives a task back.
5. Repeat until `edu_get_task` says `none`, then `edu_wait` again, until the jobs are done. A lease that runs out (30 minutes) puts the task back in the queue, so several clients, or subagents with one task each, can work in parallel.

**Vision.** Tasks of the art-critic carry images. `edu_get_task` returns them as MCP image content after the text, in order; the `user` text has `[image 1]`, `[image 2]` where each one sat.

**Good to know.**
- A job that waits for you does not hold its agent: only jobs on other models count against an agent's `max_parallel` (1 by default, `agents/<agent>.md`).
- No timeout, and the provider is never marked down: a waiting job just waits. A job you stop (`edu_stop_now`, a model change) drops its task, and a later submit gets "task not found (it was aborted, answered, or the engine restarted)". The queue lives in memory: an engine restart loses the tasks, and the running jobs ask again.
- A job that never calls a model (build, lint) runs as usual.

## The queue

- Jobs have a priority: what you ask for with a tool goes before the jobs of the pipeline's own chain, oldest first inside each. A job still waits for the jobs it depends on.
- `edu_stop_now` stops the running jobs and pauses; they and everything queued run again after `edu_resume_all`, oldest first. `edu_stop_now {drop: true, slug?}` also deletes the queued jobs (of that course, or all). `edu_clear_queue {slug?, confirm: true}` drops the queued jobs without stopping the running ones.
- Spending is capped by `config/budget.md` (a daily and a monthly cap, a per-course cap). A model that is local, or the client, costs nothing.

## Languages

`edu_languages` lists the 37 built-in course languages (code, English name, native name, right-to-left, script) and the ones added in `config/languages.md`. Player menu strings exist for Croatian so far; other languages keep the English menus until the player (EGS-03) extends the table.

## Notes

- Paths you pass are paths on the machine that runs Edu Studio.
- Image, music and voice generation (ComfyUI, Pixel Studio, Chiptune Studio, Flow, local TTS) are reached through the generator clients; their course tools arrive in EGS-15 to EGS-17. `edu_studios_status`, `edu_comfy_status` and `edu_voice_status` check that they are up.
- Never start the hub's book factory (Scriptorium) from here: Edu Studio only calls it over MCP when a game needs a story.
