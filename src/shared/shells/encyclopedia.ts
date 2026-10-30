import { z } from 'zod'
import { idSchema, keySchema, unitOrder, type CoursePack, type CourseItem } from '../course'
import { normalizeText } from '../edu/match'
import type { Problem, TextRef } from '../edu/registry'
import type { TextResolver } from '../edu/text'
import type { ShellDef, ShellLintContext, ShellLintProblem } from './types'

/**
 * The course side of the encyclopedia explorer (EGS-10): the section `pack.shells.config['encyclopedia']`, its text keys, its checks and its
 * lint, plus the pure model the player and the lint share (`buildEncyclopedia`: the articles, the scavenger hunts, the timeline and the map,
 * from the section or, where it is missing, an automatic layout from the units, objectives, items and articles).
 *
 * The section (every part optional):
 *   timeline  events on a ruler: `{ id, year, label, text?, article? }` (`year` < 0 is BC; `label` and `text` are catalog keys)
 *   map       an image with brass pins: `{ asset, width, height, places: [{ id, x, y, label, article }] }` (x and y in image pixels)
 *   hunts     scavenger hunts: `{ id, unit, title, intro?, steps: [{ id, clue, article, item, collectible }] }`. A step: the clue is a riddle, the
 *             learner finds `article`, collects the `collectible` by answering `item`.
 *
 * Lint codes (all errors unless noted): ENC_HUNT_TARGET_MISSING, ENC_HUNT_ITEM_MISSING, ENC_HUNT_ITEM_DUPLICATE, ENC_UNIT_NO_HUNT, ENC_HUNT_EMPTY,
 * ENC_TIMELINE_ARTICLE_MISSING, ENC_MAP_ARTICLE_MISSING, ENC_MAP_PLACE_OUTSIDE, ENC_MAP_NO_IMAGE; warnings: ENC_ANSWER_NOT_IN_ARTICLE (the right
 * answer of a step's item is not in the target article in an edition), ENC_HUNT_ITEM_OTHER_UNIT. The validator adds UNKNOWN_UNIT, UNKNOWN_ASSET
 * and DUPLICATE_ID.
 */

// ---- the section ----

const eventSchema = z.strictObject({
  id: idSchema,
  /** A negative year is BC. There is no year 0. */
  year: z.number().int().refine((y) => y !== 0, 'there is no year 0'),
  label: keySchema,
  /** One more sentence about the event (a catalog key). */
  text: keySchema.optional(),
  article: idSchema.optional()
})

const placeSchema = z.strictObject({ id: idSchema, x: z.number(), y: z.number(), label: keySchema, article: idSchema })

const mapSchema = z.strictObject({
  asset: idSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  places: z.array(placeSchema).default([])
})

const stepSchema = z.strictObject({
  id: idSchema,
  /** The riddle that sends the learner to the article. */
  clue: keySchema,
  article: idSchema,
  /** The question asked when the collectible is taken. */
  item: idSchema,
  /** The name of the thing that goes into the codex. */
  collectible: keySchema
})

const huntSchema = z.strictObject({
  id: idSchema,
  unit: idSchema,
  title: keySchema,
  intro: keySchema.optional(),
  steps: z.array(stepSchema)
})

export const encyclopediaSectionSchema = z.strictObject({
  timeline: z.array(eventSchema).default([]),
  map: mapSchema.optional(),
  hunts: z.array(huntSchema).default([])
})
export type EncyclopediaSection = z.infer<typeof encyclopediaSectionSchema>

// ---- the model ----

export interface EncArticle {
  id: string
  titleKey: string
  /** The paragraphs' catalog keys (one for a real article; an objective and its facts for an automatic one). */
  bodyKeys: string[]
  unit?: string
  assetId?: string
  citations: string[]
  related: string[]
  /** Built from an objective (the unit has no article of its own). */
  virtual: boolean
}

