# EGS-38 listening passages (optional)

Copied from the HUB-22 plan (creative hub `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`), section EGS-38.

### EGS-38 Listening passages (optional; build last)
- **Inputs:** EGS-33 (German routing), EGS-35 (reader), `src/engine/edu/voice.ts` (narration cut at `narrationMaxChars` 600).
- **Do:** voice option `media.voice.passages` (default **false**): one clip **per paragraph** of each reading (longer paragraphs split at a sentence), German, **local chain only (never Gemini)**, asset ids `art-<articleId>-p<n>`; the reader shows a play button per paragraph (`reader-play-<n>`) and "play all"; a missing clip is a silent placeholder with the usual lint warning. `edu_voice_plan` shows clips and characters before anything is generated. Deterministic plan, no new role.
- **Outputs:** code, tests with fakes (plan counts, local routing, placeholders, hash index skips unchanged paragraphs), docs, ROADMAP row.
- **Contract:** `media.voice.passages`, the asset id scheme, the testids above.


User decision: German is voiced by local VibeTTS Supertonic voice `supertonic:M2`, never Gemini; `media.voice.passages` defaults to false.

Acceptance R6: `tests/voice-plan.test.ts` (EGS-38 cases). Z: typecheck, lint, test, build green.
