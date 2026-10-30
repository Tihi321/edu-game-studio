import type { z } from 'zod'
import type { CoursePack, TextCatalog } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import type { TextResolver } from '../edu/text'

/** One problem of a shell's lint. `path` is relative to the section (`rooms[2].doors[0]`); the registry prefixes `shells.config.<id>`. */
export interface ShellLintProblem {
  code: string
  /** Default: error. */
  severity?: 'error' | 'warning'
  path: string
  message: string
  /** The edition the problem holds in, when it is about text. */
  lang?: string
}

export interface ShellLintContext {
  pack: CoursePack
  catalogs: Record<string, TextCatalog>
  /** The editions (`pack.languages`). */
  editions: readonly string[]
  /** A text resolver per edition (the edition first, then the target-language catalog). */
  resolvers: Record<string, TextResolver>
}

/**
 * The course-side definition of a game shell (`src/shared/shells/<id>.ts`). Registered in `src/shared/shells/index.ts`.
 *
 *  - `schema` parses `pack.shells.config[id]` (zod, defaults filled in). Every visible string in it is a catalog key, never text.
 *  - `textRefs` lists the catalog keys the section uses (role `string`, or `accepted` for a typed answer): the validator reports a
 *    missing one as MISSING_TEXT, the lint as TEXT_MISSING / ACCEPTED_INCOMPLETE per edition; the lint also scans them for placeholders.
 *  - `validate` reports broken references (UNKNOWN_ITEM, UNKNOWN_UNIT, UNKNOWN_ARTICLE, UNKNOWN_ROOM ...), which block the build.
 *  - `lint` is the pedagogy and playability check: every room reachable, every door's question exists, the quest graph can be finished,
 *    no dead end, every dialogue ends, every puzzle proved unique ... Codes are upper-case and prefixed by the shell
 *    (`MAZE_ROOM_UNREACHABLE`, `ENC_HUNT_TARGET_MISSING` ...) and listed in `codes` (warnings also in `warnings`).
 */
export interface ShellDef<S = unknown> {
  id: string
  /** The theme id of `src/design/themes` the shell uses by default. */
  theme: string
  /** true: the shell cannot play a course without its section (an enabled shell without one is SHELL_SECTION_MISSING). */
  requiresSection: boolean
  schema: z.ZodType<S>
  textRefs(section: S, pack: CoursePack): TextRef[]
  /** Asset ids the section names, checked against `pack.assets` (UNKNOWN_ASSET). */
  assetRefs?(section: S): { path: string; id: string }[]
  /** Structural checks of references (paths relative to the section). */
  validate?(section: S, pack: CoursePack): Problem[]
  /** The shell lint; `section` is undefined when the course has none (the shell's automatic layout is then linted, if it has one). */
  lint(section: S | undefined, ctx: ShellLintContext): ShellLintProblem[]
  /** Every lint code `lint` can report. */
  codes: readonly string[]
  /** The codes among `codes` that are warnings. */
  warnings?: readonly string[]
}