export interface EncStep {
  id: string
  /** Missing in an automatic layout (the shell says "Find the article about ..."). */
  clue?: string
  article: string
  item: string
  /** Missing in an automatic layout. */
  collectible?: string
}

export interface EncHunt {
  id: string
  unit: string
  title?: string
  intro?: string
  steps: EncStep[]
  auto: boolean
}

export interface EncEvent {
  id: string
  year: number
  label: string
  text?: string
  article?: string
  /** An automatic event shows the item's own date text. */
  whenKey?: string
}

export interface EncPlace {
  id: string
  x: number
  y: number
  label: string
  article: string
}

export interface EncMap {
  asset: string
  /** 0 when unknown (an automatic map has no pins and needs no size). */
  width: number
  height: number
  places: EncPlace[]
  auto: boolean
}

export interface EncModel {
  articles: EncArticle[]
  hunts: EncHunt[]
  timeline: EncEvent[]
  map?: EncMap
  /** The steps of the grand hunt: the first and the last of every unit's hunts. */
  finalSteps: EncStep[]
}

// ---- text helpers (pure) ----

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'its', 'with', 'from', 'that', 'this'])
const fold = (s: string): string => normalizeText(s, { fold: true })

/** Whether the words of `phrase` all occur in `bodyNorm` (a folded, normalized text): numbers exactly, words by their stem (inflection). Words of 1-2 letters and filler words are ignored. */
export function containsPhrase(bodyNorm: string, phrase: string): boolean {
  const words = new Set(bodyNorm.split(' ').filter(Boolean))
  const list = [...words]
  const tokens = fold(phrase)
    .split(' ')
    .filter((t) => t.length > 2 || /^\d+$/.test(t))
    .filter((t) => !STOP.has(t))
  if (tokens.length === 0) return true
  return tokens.every((t) => {
    if (/^\d+$/.test(t)) return words.has(t)
    const stem = t.length >= 7 ? t.slice(0, t.length - 2) : t.length >= 5 ? t.slice(0, t.length - 1) : t // inflection: "Ateni" finds "Atena"
    return list.some((w) => w.startsWith(stem))
  })
}

/**
 * The right answer of an item as groups of alternatives (every group must be found, any alternative of a group will do), or null when the
 * kind has no text answer worth looking for in an article (true/false, multi-select, pairs, order, sort, crosswords, word searches).
 */
export function answerTexts(item: CourseItem, text: TextResolver): string[][] | null {
  const raw = item as unknown as Record<string, unknown>
  const t = (k: unknown): string[] => (typeof k === 'string' ? (text.hasAccepted(k) ? text.accepted(k) : text.text(k) ? [text.text(k) as string] : []) : [])
  const optionText = (id: unknown): string[] => {
    const o = (raw.options as { id: string; text: string }[] | undefined)?.find((x) => x.id === id)
    return o ? t(o.text) : []
  }
  switch (item.kind) {
    case 'mcq':
      return [optionText(raw.answer)]
    case 'typed':
      return [t(raw.answer)]
    case 'cloze':
      return ((raw.gaps as { answer: string }[] | undefined) ?? []).map((g) => t(g.answer))
    case 'flashcard':
      return [t(raw.back)]
    case 'hotspot': {
      const r = (raw.regions as { id: string; label: string }[] | undefined)?.find((x) => x.id === raw.answer)
      return [r ? t(r.label) : []]
    }
    case 'listening':
      return raw.mode === 'choose' ? [optionText(raw.answer)] : [t(raw.answer)]
    default:
      return null
  }
}

/** Whether the right answer of an item appears in the article's text (null: the kind has nothing to look for). */
export function answerInArticle(item: CourseItem, article: Pick<EncArticle, 'bodyKeys'>, text: TextResolver): boolean | null {
  const groups = answerTexts(item, text)
  if (!groups) return null
  const body = fold(article.bodyKeys.map((k) => text.text(k) ?? '').join(' '))
  return groups.every((alts) => alts.length === 0 || alts.some((a) => containsPhrase(body, a)))
}

