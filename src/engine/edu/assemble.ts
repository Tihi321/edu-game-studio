import { CEFR_LEVELS } from '../../shared/course'
import type { TextCatalog } from '../../shared/course'
import { normalizeText } from '../../shared/edu'
import { applyExplain, citationsOf, mergeAccepted, numberCitations } from './authoring'
import type { AcceptedOutput, Article, AuthoredItem, Curriculum, DesignData, ExplainOutput, Frame } from './authoring'
import type { FactPack } from './factbase'
import { applyMedia } from './media-link'
import type { MediaMerge } from './media-link'

/**
 * `assembleCourse`: the pure step that turns what the roles wrote into the course contract (EGS-02): `course/pack.json` and the text catalogs.
 * Everything the roles wrote is inline text; here it becomes catalog keys. The result must pass `validateCourse` with no problem at all, and
 * builds and lints clean (tests/edu-assemble.test.ts).
 *
 * Keys: `course.title`, `unit.<id>.title|summary`, `obj.<id>.text`, `item.<id>.prompt|expl|hint|dyk|why`, `item.<id>.opt.<optId>` (and `.why`),
 * `item.<id>.text` (cloze), `item.<id>.gap.<gapId>` (accepted answers) and `.b<n>` (bank words), `item.<id>.answer` (typed, accepted),
 * `item.<id>.pair.<pid>.l|r`, `item.<id>.step.<sid>` (and `.when`), `item.<id>.group.<gid>`, `item.<id>.entry.<eid>` (and `.why`),
 * `item.<id>.back`, `art.<id>.title|body`, `fact.<id>.claim`, `story.*`.
 *
 * Languages: the pack has one edition, the source language (other editions come from Book Translator later). In a language course
 * (`targetLang` set) an item with `taught: true` has its answers (options, cloze text and gaps, typed answers, pair sides, steps, entries, back)
 * in the target-language catalog, which every edition falls back to; prompts, explanations, hints and whys stay in the source language.
 */

export interface AssembleInput {
  slug: string
  title: string
  subject: string
  audience: string
  sourceLang: string
  /** A language course: the language that is taught. */
  targetLang?: string
  cefr?: string
  /** Verbs per verb unit of the format (recorded in `extensions.language`). */
  verbsPerUnit?: number
  /** The run number and the brief, recorded in `extensions.pipeline`. */
  run: number
  brief?: unknown
  /** The fact base as pack data (`FactBase.toPack`). */
  factbase: FactPack
  curriculum: Curriculum
  articles: Article[]
  /** The items after the item-writer and the misconception-designer (and any revise round). */
  items: AuthoredItem[]
  /** The explainer's output: explanations, hints and hooks. */
  explain?: ExplainOutput
  /** The language-coach's alternatives for typed answers and cloze gaps. */
  accepted?: AcceptedOutput
  design?: DesignData
  story?: Frame
  /** Corrected strings from the polish round: `key -> text`, applied to keys that exist. */
  polish?: Record<string, string>
  /** The images of the course (EGS-15): the assets with files, and what each illustrates. Merged into ssets, the alt texts, rticle.asset, item.asset and shells.config[*].art. */
  media?: MediaMerge
}

export interface AssembledCourse {
  pack: Record<string, unknown>
  catalogs: Record<string, TextCatalog>
  /** The text keys of each item, for the polish round: item id -> keys. */
  itemKeys: Record<string, string[]>
}

const norm = (s: string): string => normalizeText(s, { fold: true })

