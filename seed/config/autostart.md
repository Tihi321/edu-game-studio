---
kind: autostart
# Start Pixel Studio, Chiptune Studio and ComfyUI by itself when a job needs one and it does not answer. The job waits, then goes on.
enabled: true
# The creative hub's service list: it has the start command, port and health URL of each tool.
registry: ../creative-hub/services.json
# Which of the three may be started (this list can only narrow them).
services: [pixel-studio, chiptune-studio, comfyui]
# Seconds to wait for a started service to answer. 0: the registry's startTimeout (ComfyUI 240), else 60.
startTimeoutS: 0
# Stop the services Edu Studio started when the engine stops. false: they stay up for the next job (hub.ps1 stop <id> stops them).
stopOnExit: false
---
# Auto-start

When a job calls Pixel Studio, Chiptune Studio or ComfyUI and nothing answers, Edu Studio starts it from the hub's `services.json`, waits until it answers (checked every half second), and retries the call once. Without this, Pixel Studio work falls back to the built-in pixelate and Chiptune and ComfyUI jobs fail and retry.

- `enabled`: `false` turns it off. `EDU_AUTOSTART=0` in the environment turns it off too (the tests do this).
- `registry`: the path of `services.json`. Missing or unreadable: auto-start is off, and the engine log says so once.
- `services`: a subset of `pixel-studio`, `chiptune-studio`, `comfyui`.
- `startTimeoutS`, `stopOnExit`: see above. With `stopOnExit` only what this engine run started is stopped (the process tree). If the engine is killed hard, the services stay up.

What is never started: Scriptorium (it resumes a paid book factory), Strata (it uses most of the GPU), LM Studio (a desktop app), and anything that is not on this machine (a remote ComfyUI lane). ComfyUI is also not started while Strata answers. A service the registry marks `managed: false` or with a `warning` is not started.

A studio with `pixelStudioExe` / `chiptuneStudioExe` set in `config/studios.md` is started as `<exe> --mcp-only`. If the studio's desktop app is open and holds its data folder, the started copy exits at once and the job gets that reason.

A failed start is not tried again for 5 minutes, and the job gets the usual "not running" error with `(auto-start: <reason>)` added. The service's output goes to the hub's `logs/<id>.out.log` and `<id>.err.log` (appended, after a line `--- started by Edu Studio <time> ---`), so `hub.ps1 logs <id>` shows it. The engine log and the job log say `autostart <id>: down, starting ...` and `up after N s`. Status checks (`edu_studios_status`, the Generators page) never start anything.