/** The year in a date text ("1957", "AD 80", "432 BC", "about 1078", "432. pr. Kr."), negative for BC; undefined when there is none. */
export function parseYear(s: string): number | undefined {
  const t = s.normalize('NFKC').toLowerCase()
  const m = /(\d{1,4})/.exec(t)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n === 0) return undefined
  const bc = /\bbce?\b|\bb\.c\.|\bpr\.?\s*kr|\bpr\.?\s*n\.?\s*e\b|\bprije\s+krista/.test(t)
  return bc ? -n : n
}

// ---- building the model ----

const KIND_RANK: Record<string, number> = { mcq: 0, typed: 1, cloze: 2, 'true-false': 3, listening: 4, hotspot: 5, 'multi-select': 6, flashcard: 7, 'match-pairs': 8, order: 9, 'sort-groups': 10, crossword: 11, 'word-search': 12 }

const unitOfItem = (pack: CoursePack, item: Pick<CourseItem, 'objective'>): string | undefined => pack.objectives.find((o) => o.id === item.objective)?.unit

/** The articles of the course: the real ones, plus one per objective for a unit that has none (built from the objective and its facts). */
export function encArticles(pack: CoursePack): EncArticle[] {
  const real: EncArticle[] = pack.encyclopedia.articles.map((a) => ({
    id: a.id,
    titleKey: a.title,
    bodyKeys: [a.body],
    ...(a.unit ? { unit: a.unit } : {}),
    ...(a.asset ? { assetId: a.asset } : {}),
    citations: a.citations,
    related: a.related,
    virtual: false
  }))
  const out = [...real]
  const factClaim = new Map(pack.factbase.map((f) => [f.id, f.claim]))
  for (const unit of pack.units) {
    if (real.some((a) => a.unit === unit.id)) continue
    for (const o of pack.objectives.filter((x) => x.unit === unit.id)) {
      out.push({
        id: `auto-${o.id}`,
        titleKey: o.text,
        bodyKeys: [o.text, ...o.facts.map((f) => factClaim.get(f)).filter((k): k is string => !!k)],
        unit: unit.id,
        citations: o.facts,
        related: [],
        virtual: true
      })
    }
  }
  return out
}

/** The hunts of a course without any: one per unit, a step per article of the unit, each with an item that asks what the article tells. */
export function autoHunts(pack: CoursePack, articles: readonly EncArticle[], text: TextResolver): EncHunt[] {
  const out: EncHunt[] = []
  const objFacts = new Map(pack.objectives.map((o) => [o.id, new Set(o.facts)]))
  for (const unitId of unitOrder(pack.units)) {
    const unitItems = pack.items.filter((i) => unitOfItem(pack, i) === unitId)
    if (unitItems.length === 0) continue
    const arts = articles.filter((a) => a.unit === unitId).slice(0, 6)
    const used = new Set<string>()
    const steps: EncStep[] = []
    for (const a of arts) {
      const cites = new Set(a.citations)
      const own = unitItems.filter((i) => (a.virtual ? i.objective === a.id.slice('auto-'.length) : [...(objFacts.get(i.objective) ?? [])].some((f) => cites.has(f))))
      const pool = (own.length > 0 ? own : unitItems).filter((i) => !used.has(i.id))
      const rank = (i: CourseItem): number => (answerInArticle(i, a, text) === false ? 100 : 0) + (KIND_RANK[i.kind] ?? 20) + (own.includes(i) ? 0 : 40)
      const best = [...pool, ...unitItems.filter((i) => !used.has(i.id) && !pool.includes(i))].sort((x, y) => rank(x) - rank(y))[0]
      if (!best) continue
      used.add(best.id)
      steps.push({ id: `s-${a.id}`, article: a.id, item: best.id })
    }
    if (steps.length > 0) out.push({ id: `h-${unitId}`, unit: unitId, steps, auto: true })
  }
  return out
}

