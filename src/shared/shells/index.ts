import type { CoursePack, TextCatalog } from '../course'
import type { Problem, TextRef } from '../edu/registry'
import type { TextResolver } from '../edu/text'
import { detectiveShell } from './detective'
import { encyclopediaShell } from './encyclopedia'
import { mindmazeShell } from './mindmaze'
import { roleplayShell } from './roleplay'
import { rpgShell } from './rpg'
import type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

export type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

/**
 * The course-side half of the game shells (EGS-10 to EGS-14): one `ShellDef` per shell id with the schema of its section, the text keys
 * and assets it uses, its structural checks (validator) and its shell lint (`edu_lint`). A section is `pack.shells.config[<shellId>]`,
 * so the pack schema does not change (backwards compatible: a course without a section still validates, and `config` of an unknown
 * shell id is left alone).
 *
 * Pure (no DOM, no node): the validator, the lint and the browser player all import it. A shell module may import from `../course`,
 * `../puzzles` and the single files of `../edu/` (`../edu/registry`, `../edu/text`, `../edu/match`, `../edu/prng` ...), NEVER from
 * `../edu` (its index imports the validator, which imports this file).
 */

export const SHELL_DEFS: ReadonlyMap<string, ShellDef> = new Map<string, ShellDef>(
  (
    [
      encyclopediaShell,
      mindmazeShell,
      rpgShell,
      roleplayShell,
      detectiveShell
    ] as ShellDef[]
  ).map((d) => [d.id, d])
)

/** The built-in shell that needs no section. */
export const QUIZ_ARENA = 'quiz-arena'

/** Every shell id the engine knows (the quiz arena and the registered sections). */
export const KNOWN_SHELLS: readonly string[] = [QUIZ_ARENA, ...SHELL_DEFS.keys()]

export const getShellDef = (id: string): ShellDef | undefined => SHELL_DEFS.get(id)

/** The raw section of a shell (`pack.shells.config[id]`), or undefined. */
export const rawSection = (pack: Pick<CoursePack, 'shells'>, id: string): Record<string, unknown> | undefined => pack.shells.config[id]

export type SectionParse<S> = { present: false } | { present: true; ok: true; data: S } | { present: true; ok: false; issues: { path: string; message: string }[] }