/** Turns the roles' outputs into the pack and its text catalogs. Throws when an item names an objective that is not in the curriculum. */
export function assembleCourse(input: AssembleInput): AssembledCourse {
  const src: TextCatalog = { schema: 1, lang: input.sourceLang, strings: {}, accepted: {} }
  const tgt: TextCatalog | undefined = input.targetLang && input.targetLang !== input.sourceLang ? { schema: 1, lang: input.targetLang, strings: {}, accepted: {} } : undefined
  const put = (cat: TextCatalog, key: string, value: string): string => {
    cat.strings[key] = value
    return key
  }
  const putAccepted = (cat: TextCatalog, key: string, list: string[], alsoString = false): string => {
    cat.accepted![key] = list
    if (alsoString) cat.strings[key] = list[0]!
    return key
  }

  put(src, 'course.title', input.title)
  const unitOf = new Map(input.curriculum.objectives.map((o) => [o.id, o.unit]))

  const units = input.curriculum.units.map((u) => ({
    id: u.id,
    title: put(src, `unit.${u.id}.title`, u.title),
    summary: put(src, `unit.${u.id}.summary`, u.summary),
    requires: u.requires
  }))
  const objectives = input.curriculum.objectives.map((o) => ({ id: o.id, unit: o.unit, bloom: o.bloom, text: put(src, `obj.${o.id}.text`, o.text), facts: o.facts }))

  // ---- items ----
  let authored = input.items
  if (input.explain) authored = applyExplain(authored, input.explain)
  if (input.accepted) authored = mergeAccepted(authored, input.accepted)
  const itemKeys: Record<string, string[]> = {}
  const items = authored.map((it) => {
    const unit = unitOf.get(it.objective)
    if (unit === undefined) throw new Error(`item "${it.id}" names the objective "${it.objective}", which is not in the curriculum`)
    const before = new Set([...Object.keys(src.strings), ...Object.keys(tgt?.strings ?? {})])
    const k = (suffix: string) => `item.${it.id}.${suffix}`
    const content = it.taught && tgt ? tgt : src
    const out: Record<string, unknown> = {
      id: it.id,
      objective: it.objective,
      kind: it.kind,
      prompt: put(src, k('prompt'), it.prompt),
      explanation: put(src, k('expl'), it.explanation),
      ...(it.didYouKnow ? { didYouKnow: put(src, k('dyk'), it.didYouKnow) } : {}),
      ...(it.hint ? { hint: put(src, k('hint'), it.hint) } : {}),
      difficulty: input.design?.difficulty[it.id] ?? it.difficulty ?? 3,
      tags: [`unit:${unit}`],
      extensions: { facts: [...new Set(it.facts)], ...(it.didYouKnowFact ? { didYouKnowFact: it.didYouKnowFact } : {}) }
    }
    switch (it.kind) {
      case 'mcq':
      case 'multi-select': {
        const rightIds = it.kind === 'mcq' ? [it.answer] : it.answers
        out.options = it.options.map((o) => ({
          id: o.id,
          text: put(content, k(`opt.${o.id}`), o.text),
          ...(o.why && !rightIds.includes(o.id) ? { why: put(src, k(`opt.${o.id}.why`), o.why) } : {})
        }))
        if (it.kind === 'mcq') out.answer = it.answer
        else out.answers = it.answers
        break
      }
      case 'true-false':
        out.answer = it.answer
        if (it.why) out.why = put(src, k('why'), it.why)
        break
      case 'cloze':
        out.text = put(content, k('text'), it.text)
        out.gaps = it.gaps.map((g) => {
          const answer = k(`gap.${g.id}`)
          if (!g.bank) {
            putAccepted(content, answer, g.accepted)
            return { id: g.id, answer }
          }
          putAccepted(content, answer, g.accepted, true)
          const wrong = g.bank.filter((b) => norm(b) !== norm(g.accepted[0]!))
          const bank = [answer, ...wrong.map((b, n) => put(content, `${answer}.b${n + 1}`, b))]
          // the bank keeps the order the writer gave (the right word where it stood), the player shuffles it anyway
          const at = g.bank.findIndex((b) => norm(b) === norm(g.accepted[0]!))
          if (at > 0) bank.splice(at, 0, bank.shift()!)
          return { id: g.id, answer, bank }
        })
        break
      case 'typed':
        out.answer = putAccepted(content, k('answer'), it.accepted)
        break
      case 'match-pairs':
        out.pairs = it.pairs.map((p) => ({ id: p.id, left: put(content, k(`pair.${p.id}.l`), p.left), right: put(content, k(`pair.${p.id}.r`), p.right) }))
        break
      case 'order':
        out.items = it.items.map((x) => ({ id: x.id, text: put(content, k(`step.${x.id}`), x.text), ...(x.when ? { when: put(content, k(`step.${x.id}.when`), x.when) } : {}) }))
        if (it.timeline !== undefined) out.timeline = it.timeline
        break
      case 'sort-groups':
        out.groups = it.groups.map((g) => ({ id: g.id, title: put(content, k(`group.${g.id}`), g.title) }))
        out.items = it.items.map((x) => ({ id: x.id, text: put(content, k(`entry.${x.id}`), x.text), group: x.group, ...(x.why ? { why: put(src, k(`entry.${x.id}.why`), x.why) } : {}) }))
        break
      case 'flashcard':
        out.back = put(content, k('back'), it.back)
        break
    }
    itemKeys[it.id] = [...Object.keys(src.strings), ...Object.keys(tgt?.strings ?? {})].filter((key) => !before.has(key))
    return out
  })

  // ---- articles ----
  const articleIds = new Set(input.articles.map((a) => a.id)) // a link to a planned article that was never written is dropped
  const articles = input.articles.map((a) => {
    const citations = citationsOf(a)
    return {
      id: a.id,
      title: put(src, `art.${a.id}.title`, a.title),
      body: put(src, `art.${a.id}.body`, numberCitations(a.body, citations)),
      citations,
      related: a.related.filter((r) => articleIds.has(r)),
      unit: a.unit
    }
  })

  // ---- facts, story, shells ----
  for (const [key, value] of Object.entries(input.factbase.strings)) put(src, key, value)
  const extensions: Record<string, unknown> = { pipeline: { run: input.run, generatedBy: 'edu-pipeline', ...(input.brief !== undefined ? { brief: input.brief } : {}), ...(input.design?.requested.length ? { requestedShells: input.design.requested } : {}) } }
  if (input.story) {
    const f = input.story
    extensions.story = {
      premise: put(src, 'story.premise', f.premise),
      intro: put(src, 'story.intro', f.intro),
      outro: put(src, 'story.outro', f.outro),
      characters: f.characters.map((c, i) => ({ id: `c${i + 1}`, name: put(src, `story.char.${i + 1}.name`, c.name), role: put(src, `story.char.${i + 1}.role`, c.role), description: put(src, `story.char.${i + 1}.description`, c.description) })),
      beats: f.unitBeats.map((b) => ({ unit: b.unit, text: put(src, `story.beat.${b.unit}`, b.beat) }))
    }
  }
  const verbUnits = input.curriculum.units.filter((u) => u.verb).map((u) => u.id)
  if (tgt && verbUnits.length) extensions.language = { verbUnits, verbsPerUnit: input.verbsPerUnit ?? 6 }
  const d = input.design
  const shells = d
    ? { enabled: d.enabled, config: { 'quiz-arena': { ...d.quizArena }, ...(d.enabled.includes('rpg') && input.story ? { rpg: { story: { intro: ['story.intro'], outro: ['story.outro'] } } } : {}) } }
    : { enabled: ['quiz-arena'], config: {} }

  for (const [key, value] of Object.entries(input.polish ?? {})) {
    if (key in src.strings) src.strings[key] = value
    else if (tgt && key in tgt.strings) tgt.strings[key] = value
  }

  const pack: Record<string, unknown> = {
    schema: 1,
    id: input.slug,
    slug: input.slug,
    sourceLang: input.sourceLang,
    languages: [input.sourceLang],
    ...(tgt ? { targetLang: input.targetLang } : {}),
    subject: input.subject,
    audience: input.audience,
    ...(input.cefr && (CEFR_LEVELS as readonly string[]).includes(input.cefr) ? { cefr: input.cefr } : {}),
    units,
    objectives,
    items,
    shells,
    assets: [],
    cues: [],
    encyclopedia: { articles },
    factbase: input.factbase.factbase,
    extensions
  }
  if (input.media) applyMedia(pack, src, input.media, tgt ? { [tgt.lang]: tgt } : {})
  if (!Object.keys(src.accepted!).length) delete src.accepted
  const catalogs: Record<string, TextCatalog> = { [src.lang]: src }
  if (tgt) {
    if (!Object.keys(tgt.accepted!).length) delete tgt.accepted
    catalogs[tgt.lang] = tgt
  }
  return { pack, catalogs, itemKeys }
}