/** The steps of the grand hunt: the first and the last step of every unit's hunts, in unit order. */
export function finalStepsOf(hunts: readonly EncHunt[], perUnit = 2): EncStep[] {
  const units = [...new Set(hunts.map((h) => h.unit))]
  const out: EncStep[] = []
  for (const u of units) {
    const steps = hunts.filter((h) => h.unit === u).flatMap((h) => h.steps)
    const picks = perUnit >= 2 && steps.length >= 2 ? [steps[0] as EncStep, steps[steps.length - 1] as EncStep] : steps.slice(0, 1)
    for (const s of picks) if (!out.some((o) => o.id === s.id)) out.push(s)
  }
  return out
}

/** The timeline an automatic layout builds: the dated entries of `order` items with `timeline: true` (their `when` text gives the year). */
export function autoTimeline(pack: CoursePack, articles: readonly EncArticle[], text: TextResolver): EncEvent[] {
  const out: EncEvent[] = []
  for (const it of pack.items) {
    if (it.kind !== 'order' || (it as unknown as { timeline?: boolean }).timeline !== true) continue
    for (const el of (it as unknown as { items: { id: string; text: string; when?: string }[] }).items) {
      const when = el.when ? text.text(el.when) : undefined
      const year = when ? parseYear(when) : undefined
      if (year === undefined) continue
      const label = fold(text.text(el.text) ?? '')
      const hit = articles.find((a) => !a.virtual && label.includes(fold(text.text(a.titleKey) ?? '\u0000'))) ?? articles.find((a) => !a.virtual && countHits(label, fold(a.bodyKeys.map((k) => text.text(k) ?? '').join(' '))) >= 2)
      out.push({ id: `${it.id}.${el.id}`, year, label: el.text, ...(el.when ? { whenKey: el.when } : {}), ...(hit ? { article: hit.id } : {}) })
    }
  }
  return out.sort((a, b) => a.year - b.year)
}

const countHits = (label: string, body: string): number => {
  const words = new Set(body.split(' '))
  return label.split(' ').filter((w) => w.length >= 5 && words.has(w)).length
}

/** The first image asset, as an automatic map (no pins). */
export function autoMap(pack: CoursePack): EncMap | undefined {
  const img = pack.assets.find((a) => a.kind === 'image')
  return img ? { asset: img.id, width: 0, height: 0, places: [], auto: true } : undefined
}

/** The model of a course for an edition: the section where it has a part, the automatic layout where it has not. */
export function buildEncyclopedia(pack: CoursePack, section: EncyclopediaSection | undefined, text: TextResolver): EncModel {
  const articles = encArticles(pack)
  const hunts: EncHunt[] =
    section && section.hunts.length > 0
      ? section.hunts.map((h) => ({ id: h.id, unit: h.unit, title: h.title, ...(h.intro ? { intro: h.intro } : {}), steps: h.steps.map((s) => ({ ...s })), auto: false }))
      : autoHunts(pack, articles, text)
  const timeline: EncEvent[] =
    section && section.timeline.length > 0
      ? [...section.timeline].map((e) => ({ id: e.id, year: e.year, label: e.label, ...(e.text ? { text: e.text } : {}), ...(e.article ? { article: e.article } : {}) })).sort((a, b) => a.year - b.year)
      : autoTimeline(pack, articles, text)
  const map: EncMap | undefined = section?.map ? { asset: section.map.asset, width: section.map.width, height: section.map.height, places: section.map.places.map((p) => ({ ...p })), auto: false } : autoMap(pack)
  return { articles, hunts, timeline, ...(map ? { map } : {}), finalSteps: finalStepsOf(hunts) }
}

// ---- the def ----

const at = (path: string): string => path

