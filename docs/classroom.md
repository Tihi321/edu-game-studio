# Classroom mode (EGS-20)

A file-based loop for a teacher and a class. No server, no accounts, no cloud: the game is the same built folder every learner opens (`index.html`, works over `file://`), and the only things that travel are small JSON files that people hand over themselves (a shared folder, e-mail, a USB stick).

## For the teacher, step by step

1. **Give the course an assignment.** Ask your agent: `edu_class_assign {slug, assignment: {title, units, targetStars, due, message}, build: true}`.
   - `units`: unit ids (empty or missing = every unit); `targetStars`: 1 to 3 (default 2); `due`: an ISO date such as `2026-12-01`; `message`: plain text, at most 400 characters, shown as typed (no markup, no catalog key).
   - It is stored in `pack.extensions.classroom.assignment` of `courses/<slug>/course/pack.json`. The game must be built again to show it (`build: true` does that, or run `edu_build`). `clear: true` removes the assignment.
2. **Hand out the game**: copy `courses/<slug>/build/` to the learners (a shared drive, a web page you already have, a USB stick).
3. **Learners play.** The title screen of every game style shows the assignment (title, "Reach N stars in: ...", the due date, your message), a "Your name" field and a "Send to my teacher" button. In the quiz arena the assigned units are tagged on the map. The button saves `<course>-<name>-result.json`; the learner gives you that file.
4. **Collect the files** in `courses/<slug>/class/results/` (or any folder).
5. **Make the report**: `edu_class_report {slug}` (optional `folder`, `files`, `format: markdown | csv | json`). It writes `courses/<slug>/class/report.md` and `report.csv` next to the course.

## What the report holds

- Per student: units mastered (2 stars or more), stars, accuracy (answers right the first time), minutes of play (a proxy for time on task: seconds with a key, click or touch in the last 20 seconds, page visible), the size of the review queue, and whether every assigned unit reached the target.
- Per unit: how many students mastered it or reached the target, and the average stars.
- Per item: how many students missed it, and how many misses in all (the prompt is shown in the course's source language).
- The weakest objectives (the share of answers missed), and who has not finished.
- Notes: a student who sent two files counts once (matched by name, ignoring case; the newer file wins) and the report says so. A file for another course or another assignment, a file that is not a result, or one larger than 200 KB is left out and listed with the reason; a bad file never stops the report. At most 500 files are read, and only files inside the folder (a link that leaves it is skipped).

The CSV is safe to open in a spreadsheet: a cell that begins with `=`, `+`, `-` or `@` gets a leading quote.

## Privacy

- Names stay in the files. The learner's name is kept in the browser's `localStorage` on that device and goes into the result file only when the learner presses "Send to my teacher". Nothing is uploaded; there is no network call.
- The result file is a summary only: stars and best accuracy per unit, counts of answers, the review queue, the items missed, the seconds of play, and a random device id. It does not hold the whole progress, the score, the spaced-repetition cards or any other localStorage content.
- Keep the results folder and the report out of any public repository: they hold your learners' names.
- Reading is defensive: unknown keys are dropped, numbers are clamped, ids that are not plain ids are dropped.

## Not in this version

- A live room (EGS-21), accounts, a roster of who should have sent a file (the report only knows who did), and a Class tab in the studio window: use the two MCP tools.
- The assigned-unit tag is on the quiz arena map; the other game styles show the assignment on the title only.
