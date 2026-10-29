import { promises as fs } from 'node:fs'
import path from 'node:path'
import { findUnitCycle, objectivesOf, type CourseItem, type CoursePack } from '../../shared/course'
import { GAME_DATA_FORMAT, type GameData } from '../../shared/game-data'
import { ITEM_KINDS, formOf, makeTextResolver, normalizeText, validateCourse, type CheckContext, type ItemKindDef, type TextRef, type TextResolver } from '../../shared/edu'
import { GAME_DATA_FILE } from './build'

/**
 * `edu_lint`: the pedagogy and integrity check over a BUILT game (`game-data.json` plus the build folder's asset files). It reuses the
 * shared helpers (`validateCourse`, `findUnitCycle`, `formOf`, the registry's `textRefs`, `distractors` and `solve`), so the lint and the
 * player judge a course the same way. Errors fail the lint (CLI exit 1); warnings are shown but exit 0.
 *
 * Codes (errors unless noted):
 *   ITEM_NO_KEY          the answer key is empty or unsolvable: it points to no option, region or group, or the item's own solution does not
 *                        check right in an edition
 *   ITEM_MULTI_KEY       a single-answer item (mcq, true-false, listening-choose) names more than one correct option
 *   ACCEPTED_INCOMPLETE  a typed answer, cloze gap, listening-typed answer or crossword/word-search word has no accepted list in an
 *                        edition that needs it, or an accepted entry is empty
 *   DISTRACTOR_DUPLICATE two options (or two bank words of a gap) have the same text after normalisation in an edition
 *   DISTRACTOR_IS_KEY    a distractor reads the same as a correct option, a bank word reads like the gap's answer, or a typed item's
 *                        `extensions.nearMisses` holds an accepted answer
 *   OBJECTIVE_ONE_FORM   an objective is asked in fewer than two distinct forms
 *   OBJECTIVE_NO_ITEMS   an objective with no items
 *   UNIT_NO_OBJECTIVES   a unit with no objectives
 *   ASSET_MISSING        an asset file is not in the build (or the asset has no URL)
 *   TEXT_MISSING         a text key that the pack or an item uses is missing or empty in an edition
 *   PREREQ_CYCLE         the prerequisite graph of units has a cycle
 *   UNIT_UNREACHABLE     a unit no learner can reach from the units that have no prerequisites
 *   PLACEHOLDER          TODO, TBD, FIXME, lorem ipsum, XXX, `[[`, a `{{` that is not a gap marker, or "placeholder" in a text
 *   PLACEHOLDER_ASSET    (warning) an asset (or the text of an item that uses it) says it is a placeholder, such as a test tone for speech
 * plus every code of `validateCourse` (SCHEMA, UNKNOWN_*, DUPLICATE_ID, MISSING_WHY ...; its MISSING_TEXT is reported as TEXT_MISSING or
 * ACCEPTED_INCOMPLETE), and GAME_DATA_INVALID when `game-data.json` is not a game.
 */

export type LintSeverity = 'error' | 'warning'

export interface LintProblem {
  code: string
  severity: LintSeverity
  path: string
  message: string
}

export interface LintResult {
  slug: string
  /** No errors (warnings do not count). */
  ok: boolean
  errors: number
  warnings: number
  problems: LintProblem[]
}

/** The lint's own codes (the validator's come on top). */
export const LINT_CODES = [
  'ITEM_NO_KEY',
  'ITEM_MULTI_KEY',
  'ACCEPTED_INCOMPLETE',
  'DISTRACTOR_DUPLICATE',
  'DISTRACTOR_IS_KEY',
  'OBJECTIVE_ONE_FORM',
  'OBJECTIVE_NO_ITEMS',
  'UNIT_NO_OBJECTIVES',
  'ASSET_MISSING',
  'TEXT_MISSING',
  'PREREQ_CYCLE',
  'UNIT_UNREACHABLE',
  'PLACEHOLDER',
  'PLACEHOLDER_ASSET',
  'GAME_DATA_INVALID'
] as const

