# EGS-25 Shared start screen (title + mode picker)

Ticket of HUB-22 (creative hub plan `.claude/tickets/HUB-22-edu-start-screen-german/plan.md`). Branch `EGS-25_start-screen`. The task block, copied from the plan:



## Acceptance (rows A1-A6 and Z of the HUB-22 plan) and how they are checked here

| Row | Check |
|---|---|
| A1 | `tests/player-shell-picker.e2e.test.ts` "has one skeleton ...": the title DOM skeleton equal across the shells of `solar-system` (5 shells) and `hr-a1-greetings` (arena + roleplay); `data-edu-theme` is `menu` on the title and not `menu` after Start |
| A2 | `tests/player-shell-kit.test.ts`: `class: 'title-screen` is made in `src/player/kit/start.ts` only |
| A3 | e2e "keeps the menu theme and the progress ...": a MutationObserver sees no theme other than `menu` while a mode is picked; the stored progress (language, timer) is equal before and after |
| A4 | `tests/design-tokens.test.ts` and `tests/themes-load.test.ts` (the registry now holds `menu`); the bot `--axe` / `--keyboard` runs in the existing bot e2e tests |
| A5 | screenshots at 1280x800 and 390x844 of every shell's title (`.claude/temp/screens/EGS-25/`, not committed), looked at by eye; automated no-horizontal-scroll check at 390 px in the e2e test |
| A6 | `tests/bot*.e2e.test.ts` |
| Z | typecheck, lint, test, build |
