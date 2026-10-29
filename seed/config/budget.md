---
kind: budget
monthly_cap_usd: 40
daily_cap_usd: 5
per_book_cap_usd: null
warn_at: 0.8
---
# Budget

Spending caps in USD. Edit the numbers above and the engine picks them up without a restart.

- `monthly_cap_usd`, `daily_cap_usd`: day and month follow this machine's local clock.
- `per_book_cap_usd`: optional cap for one course. `null` means no cap.
- `warn_at`: a warning is shown when spend reaches this fraction of a cap.

Before each paid request the engine reserves an estimated maximum cost and refuses to start it if that would cross a cap. Requests already running finish. Local models cost nothing: their tokens and time are recorded, but they never count against a cap.

The engine rewrites everything below the marker line. Keep your own text above it.
