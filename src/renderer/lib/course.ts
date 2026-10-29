import type { CourseItem, CoursePack, TextCatalog } from '../../shared/course'
import { formOf, ITEM_KINDS, makeTextResolver, type TextResolver } from '../../shared/edu'
import { languageInfo } from '../../shared/languages'
import type { CourseLoadedView } from '../../shared/protocol'
import { themeForShell, type ThemeInfo } from '../../design/themes'
import type { CourseDoc } from '../store/course'

/** Small pure helpers the Library and the Course page share (no React, so they are unit-tested). */

export const langName = (code: string): string => languageInfo(code)?.name ?? code

/** The edition the studio reads texts in: the source language when it has a catalog, else the first edition, else any catalog. */
export function studioLang(data: Pick<CourseLoadedView, 'pack' | 'text'>): string {
  const { pack, text } = data
  if (text[pack.sourceLang]) return pack.sourceLang
  return pack.languages.find((l) => text[l]) ?? Object.keys(text)[0] ?? pack.sourceLang
}

export function resolverFor(data: Pick<CourseLoadedView, 'pack' | 'text'>, lang: string = studioLang(data)): TextResolver {
  return makeTextResolver(data.text, lang, data.pack.targetLang)
}

/** The course title: the string `course.title` of the studio edition, else the subject. */
export function courseTitle(data: Pick<CourseLoadedView, 'pack' | 'text'>): string {
  return resolverFor(data).text('course.title') || data.pack.subject
}

/** The shell the course plays in first (`shells.enabled[0]`). */
export const mainShell = (pack: Pick<CoursePack, 'shells'>): string => pack.shells.enabled[0] ?? 'quiz-arena'

/** The look of the course: the theme its main shell names in `shells.config[shell].theme`, else the shell's own. */
export function courseTheme(pack: Pick<CoursePack, 'shells'>): ThemeInfo {
  const shell = mainShell(pack)
  const configured = pack.shells.config[shell]?.theme
  return themeForShell(shell, typeof configured === 'string' ? configured : undefined)
}

/** The unit an item belongs to, through its objective. */
export function unitOf(pack: Pick<CoursePack, 'objectives'>, item: Pick<CourseItem, 'objective'>): string | undefined {
  return pack.objectives.find((o) => o.id === item.objective)?.unit
}

// ---- pipeline stages ----

export type StageState = 'done' | 'partial' | 'todo'

export interface Stage {
  id: 'curriculum' | 'articles' | 'items' | 'build' | 'check' | 'playtest'
  label: string
  state: StageState
  /** What the state is made of, for a tooltip and for screen readers. */
  detail: string
}

/**
 * The pipeline of a course as far as the files say: curriculum, articles, items (every objective asked in two or more forms), build,
 * check (the lint of this session) and playtest (runs the bot made, from the pipeline slot). The brief and the research come with the
 * pipeline tickets (EGS-06 to EGS-08) and are not stages yet.
 */
export function pipelineStages(data: CourseLoadedView | undefined, doc: Pick<CourseDoc, 'lint'> | undefined, playtestRuns = 0): Stage[] {
  if (!data) {
    return (['curriculum', 'articles', 'items', 'build', 'check', 'playtest'] as const).map((id) => ({ id, label: STAGE_LABELS[id], state: 'todo' as const, detail: 'not read yet' }))
  }
  const { pack, build } = data
  const units = pack.units.length
  const withObjectives = pack.units.filter((u) => pack.objectives.some((o) => o.unit === u.id)).length
  const scaffold = units === 1 && pack.items.length === 0
  const curriculum: Stage = {
    id: 'curriculum',
    label: STAGE_LABELS.curriculum,
    state: withObjectives === units && !scaffold ? 'done' : 'partial',
    detail: `${units} ${units === 1 ? 'unit' : 'units'}, ${pack.objectives.length} ${pack.objectives.length === 1 ? 'objective' : 'objectives'}${withObjectives < units ? `, ${units - withObjectives} without an objective` : ''}`
  }
  const articles = pack.encyclopedia.articles.length
  const articleStage: Stage = {
    id: 'articles',
    label: STAGE_LABELS.articles,
    state: articles === 0 ? 'todo' : articles >= units ? 'done' : 'partial',
    detail: `${articles} ${articles === 1 ? 'article' : 'articles'}`
  }
  const forms = (objectiveId: string): number => new Set(pack.items.filter((i) => i.objective === objectiveId).map((i) => formOf(i))).size
  const covered = pack.objectives.filter((o) => forms(o.id) >= 2).length
  const itemStage: Stage = {
    id: 'items',
    label: STAGE_LABELS.items,
    state: pack.items.length === 0 ? 'todo' : covered === pack.objectives.length ? 'done' : 'partial',
    detail: `${pack.items.length} items, ${covered} of ${pack.objectives.length} objectives asked in two forms or more`
  }
  const buildStage: Stage = {
    id: 'build',
    label: STAGE_LABELS.build,
    state: !build.built ? 'todo' : build.stale ? 'partial' : 'done',
    detail: !build.built ? 'not built' : build.stale ? 'built, but the course changed since' : 'built and up to date'
  }
  const lint = doc?.lint
  const check: Stage = {
    id: 'check',
    label: STAGE_LABELS.check,
    state: !lint ? 'todo' : lint.ok ? (lint.warnings > 0 ? 'partial' : 'done') : 'partial',
    detail: !lint ? 'not run in this session' : lint.ok ? `no errors, ${lint.warnings} ${lint.warnings === 1 ? 'warning' : 'warnings'}` : `${lint.errors} ${lint.errors === 1 ? 'error' : 'errors'}`
  }
  const playtest: Stage = { id: 'playtest', label: STAGE_LABELS.playtest, state: playtestRuns > 0 ? 'done' : 'todo', detail: playtestRuns > 0 ? `${playtestRuns} bot runs` : 'no bot run recorded yet' }
  return [curriculum, articleStage, itemStage, buildStage, check, playtest]
}