const WARNING_CODES = new Set(['PLACEHOLDER_ASSET'])
/** Single-answer kinds: more than one correct option is a mistake. */
const SINGLE_KEY_KINDS = new Set(['mcq', 'true-false', 'listening'])
/** The word "placeholder": an error in a text, unless the text belongs to an asset that is labelled a placeholder (then the asset is a warning). */
const PLACEHOLDER_WORD = /placeholder/i
// the markers are upper-case (an ordinary word like "todo-list" or "Todos" is not one); lower-case only with a colon ("todo: ...")
const PLACEHOLDER_PATTERNS: RegExp[] = [/\b(?:TODO|TBD|FIXME)\b/, /\b(?:todo|fixme|tbd)\s*:/i, /lorem ipsum/i, /\bXXX+\b/, /\[\[/]

const norm = (s: string): string => normalizeText(s, { fold: true })
const blank = (s: string | undefined): boolean => s === undefined || s.trim() === ''

interface ChoiceOption {
  id: string
  text: string
  path: string
  correct: boolean
}

/** The options of a choice item (mcq, multi-select, listening-choose), with whether each is a right one. */
function choicesOf(item: Record<string, unknown>): ChoiceOption[] {
  const options = Array.isArray(item.options) ? (item.options as { id?: unknown; text?: unknown }[]) : []
  const answers = Array.isArray(item.answers) ? (item.answers as unknown[]) : typeof item.answer === 'string' ? [item.answer] : []
  const out: ChoiceOption[] = []
  options.forEach((o, i) => {
    if (typeof o?.id === 'string' && typeof o.text === 'string') out.push({ id: o.id, text: o.text, path: `options[${i}]`, correct: answers.includes(o.id) })
  })
  return out
}

/** The stable list the problems are collected in: one problem per code, path and message, with the editions it holds in. */
class Collector {
  private readonly map = new Map<string, { problem: LintProblem; langs: string[] }>()
  constructor(private readonly editions: readonly string[]) {}

  add(code: string, path: string, message: string, lang?: string): void {
    const key = `${code}|${path}|${message}`
    const hit = this.map.get(key)
    if (hit) {
      if (lang && !hit.langs.includes(lang)) hit.langs.push(lang)
      return
    }
    this.map.set(key, { problem: { code, severity: WARNING_CODES.has(code) ? 'warning' : 'error', path, message }, langs: lang ? [lang] : [] })
  }

  list(): LintProblem[] {
    return [...this.map.values()].map(({ problem, langs }) => (langs.length > 0 && this.editions.length > 1 ? { ...problem, message: `${problem.message} (in ${langs.join(', ')})` } : problem))
  }
}

/** Every text key of the pack itself (not of the items): the same list `validateCourse` checks. */
function packTextRefs(pack: CoursePack): TextRef[] {
  return [
    ...pack.units.flatMap((u, i) => [{ path: `units[${i}].title`, key: u.title }, ...(u.summary ? [{ path: `units[${i}].summary`, key: u.summary }] : [])]),
    ...pack.objectives.map((o, i) => ({ path: `objectives[${i}].text`, key: o.text })),
    ...pack.assets.map((a, i) => ({ path: `assets[${i}].alt`, key: a.alt })),
    ...pack.encyclopedia.articles.flatMap((a, i) => [
      { path: `encyclopedia.articles[${i}].title`, key: a.title },
      { path: `encyclopedia.articles[${i}].body`, key: a.body }
    ]),
    ...pack.factbase.flatMap((f, i) => (f.claim ? [{ path: `factbase[${i}].claim`, key: f.claim }] : []))
  ].map((r) => ({ ...r, role: 'string' as const }))
}

/**
 * Lints a built game. `assetExists(url)` says whether `<build>/<url>` is a file. Pure apart from that, so a test can lint data in memory.
 * The data is trusted to be a `GameData` (`lintGame` checks the format first).
 */
export function lintGameData(data: GameData, assetExists: (url: string) => boolean): LintProblem[] {
  const pack = data.pack
  const editions = pack.languages
  const out = new Collector(editions)
  const resolvers: Record<string, TextResolver> = Object.fromEntries(editions.map((l) => [l, makeTextResolver(data.catalogs, l, pack.targetLang)]))
  const ctxOf = (lang: string): CheckContext => ({ text: resolvers[lang]!, diacritics: pack.matching?.diacritics, typos: pack.matching?.typos })

  // everything validateCourse knows (its MISSING_TEXT is reported below as TEXT_MISSING / ACCEPTED_INCOMPLETE)
  for (const p of validateCourse(pack, data.catalogs).problems) if (p.code !== 'MISSING_TEXT') out.add(p.code, p.path, p.message)

  // ---- items: parse each by its kind, collect the text refs ----
  interface Entry {
    index: number
    item: CourseItem
    raw: Record<string, unknown>
    kind: ItemKindDef | undefined
    parsed: CourseItem | undefined
    refs: TextRef[]
  }
  const entries: Entry[] = pack.items.map((item, index) => {
    const kind = ITEM_KINDS.get(item.kind)
    const parsedResult = kind?.schema.safeParse(item)
    const parsed = parsedResult?.success ? parsedResult.data : undefined
    return { index, item, raw: item as Record<string, unknown>, kind, parsed, refs: kind && parsed ? kind.textRefs(parsed) : [] }
  })

  // ---- text keys: missing, empty, accepted lists ----
  const checkRef = (r: TextRef, at: string): void => {
    for (const lang of editions) {
      const res = resolvers[lang]!
      if (r.role === 'accepted') {
        const list = res.hasAccepted(r.key) ? res.accepted(r.key) : []
        if (list.length === 0) out.add('ACCEPTED_INCOMPLETE', at, `no accepted answers for key "${r.key}"`, lang)
        else if (list.some(blank)) out.add('ACCEPTED_INCOMPLETE', at, `an accepted answer of key "${r.key}" is empty`, lang)
      } else if (!res.hasText(r.key)) out.add('TEXT_MISSING', at, `no string for key "${r.key}"`, lang)
      else if (blank(res.text(r.key))) out.add('TEXT_MISSING', at, `the string for key "${r.key}" is empty`, lang)
    }
  }
  for (const r of packTextRefs(pack)) checkRef(r, r.path)
  for (const e of entries) for (const r of e.refs) checkRef(r, `items[${e.index}].${r.path}`)

  /** Whether every text the item uses is there in an edition (the solve check is moot otherwise). */
  const textComplete = (e: Entry, lang: string): boolean => {
    const res = resolvers[lang]!
    return e.refs.every((r) => (r.role === 'accepted' ? res.hasAccepted(r.key) && res.accepted(r.key).every((a) => !blank(a)) : !blank(res.text(r.key))))
  }

  // ---- per item ----
  for (const e of entries) {
    const at = `items[${e.index}]`
    const { kind, parsed, raw } = e
    if (!kind) continue // UNKNOWN_KIND from the validator

    // more than one right option on a single-answer item (read from the stored item: its kind's schema may refuse it)
    if (SINGLE_KEY_KINDS.has(e.item.kind) && !(e.item.kind === 'listening' && raw.mode === 'type')) {
      const many = Array.isArray(raw.answer) ? raw.answer.length : Array.isArray(raw.answers) ? raw.answers.length : 0
      if (many > 1) out.add('ITEM_MULTI_KEY', at, `a ${formOf(e.item).toLowerCase()} item names ${many} right answers; it must have exactly one (use multi-select for more)`)
    }
    if (!parsed) continue // SCHEMA from the validator

    // the key points to something
    const p = parsed as unknown as Record<string, unknown>
    const choices = choicesOf(p)
    let noKey: string | undefined
    if (e.item.kind === 'mcq' || (e.item.kind === 'listening' && p.mode === 'choose')) {
      if (!choices.some((c) => c.correct)) noKey = `the answer "${String(p.answer)}" is none of the options`
    } else if (e.item.kind === 'multi-select') {
      if (!Array.isArray(p.answers) || p.answers.length === 0 || !choices.some((c) => c.correct)) noKey = 'no right option is marked'
    } else if (e.item.kind === 'hotspot') {
      if (!Array.isArray(p.regions) || !(p.regions as { id: string }[]).some((r) => r.id === p.answer)) noKey = `the answer "${String(p.answer)}" is none of the regions`
    }
    if (noKey) out.add('ITEM_NO_KEY', at, noKey)

    // the item's own solution must check right in every edition whose text is complete
    if (!noKey) {
      for (const lang of editions) {
        if (!textComplete(e, lang)) continue
        const ctx = ctxOf(lang)
        const right = ((): boolean => {
          try {
            return kind.check(parsed, kind.solve(parsed, ctx), ctx).correct
          } catch {
            return false
          }
        })()
        if (!right) out.add('ITEM_NO_KEY', at, 'the answer key cannot be solved: the item\'s own solution does not check right', lang)
      }
    }

    // options that read alike
    for (const lang of editions) {
      const res = resolvers[lang]!
      const seen = new Map<string, ChoiceOption>()
      for (const c of choices) {
        const t = res.text(c.text)
        if (blank(t)) continue
        const n = norm(t!)
        const first = seen.get(n)
        if (!first) {
          seen.set(n, c)
          continue
        }
        if (first.correct !== c.correct) {
          const [right, wrong] = first.correct ? [first, c] : [c, first]
          out.add('DISTRACTOR_IS_KEY', `${at}.${wrong.path}`, `the distractor "${wrong.id}" reads the same as the right option "${right.id}" ("${t}")`, lang)
        } else {
          out.add('DISTRACTOR_DUPLICATE', `${at}.${c.path}`, `the options "${first.id}" and "${c.id}" read the same ("${t}")`, lang)
        }
      }
      // cloze word banks
      if (e.item.kind === 'cloze' && Array.isArray(p.gaps)) {
        ;(p.gaps as { id: string; answer: string; bank?: string[] }[]).forEach((g, gi) => {
          if (!g.bank) return
          const accepted = res.accepted(g.answer).map(norm)
          const texts = new Map<string, string>()
          g.bank.forEach((b, bi) => {
            const t = res.text(b)
            if (blank(t)) return
            const n = norm(t!)
            const where = `${at}.gaps[${gi}].bank[${bi}]`
            if (b !== g.answer && accepted.includes(n)) out.add('DISTRACTOR_IS_KEY', where, `the bank word "${t}" is an accepted answer of gap "${g.id}"`, lang)
            else if (texts.has(n) && b !== g.answer) out.add('DISTRACTOR_DUPLICATE', where, `the bank word "${t}" appears twice in the word bank of gap "${g.id}"`, lang)
            texts.set(n, b)
          })
        })
      }
      // typed answers: a near-miss list must not hold a right answer
      const misses = (p.extensions as { nearMisses?: unknown } | undefined)?.nearMisses
      if (Array.isArray(misses) && typeof p.answer === 'string' && (e.item.kind === 'typed' || e.item.kind === 'listening')) {
        const accepted = res.accepted(p.answer).map(norm)
        misses.forEach((m, mi) => {
          if (typeof m === 'string' && accepted.includes(norm(m))) out.add('DISTRACTOR_IS_KEY', `${at}.extensions.nearMisses[${mi}]`, `the near-miss "${m}" is an accepted answer`, lang)
        })
      }
    }
  }

  // ---- objectives and units ----
  const itemsByObjective = new Map<string, CourseItem[]>()
  for (const item of pack.items) itemsByObjective.set(item.objective, [...(itemsByObjective.get(item.objective) ?? []), item])
  pack.objectives.forEach((o, i) => {
    const items = itemsByObjective.get(o.id) ?? []
    if (items.length === 0) {
      out.add('OBJECTIVE_NO_ITEMS', `objectives[${i}]`, `the objective "${o.id}" has no items`)
      return
    }
    const forms = new Set(items.map((it) => formOf(it)))
    if (forms.size < 2) out.add('OBJECTIVE_ONE_FORM', `objectives[${i}]`, `the objective "${o.id}" is asked in one form only (${[...forms][0]}); add an item in a second form`)
  })
  pack.units.forEach((u, i) => {
    if (objectivesOf(pack, u.id).length === 0) out.add('UNIT_NO_OBJECTIVES', `units[${i}]`, `the unit "${u.id}" has no objectives`)
  })
  const cycle = findUnitCycle(pack.units)
  if (cycle) out.add('PREREQ_CYCLE', 'units', `the prerequisites form a cycle: ${cycle.join(' -> ')}`)
  const unitIds = new Set(pack.units.map((u) => u.id))
  const reached = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const u of pack.units) {
      if (!reached.has(u.id) && u.requires.every((r) => unitIds.has(r) && reached.has(r))) {
        reached.add(u.id)
        grew = true
      }
    }
  }
  pack.units.forEach((u, i) => {
    if (!reached.has(u.id)) out.add('UNIT_UNREACHABLE', `units[${i}]`, `no learner can reach the unit "${u.id}": it needs ${u.requires.filter((r) => !reached.has(r)).join(', ') || 'itself'}, which can never be mastered`)
  })

  // ---- assets ----
  pack.assets.forEach((a, i) => {
    const url = data.assets?.[a.id]
    if (!url) out.add('ASSET_MISSING', `assets[${i}]`, `the asset "${a.id}" has no URL in the build`)
    else if (!assetExists(url)) out.add('ASSET_MISSING', `assets[${i}]`, `the asset file "${url}" is not in the build (course file "${a.file}")`)
  })

  // ---- placeholders ----
  const placeholderAssets = new Set<string>()
  pack.assets.forEach((a, i) => {
    const said = PLACEHOLDER_WORD.test(a.file) || editions.some((l) => PLACEHOLDER_WORD.test(resolvers[l]!.text(a.alt) ?? ''))
    if (!said) return
    placeholderAssets.add(a.id)
    out.add('PLACEHOLDER_ASSET', `assets[${i}]`, `the asset "${a.id}" is labelled as a placeholder (${a.file}): replace it before the game is published`)
  })
  // the text of a placeholder asset and of the items that use one may say so
  const mayMentionPlaceholder = new Set<string>(pack.assets.filter((a) => placeholderAssets.has(a.id)).map((a) => a.alt))
  for (const e of entries) {
    const used = [e.item.asset, (e.raw as { backAsset?: string }).backAsset].filter((x): x is string => typeof x === 'string')
    if (used.some((id) => placeholderAssets.has(id))) for (const r of e.refs) mayMentionPlaceholder.add(r.key)
  }
  const gapMarkers = new Map<string, Set<string>>()
  for (const e of entries) {
    if (e.item.kind === 'cloze' && e.parsed) {
      const p = e.parsed as unknown as { text: string; gaps: { id: string }[] }
      gapMarkers.set(p.text, new Set([...(gapMarkers.get(p.text) ?? []), ...p.gaps.map((g) => g.id)]))
    }
  }
  const scan = (value: string, key: string | undefined, where: string, lang?: string): void => {
    const allowed = key ? gapMarkers.get(key) : undefined
    const stripped = value.replace(/\{\{([^{}]*)\}\}/g, (m, id: string) => (allowed?.has(id) ? '' : m))
    let found: string | undefined = PLACEHOLDER_PATTERNS.map((re) => re.exec(stripped)?.[0]).find((m) => m !== undefined)
    if (found === undefined && stripped.includes('{{')) found = '{{'
    if (found === undefined && PLACEHOLDER_WORD.test(stripped) && !(key && mayMentionPlaceholder.has(key))) found = 'placeholder'
    if (found !== undefined) out.add('PLACEHOLDER', where, `the text looks unfinished (${found}): "${value.length > 60 ? `${value.slice(0, 57)}...` : value}"`, lang)
  }
  for (const lang of Object.keys(data.catalogs).sort()) {
    const cat = data.catalogs[lang]!
    for (const [key, value] of Object.entries(cat.strings)) scan(value, key, `text[${lang}].strings[${key}]`, lang)
    for (const [key, list] of Object.entries(cat.accepted ?? {})) list.forEach((v, i) => scan(v, undefined, `text[${lang}].accepted[${key}][${i}]`, lang))
  }
  scan(pack.subject, undefined, 'subject')
  scan(pack.audience, undefined, 'audience')
  pack.factbase.forEach((f, i) => scan(f.source, undefined, `factbase[${i}].source`))

  const order = (p: LintProblem): number => (p.severity === 'error' ? 0 : 1)
  return out.list().sort((a, b) => order(a) - order(b))
}