function validate(section: EncyclopediaSection, pack: CoursePack): Problem[] {
  const out: Problem[] = []
  const units = new Set(pack.units.map((u) => u.id))
  const dup = (kind: string, ids: string[], base: string): void => {
    const seen = new Set<string>()
    ids.forEach((id, i) => {
      if (seen.has(id)) out.push({ code: 'DUPLICATE_ID', path: at(`${base}[${i}].id`), message: `the ${kind} id "${id}" is used twice` })
      seen.add(id)
    })
  }
  dup('hunt', section.hunts.map((h) => h.id), 'hunts')
  dup('timeline event', section.timeline.map((e) => e.id), 'timeline')
  if (section.map) dup('place', section.map.places.map((p) => p.id), 'map.places')
  // step ids are unique across the section: the grand hunt mixes the steps of every hunt
  const steps = section.hunts.flatMap((h, hi) => h.steps.map((s, si) => ({ id: s.id, path: `hunts[${hi}].steps[${si}].id` })))
  const seen = new Set<string>()
  for (const s of steps) {
    if (seen.has(s.id)) out.push({ code: 'DUPLICATE_ID', path: s.path, message: `the step id "${s.id}" is used twice (step ids are unique across all hunts)` })
    seen.add(s.id)
  }
  section.hunts.forEach((h, i) => {
    if (!units.has(h.unit)) out.push({ code: 'UNKNOWN_UNIT', path: `hunts[${i}].unit`, message: `unknown unit "${h.unit}"` })
  })
  return out
}

const lint = (section: EncyclopediaSection | undefined, ctx: ShellLintContext): ShellLintProblem[] => {
  const out: ShellLintProblem[] = []
  const { pack } = ctx
  const source = ctx.resolvers[pack.sourceLang] ?? (Object.values(ctx.resolvers)[0] as TextResolver)
  const model = buildEncyclopedia(pack, section, source)
  const articles = new Map(model.articles.map((a) => [a.id, a]))
  const items = new Map(pack.items.map((i) => [i.id, i]))
  const assets = new Map(pack.assets.map((a) => [a.id, a]))

  model.hunts.forEach((h, hi) => {
    if (h.steps.length === 0) out.push({ code: 'ENC_HUNT_EMPTY', path: `hunts[${hi}]`, message: `the hunt "${h.id}" has no steps` })
    const seenItems = new Map<string, string>()
    h.steps.forEach((s, si) => {
      const p = `hunts[${hi}].steps[${si}]`
      const article = articles.get(s.article)
      const item = items.get(s.item)
      if (!article) out.push({ code: 'ENC_HUNT_TARGET_MISSING', path: `${p}.article`, message: `the step "${s.id}" sends the learner to the article "${s.article}", which does not exist` })
      if (!item) out.push({ code: 'ENC_HUNT_ITEM_MISSING', path: `${p}.item`, message: `the step "${s.id}" asks the item "${s.item}", which does not exist` })
      if (item) {
        const prev = seenItems.get(item.id)
        if (prev) out.push({ code: 'ENC_HUNT_ITEM_DUPLICATE', path: `${p}.item`, message: `the steps "${prev}" and "${s.id}" of the hunt "${h.id}" ask the same item "${item.id}"; the second can never come up` })
        else seenItems.set(item.id, s.id)
        const unit = unitOfItem(pack, item)
        if (unit && unit !== h.unit) out.push({ code: 'ENC_HUNT_ITEM_OTHER_UNIT', severity: 'warning', path: `${p}.item`, message: `the item "${item.id}" belongs to the unit "${unit}", not to the hunt's unit "${h.unit}"` })
      }
      if (article && item) {
        for (const lang of ctx.editions) {
          const res = ctx.resolvers[lang]
          if (!res) continue
          if (answerInArticle(item, article, res) === false) out.push({ code: 'ENC_ANSWER_NOT_IN_ARTICLE', severity: 'warning', path: p, lang, message: `the right answer of "${item.id}" does not appear in the article "${article.id}": the hunt would send the learner to a page that does not hold the answer` })
        }
      }
    })
  })
  const covered = new Set(model.hunts.filter((h) => h.steps.length > 0).map((h) => h.unit))
  pack.units.forEach((u, i) => {
    if (!covered.has(u.id)) out.push({ code: 'ENC_UNIT_NO_HUNT', path: `hunts`, message: `no hunt covers the unit "${u.id}" (units[${i}]): it could never be mastered in the encyclopedia` })
  })

  model.timeline.forEach((e, i) => {
    if (e.article && !articles.has(e.article)) out.push({ code: 'ENC_TIMELINE_ARTICLE_MISSING', path: `timeline[${i}].article`, message: `the event "${e.id}" opens the article "${e.article}", which does not exist` })
  })

  if (model.map) {
    const m = model.map
    const asset = assets.get(m.asset)
    if (asset && asset.kind !== 'image') out.push({ code: 'ENC_MAP_NO_IMAGE', path: 'map.asset', message: `the map asset "${m.asset}" is ${asset.kind === 'audio' ? 'audio' : 'not an image'}, not an image` })
    m.places.forEach((p, i) => {
      if (!articles.has(p.article)) out.push({ code: 'ENC_MAP_ARTICLE_MISSING', path: `map.places[${i}].article`, message: `the place "${p.id}" opens the article "${p.article}", which does not exist` })
      if (m.width > 0 && m.height > 0 && (p.x < 0 || p.x > m.width || p.y < 0 || p.y > m.height)) out.push({ code: 'ENC_MAP_PLACE_OUTSIDE', path: `map.places[${i}]`, message: `the place "${p.id}" (${p.x}, ${p.y}) is outside the ${m.width} x ${m.height} image` })
    })
  }
  return out
}

