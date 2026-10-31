# EGS-21 Live multiplayer quiz

Scope (what is built): a Kahoot-style live quiz on the local network. The host (the engine, started by `edu_live_start`) runs one room for one course; players open a URL, enter a code and a nickname and answer the same questions together. Not built: accounts, an internet relay, persistence beyond the session.

## Design
- `src/shared/live/` (pure): `questions.ts` (selection from the pack: kinds mcq, true-false, multi-select, typed; seeded shuffle, balanced over units; public view strips keys), `room.ts` (state machine lobby -> question -> reveal -> leaderboard -> ... -> podium -> closed; scoring 1000 * (0.5 + 0.5 * remaining/total) + streak bonus, never partial credit; injected clock and token maker), `strings.ts` (hr, en UI texts).
- `src/engine/live/server.ts`: node `http` only, one server per room under `/live/`, SSE for views, host routes under `/live/host/<hostToken>/`, bind 127.0.0.1 unless `lan: true`, join-code rate limit per IP, 4 KB bodies, CSP, nosniff, constant-time token compare, auto-close (2 h, 10 min without a connection).
- `src/engine/live/client-files.ts`: finds `out/live/live.{js,css}` like the player bundle (`EDU_LIVE_DIR` overrides).
- `src/live-client/` + `vite.live.config.ts`: one IIFE for the player screens and the host page. The question is drawn as big accessible buttons (the real item renderers need the whole pack and game data, which players must never get; the public view carries only prompt and option texts).
- `src/engine/mcp/tools-live.ts`: `edu_live_start`, `edu_live_status`, `edu_live_stop`.
- Tests: state machine, server over fetch + SSE, MCP tools, Playwright e2e with a host page and three player pages.
- Docs: `docs/live-quiz.md`, pointers in `docs/mcp-guide.md` and `docs/player.md`.