export function summarize(slug: string, problems: LintProblem[]): LintResult {
  const errors = problems.filter((p) => p.severity === 'error').length
  return { slug, ok: errors === 0, errors, warnings: problems.length - errors, problems }
}

/** Lints a build folder: `game-data.json` and the asset files next to it. */
export async function lintGame(gameDir: string): Promise<LintResult> {
  const file = path.join(gameDir, GAME_DATA_FILE)
  let data: GameData
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<GameData>
    if (parsed.format !== GAME_DATA_FORMAT || !parsed.pack || !parsed.catalogs) throw new Error('it is not an Edu Studio game (format, pack or catalogs missing)')
    data = parsed as GameData
  } catch (e) {
    return summarize(path.basename(path.dirname(gameDir)), [{ code: 'GAME_DATA_INVALID', severity: 'error', path: GAME_DATA_FILE, message: `${GAME_DATA_FILE} cannot be read: ${(e as Error).message}` }])
  }
  const urls = Object.values(data.assets ?? {})
  const present = new Set<string>()
  for (const url of urls) {
    const abs = path.join(gameDir, ...url.split('/'))
    if (path.relative(gameDir, abs).startsWith('..')) continue
    if (await fs.stat(abs).then((s) => s.isFile(), () => false)) present.add(url)
  }
  return summarize(data.slug, lintGameData(data, (url) => present.has(url)))
}
