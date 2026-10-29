---
kind: mcp
# The MCP server (Streamable HTTP, on 127.0.0.1 only) that lets an outside agent drive Edu Studio.
# It runs inside the app's engine while Edu Studio is open, or alone with `yarn mcp` / `<exe> --mcp-only` (no window).
enabled: true
# 7457 (Pixel Studio), 7458 (Chiptune Studio) and 7462 (flow-music-mcp) are taken.
port: 7463
# A bearer token clients must send as `Authorization: Bearer <token>`. Empty: no token (the server only listens on this computer).
token: ''
---
# MCP server

- `enabled`: start the server with the engine. Off: nothing listens, and `yarn engine -- mcp` (stdio) starts its own engine instead.
- `port`: `EDU_MCP_PORT` overrides it for one run (`--mcp-only --port N` does too).
- `token`: `EDU_MCP_TOKEN` overrides it. Settings > MCP can set and clear it.
- Changing this file restarts the server when the port or the token changed.
- Connect: `claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp`. The guide an agent should read first is the resource `edu-studio://guide`.
- Only one engine can use a data folder: `engine.lock` in it names the running one. A second start prints where the running one serves MCP.