const CODES = [
  'ENC_HUNT_TARGET_MISSING',
  'ENC_HUNT_ITEM_MISSING',
  'ENC_HUNT_ITEM_DUPLICATE',
  'ENC_UNIT_NO_HUNT',
  'ENC_HUNT_EMPTY',
  'ENC_TIMELINE_ARTICLE_MISSING',
  'ENC_MAP_ARTICLE_MISSING',
  'ENC_MAP_PLACE_OUTSIDE',
  'ENC_MAP_NO_IMAGE',
  'ENC_ANSWER_NOT_IN_ARTICLE',
  'ENC_HUNT_ITEM_OTHER_UNIT'
] as const

export const encyclopediaShell: ShellDef<EncyclopediaSection> = {
  id: 'encyclopedia',
  theme: 'parchment',
  requiresSection: false,
  schema: encyclopediaSectionSchema,
  textRefs: (s): TextRef[] => [
    ...s.timeline.flatMap((e, i) => [{ path: `timeline[${i}].label`, key: e.label, role: 'string' as const }, ...(e.text ? [{ path: `timeline[${i}].text`, key: e.text, role: 'string' as const }] : [])]),
    ...(s.map?.places ?? []).map((p, i) => ({ path: `map.places[${i}].label`, key: p.label, role: 'string' as const })),
    ...s.hunts.flatMap((h, hi) => [
      { path: `hunts[${hi}].title`, key: h.title, role: 'string' as const },
      ...(h.intro ? [{ path: `hunts[${hi}].intro`, key: h.intro, role: 'string' as const }] : []),
      ...h.steps.flatMap((st, si) => [
        { path: `hunts[${hi}].steps[${si}].clue`, key: st.clue, role: 'string' as const },
        { path: `hunts[${hi}].steps[${si}].collectible`, key: st.collectible, role: 'string' as const }
      ])
    ])
  ],
  assetRefs: (s) => (s.map ? [{ path: 'map.asset', id: s.map.asset }] : []),
  validate,
  lint,
  codes: CODES,
  warnings: ['ENC_ANSWER_NOT_IN_ARTICLE', 'ENC_HUNT_ITEM_OTHER_UNIT']
}
