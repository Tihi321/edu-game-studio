# EGS-52 changelog
- src/engine/edu/playtest.ts: DEFAULT_TIMEOUT_MS 900000; timeout reported clearly.
- tests/edu-playtest.test.ts: timeout test.
- DONE: root cause (timeout, not a hang), fix, test, tsc x3, eslint, edu-playtest tests (9 pass).
- UNTESTED: a full pipeline playtest on deutsch-a1-pilot with the new timeout; bot speed (~0.9 s per answer) not improved.
- NOT DONE: making the bot faster.
