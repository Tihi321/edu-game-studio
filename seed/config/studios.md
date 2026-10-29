---
kind: studios
# Pixel Studio (pixel art) and Chiptune Studio (music): the user's own apps. Each runs an MCP server.
# Start one without a window: `cd <repo> && yarn build && yarn mcp` (or `<exe> --mcp-only`).
pixelStudioUrl: http://127.0.0.1:7457/mcp
chiptuneStudioUrl: http://127.0.0.1:7458/mcp
# Where the code is: used for the start hints and to open a window ("Open in Pixel Studio / Chiptune Studio" on an asset).
pixelStudioRepo: ../pixel-art-generator
chiptuneStudioRepo: ../midi-generator
# A packaged app to launch instead of `yarn electron .` in the repo. Empty: use the repo.
pixelStudioExe: ''
chiptuneStudioExe: ''
# Bearer tokens, only when the app's MCP server asks for one (Settings -> MCP in the app). The environment variables
# PIXEL_STUDIO_MCP_TOKEN / CHIPTUNE_STUDIO_MCP_TOKEN and the credential store win over these two fields.
pixelStudioToken: ''
chiptuneStudioToken: ''
# flow-music-mcp: Google Flow images (free), narration voices (free Gemini and Windows engines) and Flow Music songs (SPEND CREDITS).
# Used when a course's art / voice / music provider is `flow`. Start it: hub.ps1 start flow-music-mcp. Sign in once: yarn login in the repo.
flowUrl: http://127.0.0.1:7462/mcp
flowRepo: ../flow-music-mcp
# The bearer token of its MCP server; the environment variable FLOW_MUSIC_MCP_TOKEN and the credential store win over this field.
flowToken: ''
# Scriptorium (the hub's book factory): a course with story: scriptorium hands its story idea over MCP. Edu Studio NEVER starts it (its engine resumes
# the whole book factory and may use paid models): start it yourself. Its token is only needed when its MCP server asks for one.
scriptoriumUrl: http://127.0.0.1:7341/mcp
scriptoriumToken: ''
# Seconds per wait call (at most 50), and when to give up on one image job / one song.
flowPollS: 40
flowJobTimeoutS: 900
flowMusicTimeoutS: 600
# Image download size per kind: upscaled (2K) or original (1K, 1376x768 at 16:9, below 1920x1080).
flowImageQuality: { background: upscaled, cover: upscaled, cg: upscaled, sheet: original, sprite: original, insert: original }
# Voices: pause between two narration calls (ms) and retries of a clip on a rate limit (waits 10 s, 30 s, 90 s).
flowVoicePauseMs: 1500
flowVoiceRetries: 3
# The most songs one course may make with Flow Music (each spends credits; counted from the asset versions).
flowMusicMaxSongs: 4
# Timeouts in seconds: short calls, an image import or export, a track render.
timeoutS: 15
importTimeoutS: 120
renderTimeoutS: 300
# The pixel-studio-draw mode (an agent draws small sprites): at most this many model steps and seconds per sprite (0 seconds: no limit).
drawSteps: 12
drawTimeoutS: 240
# How the sprite is drawn: auto, loop or grid (see below). auto: grid when the job's model is the client (an MCP client), else loop.
drawMode: auto
---
# Studios

Where Edu Studio finds the two studio apps.

- `pixelStudioUrl`, `chiptuneStudioUrl`: the MCP endpoints (`EDU_PIXEL_STUDIO_URL` and `EDU_CHIPTUNE_STUDIO_URL` override them).
- `pixelStudioRepo`, `chiptuneStudioRepo`: the folders of the apps (start hints, and the window of "Open in ...").
- `pixelStudioExe`, `chiptuneStudioExe`: a packaged app to launch instead.
- `flowUrl`, `flowRepo`, `flowToken`, `flowPollS`, `flowJobTimeoutS`, `flowMusicTimeoutS`, `flowImageQuality`, `flowVoicePauseMs`, `flowVoiceRetries`, `flowMusicMaxSongs`: flow-music-mcp (Google Flow), used when a course's art, voice or music provider is `flow` (`EDU_FLOW_URL` overrides the URL; the token variable is `FLOW_MUSIC_MCP_TOKEN`). Images and the Gemini / Windows voices are free; Flow Music songs spend credits and are capped per project by `flowMusicMaxSongs`.
- `scriptoriumUrl`, `scriptoriumToken`: Scriptorium's MCP endpoint (`EDU_SCRIPTORIUM_URL` overrides it; the token variable is `SCRIPTORIUM_MCP_TOKEN`). Used only when a course's brief says `story: scriptorium`: the narrative designer's story idea is added with Scriptorium's `add_story`. **Edu Studio never starts Scriptorium**: starting it resumes its whole book factory, which may spend on paid models. When it is down the story step is skipped, with the start hint.
- `pixelStudioToken`, `chiptuneStudioToken`: the bearer token of an app whose MCP server needs one (shown in its Settings -> MCP). It is sent as `Authorization: Bearer <token>`. Where it is looked up, first match wins: the environment variable `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`, the Windows credential store under the same name (`yarn key:set PIXEL_STUDIO_MCP_TOKEN`), then this field. Keep tokens out of files you share: prefer the first two. An app that answers 401 gives the message "rejected the token: set <VAR> ...".
- A course picks them in its settings: music provider `chiptune` (the default for pixel-style courses), pixel provider `pixel-studio`.
- `drawSteps`, `drawTimeoutS`, `drawMode`: how a sprite is drawn in the `pixel-studio-draw` mode (pixel art). `loop`: the model calls Pixel Studio's drawing tools turn by turn, up to `drawSteps` turns and `drawTimeoutS` seconds (checked between turns). `grid`: one model request for the whole sprite, with no time limit: the reference is reduced to the palette and sent as rows of characters (`.` transparent, `0-9a-zA-Z` the palette colours, as in Pixel Studio's `draw_grid`), the model answers the cleaned-up rows, and Edu Studio paints them with `draw_grid` calls of at most 64x64 pixels and exports as the loop does (so "Open in Pixel Studio" works). Rows that do not fit the grid get one repair round, then the image is converted instead. Without Pixel Studio running, the PNG is built from the rows here. `auto` picks `grid` for a client model (it can take minutes per answer) and `loop` for any other; with a client model the loop has no time limit either.
- When a studio is not running, Edu Studio starts it first if a job needs it (`config/autostart.md`, from the creative hub's `services.json`). Only when that fails (or is off) is a pixel image made with the built-in converter instead (with a warning on the asset), and music from Chiptune Studio fails with the start hint.
- Pixel Studio makes the pixel art of a course's RPG tile set and sprites (the course's `media.art.pixelProvider`, default `pixel-studio`; `builtin` never asks it). Google Flow makes a course's images only when the course sets `media.art.provider: flow` (or one asset sets `provider: flow` with `edu_asset_set`); nothing calls Flow by default.
