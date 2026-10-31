# EGS-20 Teacher / classroom mode

Scope: file-based, no server, no accounts. A teacher gives a course an ASSIGNMENT (units, target stars, due date, message); students play the same built game (name field, banner, "Send to my teacher" result file); the teacher imports many result files and gets a CLASS REPORT. Not live multiplayer (EGS-21).

Steps
1. `src/shared/classroom.ts` (pure, zod): assignmentSchema, studentResultSchema, parseStudentResult (defensive, 200 KB), buildStudentResult(Progress), classReport, reportToMarkdown, reportToCsv (CSV-injection safe). Assignment lives in `pack.extensions.classroom.assignment` (free record; strict pack schema untouched).
2. Progress: `settings.name`, `settings.studentId` and top-level `playSeconds` normalised in parseProgress (old saves ok).
3. Player: `src/player/classroom.ts` (banner, name input, send button, play-time tracker) used by the quiz arena title and the kit title screen; i18n en + hr.
4. MCP: `src/engine/mcp/tools-class.ts` (`edu_class_assign`, `edu_class_report`), registered from tools.ts.
5. Studio UI Class tab: skipped (tabs live in store + API/IPC; MCP tools are the must-have).
6. Tests: tests/classroom.test.ts, tests/classroom-mcp.test.ts, progress cases, tests/classroom.e2e.test.ts.
7. Docs: docs/classroom.md, pointer in docs/player.md. Changelog at the end.