const fmtPath = (path: readonly PropertyKey[]): string => path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${String(p)}` : String(p)), '')

/** Parses a shell's section with its schema (defaults filled in). */
export function parseSection<S = unknown>(pack: Pick<CoursePack, 'shells'>, id: string): SectionParse<S> {
  const def = SHELL_DEFS.get(id)
  const raw = rawSection(pack, id)
  if (!def || raw === undefined) return { present: false }
  const r = def.schema.safeParse(raw)
  if (r.success) return { present: true, ok: true, data: r.data as S }
  return { present: true, ok: false, issues: r.error.issues.map((i) => ({ path: fmtPath(i.path), message: i.message })) }
}

/** The parsed section, or undefined when it is absent or does not parse (the shell then uses its automatic layout, if it has one). */
export function sectionOf<S = unknown>(pack: Pick<CoursePack, 'shells'>, id: string): S | undefined {
  const p = parseSection<S>(pack, id)
  return p.present && p.ok ? p.data : undefined
}

/** The shells a course can be played in: `shells.enabled` in order (unknown ids kept: the player skips what it has not registered). */
export const enabledShells = (pack: Pick<CoursePack, 'shells'>): string[] => [...new Set(pack.shells.enabled)]

const at = (id: string, path: string): string => `shells.config.${id}${path ? (path.startsWith('[') ? path : `.${path}`) : ''}`

/** The ids whose section the validator and the lint look at: every enabled or configured shell that has a def. */
const sectionIds = (pack: Pick<CoursePack, 'shells'>): string[] => [...new Set([...pack.shells.enabled, ...Object.keys(pack.shells.config)])].filter((id) => SHELL_DEFS.has(id))

/**
 * The validator's part (called by `validateCourse`): SHELL_SCHEMA for a section that does not parse, the def's own structural checks
 * (UNKNOWN_* references), UNKNOWN_ASSET for the assets it names, and the text keys it uses (returned, so the validator reports them
 * as MISSING_TEXT the same way as the pack's own keys).
 */
export function validateShellSections(pack: CoursePack): { problems: Problem[]; textRefs: TextRef[] } {
  const problems: Problem[] = []
  const textRefs: TextRef[] = []
  const assets = new Set(pack.assets.map((a) => a.id))
  for (const id of sectionIds(pack)) {
    const def = SHELL_DEFS.get(id) as ShellDef
    const p = parseSection(pack, id)
    if (!p.present) continue
    if (!p.ok) {
      for (const i of p.issues) problems.push({ code: 'SHELL_SCHEMA', path: at(id, i.path), message: i.message })
      continue
    }
    for (const r of def.textRefs(p.data, pack)) textRefs.push({ ...r, path: at(id, r.path) })
    for (const a of def.assetRefs?.(p.data) ?? []) if (!assets.has(a.id)) problems.push({ code: 'UNKNOWN_ASSET', path: at(id, a.path), message: `unknown asset "${a.id}"` })
    for (const v of def.validate?.(p.data, pack) ?? []) problems.push({ ...v, path: at(id, v.path) })
  }
  return { problems, textRefs }
}

/** The text keys of every section (for the lint's TEXT_MISSING per edition). Paths are full (`shells.config.<id>...`). */
export function shellTextRefs(pack: CoursePack): TextRef[] {
  return validateShellSections(pack).textRefs
}

/**
 * The lint's part (called by `lintGameData`): SHELL_UNKNOWN (warning) for an enabled shell nobody registered, SHELL_SECTION_MISSING
 * for an enabled shell that cannot play without its section, and every shell's own lint (reachability, completability, puzzles ...).
 */
export function lintShells(data: { pack: CoursePack; catalogs: Record<string, TextCatalog> }, resolvers: Record<string, TextResolver>): ShellLintProblem[] {
  const out: ShellLintProblem[] = []
  const { pack } = data
  const ctx: ShellLintContext = { pack, catalogs: data.catalogs, editions: pack.languages, resolvers }
  pack.shells.enabled.forEach((id, i) => {
    if (id !== QUIZ_ARENA && !SHELL_DEFS.has(id)) out.push({ code: 'SHELL_UNKNOWN', severity: 'warning', path: `shells.enabled[${i}]`, message: `no game shell "${id}" exists; the player skips it` })
  })
  for (const id of sectionIds(pack)) {
    const def = SHELL_DEFS.get(id) as ShellDef
    const p = parseSection(pack, id)
    if (p.present && !p.ok) continue // SHELL_SCHEMA from the validator
    if (!p.present && def.requiresSection && pack.shells.enabled.includes(id)) {
      out.push({ code: 'SHELL_SECTION_MISSING', path: `shells.config.${id}`, message: `the shell "${id}" is enabled but the course has no section for it` })
      continue
    }
    for (const prob of def.lint(p.present ? p.data : undefined, ctx)) out.push({ ...prob, path: at(id, prob.path) })
  }
  return out
}

/** Every lint code a shell can report (the shared ones and each def's own). */
export const SHELL_LINT_CODES: readonly string[] = ['SHELL_SCHEMA', 'SHELL_UNKNOWN', 'SHELL_SECTION_MISSING', ...[...SHELL_DEFS.values()].flatMap((d) => d.codes)]
/** The shell lint codes that are warnings. */
export const SHELL_WARNING_CODES: ReadonlySet<string> = new Set(['SHELL_UNKNOWN', ...[...SHELL_DEFS.values()].flatMap((d) => d.warnings ?? [])])
