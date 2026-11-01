# Live quiz

A Kahoot-style quiz for a class: the teacher starts a room for a course, the students open an address on their phones or laptops, type a join code and a nickname, and answer the same questions at the same time. A right answer scores more the faster it comes. After each question everybody sees whether they were right, the explanation of the question, and a leaderboard; at the end a podium.

Not included: accounts, an internet relay (it works on the local network only), anything saved after the room closes.

## Run it, step by step (for a teacher)

1. Build the course: `edu_build {slug}` (or `yarn engine -- build <slug>`). The quiz uses the built course.
2. Start the room with an MCP client: `edu_live_start {slug: "solar-system", questions: 10, secondsPerQuestion: 20}`. For phones on the school Wi-Fi add `lan: true` (see the warning below). `lang: "hr"` picks the edition (language) of the questions and of the screens; the default is the course's default edition.
3. The answer holds `code` (six digits), `playerUrls` and `hostUrl`. Open `hostUrl` in your browser: it shows the code in big letters, the addresses, the players as they join and the buttons.
4. Tell the students to open one of `playerUrls` (for example `http://192.168.1.20:41234/live/`) and type the code and a nickname (1 to 20 characters).
5. When everybody is in, press **Start**. Each question runs until its time is up, until every connected player has answered, or until you press **End question**. Then **Next** shows the leaderboard, **Next** again the next question. After the last question the podium appears.
6. **Close room** (or `edu_live_stop {roomId}`) ends it. `edu_live_status` lists the rooms and how many players answered.

The host page needs no MCP: every button on it is a plain request to the same server. Keep `hostUrl` to yourself: it contains the host token and whoever has it runs the room.

## The questions

The course's items of kind `mcq`, `true-false`, `multi-select` and `typed`, balanced over the units (items are taken from each unit in turn, in a seeded random order). A multi-select counts only when exactly the right set is picked: there is never partial credit. A typed answer is checked with the same tolerant matcher as the game (case, accents per the course setting, small typos). Items missing their text in the chosen edition are left out; if the course has fewer usable items than asked, the quiz is shorter and the tool says so.

Players receive only the prompt and the options (ids and texts) while a question is open. The right answer, the accepted typed answers and the explanation arrive with the reveal. The explanation of the item is always shown after the question, right or wrong (the studio's learning rule: explanatory feedback).

## Points

`1000 * (0.5 + 0.5 * remaining / total)` for a right answer (so 1000 at once, 500 at the last moment), plus 50 for every earlier right answer in a row (at most 200). A wrong or missing answer scores 0 and breaks the streak. The first answer of a player counts; an answer after the deadline is refused. The leaderboard shows the top five and your own rank; equal scores share a rank.

## The LAN warning

By default the room listens on `127.0.0.1`: only this machine can join (good for testing). With `lan: true` it listens on `0.0.0.0`, the tool lists the addresses of this machine's network interfaces, and **anyone on that network who has the address and the code can join**. On a school or guest network that can be many people. The code is six random digits and wrong tries are limited (10 a minute per address), but share it only with your class and stop the room when you are done. There is no encryption (plain http), so do not use it where somebody could read the network traffic and the code matters. The Windows firewall may ask whether to allow the engine on private networks.

## Limits

- 60 players per room; nicknames 1 to 20 characters, trimmed, no control or invisible characters, unique ignoring case. Nicknames are drawn as text only, never as HTML.
- Players can only join in the lobby (before Start); a player who loses the connection comes back to the same screen with the same page (the page keeps its token for the browser tab).
- An answer is at most 500 characters; a request body at most 4 KB.
- A room closes after 2 hours, or after 10 minutes without any open connection (players or host).
- A question ends early when every player who is connected has answered; a player whose phone is asleep is not waited for.

## Security notes

- One small `http` server per room (no new dependencies), under `/live/`. The client page has a CSP (`script-src 'self'`, no inline script), `X-Content-Type-Options: nosniff`, no referrer and no caching; every other answer is JSON.
- The join code and the host token come from the system's random generator (the host token has 128 bits) and are compared in constant time. The host token is only returned to the caller of `edu_live_start` and never appears in a player's page or stream. A wrong host token is a 404 and counts as a bad try.
- Wrong codes and wrong host tokens are limited per address (10 a minute, then 429 until the minute is over, even for the right code).
- Without `lan`, requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are refused (DNS rebinding); POSTs whose `Origin` is another site are refused.
- Players get the state through Server-Sent Events (`/live/events?token=`); the full view is sent on connect, so a reconnecting phone recovers. Streams are cleaned up when a player leaves, is removed by the host, or the room closes.
- The MCP server itself (port 7463) is not exposed by this feature; the live server is a separate port chosen by the system.

## Where the code is

`src/shared/live/` (questions, the room state machine, texts: pure), `src/engine/live/server.ts` (the http server) and `client-files.ts` (finds `out/live/`, like the player bundle; `EDU_LIVE_DIR` overrides), `src/live-client/` (the player and host pages, bundled by `vite.live.config.ts` to `out/live/live.js` and `live.css` with `yarn build:live`; `yarn build:engine` runs it), `src/engine/mcp/tools-live.ts` (the tools). Tests: `tests/live-room.test.ts`, `tests/live-server.test.ts`, `tests/edu-mcp.test.ts` and the browser test `tests/live-quiz.e2e.test.ts`.

The live client draws the questions itself (big buttons or a text box) and does not use the game's item renderers: those need the whole pack and game data, and the players must never get the answers.
