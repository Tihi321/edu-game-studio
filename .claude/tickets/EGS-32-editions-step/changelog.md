# EGS-32 changelog

- New pure module `src/engine/edu/editions.ts` (entries to translate, chunking, answer schema, check, apply).
- Pipeline: stage and step `editions` (after `voice`, before `build`), job handler, `editionLanguages`; skipped with a reason when there is nothing to translate.
- `CourseStore.addEditions` (validates, then writes catalogs and `pack.languages`); `writeAssembled` removes catalogs of languages the pack no longer lists.
- Role `translator` (ROLES, picker list, `config/roles.md`, seeded agent, prompt `translator/edition`, `PROMPT_VARS`).
- Docs: `docs/mcp-guide.md` (Editions), `docs/design.md`; comments in `brief.ts`, `assemble.ts`, EditionsTab text.
- ROADMAP: the old placeholder row that reused EGS-18 is replaced by the EGS-32 row (the real EGS-18 speaking row stays).
- Engine code changed beyond the ticket: only `writeAssembled` cleanup (above). `assemble.ts` still writes one language (see plan.md, decisions).

Tests: `tests/edu-editions.test.ts` (pure parts, mock-translator pipeline hr + en with target de, repair round, failing translator, skipped step, `addEditions`), lint `(in en)` test, roles test, `pipeline.test.ts` expectation. Full run: 1673 passed, 1 failed (`pipeline-run.test.ts` "a restarted engine ...", stuck in `art_generate`; it fails the same way on clean master). typecheck and lint clean.

- DONE: editions step, handler, prompt, role, docs, mock tests, ROADMAP row and duplicate fix, client provider works like other roles (role/agent/models path, no special case).
- NOT DONE: `assemble.ts` writing `languages: [source, ...editions]` (deliberate, see plan.md).
- UNTESTED: a real `client/claude-code` translation run, a real German course, the studio Editions tab, a native read of the translation. Known gap: `restart from` a stage between assemble and editions keeps editions in the pack, and `edu_asset_*` merges that add new text to a multi-edition course are refused.
