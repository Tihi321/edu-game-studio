# EGS-60 Strata model discovery (Edu Studio)

Branch `EGS-60_strata-model-discovery` (from `master`). Replay of VNO-60 (VN Studio, branch `VNO-60_strata-model-discovery`, commit 9d0d173), hub task HUB-26, task T2.

The plan is `../creative-hub/.claude/tickets/HUB-26-strata-model-discovery/plan.md`: contract C1 and task T2. The reference is `../visual-novels-orchestrator/.claude/tickets/VNO-60-strata-model-discovery/` (plan.md, changelog.md).

## Checklist

- [x] C1.1 schema fields `loaded`, `aliases`, model `json_schema`, provider `profiles` (`src/shared/schemas.ts`)
- [x] C1.2 rules 1-11 in `registry.ts`, `router.ts`, `openaiCompat.ts`, `summary.ts`, `engine.ts`, `ModelsPage.tsx`
- [x] C1.3 neutral refs in the code defaults (`schemas.ts` BUILTIN_FALLBACKS, BUILTIN_GROUP_DEFAULTS) and seed `roles.md`, `settings.md`
- [x] C1.4 migration: `strata-loaded-v1` (providers.md), `strata-loaded-roles-v1`, `strata-loaded-settings-v1`
- [x] Seed docs in `seed/config/providers.md`; the roles.md rationale says that Strata on DeepSeek is no longer a different family from the paid writers
- [x] Tests: the down/up test extended (AC-1), one migration case (AC-3), existing expectations adjusted
- [x] `ROADMAP.md` row
- [x] typecheck, lint, test green; AC-5 grep over `seed/config` has no hit