/**
 * The course text as the reviewers read it: units, objectives, articles and items, each line `[key] text`, so a problem can name the key to
 * correct (the polish round only changes keys a reviewer flagged). `lang` is the catalog to read (the source language).
 */
export function renderCourseForReview(pack: { units: { id: string; title: string; summary?: string }[]; objectives: { id: string; unit: string; text: string }[]; items: Record<string, unknown>[]; encyclopedia: { articles: { id: string; title: string; body: string; unit?: string }[] } }, catalogs: Record<string, TextCatalog>, lang: string, targetLang?: string): string {
  const t = (key: unknown): string => (typeof key === 'string' ? (catalogs[lang]?.strings[key] ?? (targetLang ? catalogs[targetLang]?.strings[key] : undefined) ?? '') : '')
  const line = (key: unknown, label = ''): string => (typeof key === 'string' ? `  [${key}] ${label}${t(key)}` : '')
  const lines: string[] = []
  for (const u of pack.units) {
    lines.push(`## Unit ${u.id}`, line(u.title), line(u.summary))
    for (const o of pack.objectives.filter((x) => x.unit === u.id)) lines.push(`Objective ${o.id}:`, line(o.text))
    for (const a of pack.encyclopedia.articles.filter((x) => x.unit === u.id)) lines.push(`Article ${a.id}:`, line(a.title), line(a.body))
    const unitItems = pack.items.filter((i) => pack.objectives.some((o) => o.id === i.objective && o.unit === u.id))
    for (const it of unitItems) {
      lines.push(`Item ${String(it.id)} (${String(it.kind)}):`)
      for (const [field, v] of Object.entries(it)) collect(field, v, lines, line)
    }
  }
  return lines.filter(Boolean).join('\n')
}

const KEY_FIELDS = new Set(['prompt', 'explanation', 'didYouKnow', 'hint', 'text', 'why', 'back', 'left', 'right', 'title', 'when', 'answer'])
function collect(field: string, v: unknown, lines: string[], line: (key: unknown, label?: string) => string): void {
  if (Array.isArray(v)) for (const x of v) collect(field, x, lines, line)
  else if (v && typeof v === 'object') for (const [f, x] of Object.entries(v as Record<string, unknown>)) collect(f, x, lines, line)
  else if (typeof v === 'string' && KEY_FIELDS.has(field) && /^[A-Za-z0-9][A-Za-z0-9_.:-]*\.[A-Za-z0-9_.:-]+$/.test(v)) lines.push(line(v, `${field}: `))
}
