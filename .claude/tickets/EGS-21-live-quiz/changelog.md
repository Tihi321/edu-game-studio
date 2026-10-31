# EGS-21 changelog: live multiplayer quiz

Scope built: a Kahoot-style live quiz on the local network (host = the engine, started by an MCP tool or run from a host page; players join with a code and a nickname). No accounts, no internet relay, nothing kept after the room closes.

## Changed (repo-relative)
- New `src/shared/live/` (`questions.ts`, `room.ts`, `strings.ts`, `index.ts`): question selection (kinds mcq, true-false, multi-select, typed; seeded, balanced over units; checked with the shared checkers; public view without keys), the room state machine (lobby, question, reveal, leaderboard, podium, closed; scoring; limits), hr and en client texts.
- New `src/engine/live/server.ts` (node `http`, SSE, host routes, rate limit, CSP, limits, auto-close, address selection) and `src/engine/live/client-files.ts` (finds `out/live/`, `EDU_LIVE_DIR`).
- New `src/live-client/` (`main.ts`, `player.ts`, `host.ts`, `common.ts`, `live.css`) and `vite.live.config.ts` (-> `out/live/live.js` + `live.css`).
- New `src/engine/mcp/tools-live.ts` (`edu_live_start`, `edu_live_status`, `edu_live_stop`); `src/engine/mcp/tools.ts`: import and one spread line.
- `package.json`: `build:live`; `build:engine` runs it. `tsconfig.player.json`: includes `src/live-client`, `src/shared/live`, `vite.live.config.ts` (DOM lib). `tests/setup/player-bundle.ts`: also builds `out/live`.
- Tests: `tests/live-helpers.ts`, `tests/live-room.test.ts`, `tests/live-server.test.ts`, `tests/live-mcp.test.ts`, `tests/live-quiz.e2e.test.ts`.
- Docs: `docs/live-quiz.md`, a row in `docs/mcp-guide.md`, a pointer in `docs/player.md`. README.md and ROADMAP.md untouched (the parent edits them).

## Decisions
- The question is drawn by the live client as big buttons / a text box, not by the game's item renderers: they need the whole pack and `GameData` (with the keys), which players must never get.
- One http server (own ephemeral port) per room; `lan: true` binds 0.0.0.0, otherwise 127.0.0.1. Rooms are kept per `EduService` and are not restarted with the engine.
- Players join only in the lobby; the question ends early when every CONNECTED player has answered.
- Player tokens are looked up in a map (128 random bits); the host token and the join code are compared in constant time.

## Verification
See the final report of the run: typecheck (node, web, player), eslint, the three builds, and the targeted tests.

## Not run
- Real phones on a real LAN (only 127.0.0.1 was bound; the 0.0.0.0 bind is covered by the address-selection unit test, which does not listen).
- The packaged Electron installer (the repo has no packaging config; the engine finds `out/live/` by walking up from `out/engine/`, like `out/player/`).
- The whole vitest suite (the parent runs it).
