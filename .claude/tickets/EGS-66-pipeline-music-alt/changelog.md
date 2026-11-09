# EGS-66 changelog

- `src/engine/edu/pipeline.ts`: `musicFlow` marks the music steps done when the manifest holds sounds made by the asset tools (`soundsMade`).
- `src/engine/edu/media-link.ts` + `store.ts`: `defaultAlts`, the alt text of merged assets is given to every existing edition catalog.
- `src/engine/queue/jobs.ts` + `engine.ts`: `recoverRunning` reports requeued jobs older than 3 days, the start log names them.
