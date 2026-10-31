# EGS-20 changelog

Changed (repo-relative)
- src/shared/classroom.ts (new): assignment and student-result schemas, defensive parser, buildStudentResult, classReport, Markdown and CSV.
- src/player/classroom.ts (new): banner, name field, Send to my teacher, PlayTimer.
- src/player/progress.ts: settings.name, settings.studentId, playSeconds (normalised, old saves fine).
- src/player/kit/screens.ts, kit/session.ts, shells/quiz-arena.ts, i18n.ts (en, hr), style/base.css: banner on every title, assigned tag on the quiz arena map, play timer.
- src/engine/mcp/tools-class.ts (new), tools.ts (registered): edu_class_assign, edu_class_report.
- tests/player-classroom.test.ts, tests/classroom-mcp.test.ts, tests/classroom.e2e.test.ts (new).
- docs/classroom.md (new), docs/player.md, docs/mcp-guide.md.

Verification (all green)
- tsc --noEmit for tsconfig.node, web and player; eslint .; vite builds (player, engine); electron-vite build.
- vitest: player-classroom, classroom-mcp, classroom.e2e (3 tests, real Chromium), player-progress, player-feedback, player-shell-kit, edu-mcp, bot.e2e, bot-encyclopedia.e2e: 108 passed.

Not done / not run
- Studio UI Class tab: skipped (course tabs go through the store and API/IPC; the MCP tools are the must-have).
- Assigned-unit tag only on the quiz arena map; other shells show the assignment on the title.
- The e2e does not answer a question in the browser: it seeds a saved progress and checks the result file built from it; the play-time counter is checked live.
- Whole vitest suite not run (the parent does). Symlink-escape test is skipped inside the test when the OS refuses to create a link.