const STAGE_LABELS = { curriculum: 'Curriculum', articles: 'Articles', items: 'Items', build: 'Build', check: 'Check', playtest: 'Playtest' } as const

// ---- text coverage per edition ----

export interface Coverage {
  lang: string
  /** The language is an edition, or only the target language of a language course. */
  role: 'edition' | 'target'
  /** The catalog file exists. */
  hasCatalog: boolean
  needed: number
  present: number
  /** Keys the course uses that this edition cannot resolve, in the order they are met (at most `limit`). */
  missing: { key: string; where: string }[]
  missingCount: number
}

/** Every text key the course uses, with where it is used. Accepted lists count as present when the string exists (the matcher falls back to it). */
export function usedTextKeys(pack: CoursePack): { key: string; where: string; accepted: boolean }[] {
  const seen = new Map<string, { key: string; where: string; accepted: boolean }>()
  const add = (key: string | undefined, where: string, accepted = false): void => {
    if (!key) return
    const had = seen.get(key)
    if (had) had.accepted ||= accepted
    else seen.set(key, { key, where, accepted })
  }
  for (const u of pack.units) {
    add(u.title, `unit ${u.id} title`)
    add(u.summary, `unit ${u.id} summary`)
  }
  for (const o of pack.objectives) add(o.text, `objective ${o.id}`)
  for (const a of pack.encyclopedia.articles) {
    add(a.title, `article ${a.id} title`)
    add(a.body, `article ${a.id} body`)
  }
  for (const a of pack.assets) add(a.alt, `asset ${a.id} alt text`)
  for (const f of pack.factbase) add(f.claim, `fact ${f.id}`)
  for (const item of pack.items) {
    const def = ITEM_KINDS.get(item.kind)
    if (!def) continue
    for (const r of def.textRefs(item)) add(r.key, `item ${item.id} ${r.path}`, r.role === 'accepted')
  }
  return [...seen.values()]
}

export function textCoverage(pack: CoursePack, catalogs: Readonly<Record<string, TextCatalog>>, limit = 30): Coverage[] {
  const used = usedTextKeys(pack)
  const langs: { lang: string; role: Coverage['role'] }[] = pack.languages.map((lang) => ({ lang, role: 'edition' as const }))
  if (pack.targetLang && !pack.languages.includes(pack.targetLang)) langs.push({ lang: pack.targetLang, role: 'target' })
  return langs.map(({ lang, role }) => {
    const cat = catalogs[lang]
    const has = (key: string): boolean => cat?.strings[key] !== undefined || !!cat?.accepted?.[key]
    // an edition needs every key the course uses (the target language's phrases are found through it); the target language itself
    // only needs the phrases it teaches: the answers and the keys its catalog already holds
    const relevant = role === 'target' ? used.filter((u) => u.accepted || has(u.key)) : used
    const text = makeTextResolver(catalogs, lang, pack.targetLang)
    const missing = relevant.filter((u) => (role === 'target' ? !has(u.key) : u.accepted ? !(text.hasAccepted(u.key) || text.hasText(u.key)) : !text.hasText(u.key)))
    return { lang, role, hasCatalog: !!cat, needed: relevant.length, present: relevant.length - missing.length, missing: missing.slice(0, limit).map((m) => ({ key: m.key, where: m.where })), missingCount: missing.length }
  })
}
