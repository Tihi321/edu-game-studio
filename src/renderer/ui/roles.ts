import type { ModelSummary } from '../../shared/protocol'

/** The agent roles, as in `seed/config/roles.md` and `ROLES` of `src/shared/schemas.ts` (a test keeps the two lists equal). */
export const KNOWN_ROLES = ['director', 'curriculum-designer', 'researcher', 'subject-expert', 'item-writer', 'misconception-designer', 'explainer', 'language-coach', 'fact-checker', 'game-designer', 'narrative-designer', 'art-director', 'art-critic', 'composer', 'voice-director', 'playtester', 'accessibility-reviewer', 'child-safety-reviewer', 'publisher'] as const

/** Roles that need a model with image input. */
export const VISION_ROLES: ReadonlySet<string> = new Set(['art-critic'])

/** The refs the pickers offer: every enabled model shown on the Models page, plus the one in use. A vision-only role is offered vision models. */
export function modelOptions(known: ModelSummary[], current: string | null | undefined, visionOnly = false): string[] {
  const set = new Set<string>(known.filter((m) => m.enabled && m.shown !== false && (!visionOnly || m.vision)).map((m) => m.ref))
  if (current) set.add(current)
  return [...set]
}

export const PROBLEM_TITLES: Record<string, string> = {
  'day-limit': 'Daily limit used up',
  'rate-limit': 'Rate limited',
  down: 'Server not running',
  'too-big': 'Request too big',
  'no-access': 'No access (key missing or wrong)',
  'no-credit': 'No credit',
  'not-found': 'No such model',
  'bad-request': 'Bad request',
  server: 'Server error',
  budget: 'Over the budget cap',
  other: 'Request failed'
}
