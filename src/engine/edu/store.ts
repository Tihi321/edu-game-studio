import { promises as fs } from 'node:fs'
import path from 'node:path'
import { CEFR_LEVELS, COURSE_SCHEMA_VERSION, textCatalogSchema } from '../../shared/course'
import { ITEM_KINDS, validateCourse, type Problem } from '../../shared/edu'
import { atomicWrite } from '../store/atomic'
import { buildCourse, buildDirOf, GAME_DATA_FILE, type BuildResult } from './build'
import { loadCourseFolder, validateCourseFolder } from './course-io'
import { harvestGlossary, type HarvestOptions, type HarvestResult } from './harvest'
import { lintGame, summarize, type LintResult } from './lint'
import { applyMedia } from './media-link'
import type { MediaApplied, MediaMerge } from './media-link'
import { assertSlug, coursesDir } from './paths'

/**
 * The course files of a data folder, as the CLI and the MCP tools use them (no engine needed, so `yarn engine -- build x` works while the
 * app runs). `courses/<slug>/course/{pack.json, text/<lang>.json, assets/*}` is the source; `courses/<slug>/build/` is the built game.
 * Every write is atomic (`store/atomic`), and the writes of one course are serialised.
 */

/** The slug format of a pack (stricter than a data-folder slug). */
export const PACK_SLUG = /^[a-z0-9][a-z0-9-]*$/

/** Problems that only say the course is not finished (a text is still to write, a file still to add): an edit that leaves them is accepted. */
export const PENDING_CODES = new Set(['MISSING_TEXT', 'MISSING_WHY', 'MISSING_GAP_MARKER', 'MISSING_CATALOG', 'MISSING_ASSET_FILE', 'PUZZLE_UNPLACED', 'PUZZLE_INVALID'])

/** Top-level pack fields `edu_course_edit` may change (items have their own tools; id, slug and schema never change). */
export const EDITABLE_PACK_FIELDS = ['sourceLang', 'languages', 'targetLang', 'subject', 'audience', 'cefr', 'matching', 'units', 'objectives', 'shells', 'assets', 'cues', 'encyclopedia', 'factbase', 'extensions'] as const

export type TextPatch = Record<string, { strings?: Record<string, string>; accepted?: Record<string, string[]> }>
type Json = Record<string, unknown>

export interface CourseSummary {
  slug: string
  title: string
  updatedAt: string
}

/** The courses in `<data>/courses/`: a folder with a `course.md` or a `course/pack.json`. */
export async function listCourses(dataDir: string): Promise<CourseSummary[]> {
  const root = coursesDir(dataDir)
  let names: string[]
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: CourseSummary[] = []
  for (const slug of names.sort()) {
    const dir = path.join(root, slug)
    let at = 0
    for (const marker of [path.join(dir, 'course.md'), path.join(dir, 'course', 'pack.json')]) {
      const st = await fs.stat(marker).catch(() => null)
      if (st) at = Math.max(at, st.mtimeMs)
    }
    if (at) out.push({ slug, title: slug, updatedAt: new Date(at).toISOString() })
  }
  return out
}

/** RFC 7396 JSON merge patch: objects merge, `null` deletes a key, everything else (arrays included) replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const base: Json = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Json) } : {}
  for (const [k, v] of Object.entries(patch as Json)) {
    if (v === null) delete base[k]
    else base[k] = mergePatch(base[k], v)
  }
  return base
}

const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'
const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false)
const problemKey = (p: Problem): string => `${p.code}|${p.message}`

const fmt = (ps: readonly Problem[], n = 8): string => ps.slice(0, n).map((p) => `${p.code} at ${p.path || '(pack)'}: ${p.message}`).join('; ') + (ps.length > n ? `; ... and ${ps.length - n} more` : '')

export interface CreateCourseInput {
  slug: string
  title: string
  languages: string[]
  sourceLang: string
  subject: string
  audience: string
  targetLang?: string
  cefr?: string
}

export interface CourseStats {
  units: number
  objectives: number
  items: number
  byKind: Record<string, number>
}

export interface BuildState {
  built: boolean
  builtAt?: string
  /** A course file is newer than the build. */
  stale?: boolean
}

export interface MutationResult {
  slug: string
  /** What is still missing (texts, why keys ...): the course is saved, it is just not finished. */
  pending: Problem[]
  pendingCount: number
}

export class CourseStore {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    readonly dataDir: string,
    private readonly opts: { env?: NodeJS.ProcessEnv; playerDir?: string } = {}
  ) {}

  list(): Promise<CourseSummary[]> {
    return listCourses(this.dataDir)
  }

  /** `courses/<slug>`: holds `course/` (the source) and `build/`. */
  root(slug: string): string {
    return path.join(coursesDir(this.dataDir), assertSlug(slug))
  }
  buildDir(slug: string): string {
    return buildDirOf(this.root(slug))
  }

  private async exclusive<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(slug, next.catch(() => undefined))
    return next
  }

  private async load(slug: string): Promise<{ pack: Json; catalogs: Record<string, Json> }> {
    const root = this.root(slug)
    if (!(await exists(path.join(root, 'course', 'pack.json')))) throw new Error(`no course "${slug}" (courses/${slug}/course/pack.json is missing)`)
    const loaded = await loadCourseFolder(root)
    const bad = loaded.problems.filter((p) => p.code === 'PARSE')
    if (bad.length > 0) throw new Error(`the files of "${slug}" cannot be read: ${fmt(bad)}`)
    if (!isObj(loaded.pack)) throw new Error(`courses/${slug}/course/pack.json is not an object`)
    return { pack: loaded.pack, catalogs: loaded.catalogs as Record<string, Json> }
  }

  private async save(slug: string, pack: Json, catalogs: Record<string, unknown>, only?: { catalogs?: string[] }): Promise<void> {
    const dir = path.join(this.root(slug), 'course')
    for (const [lang, cat] of Object.entries(catalogs)) {
      if (only?.catalogs && !only.catalogs.includes(lang)) continue
      await atomicWrite(path.join(dir, 'text', `${lang}.json`), json(cat))
    }
    await atomicWrite(path.join(dir, 'pack.json'), json(pack))
  }

  /** Validates a pack in progress: `blocking` stops an edit, `pending` only says it is unfinished. */
  private check(pack: unknown, catalogs: Record<string, unknown>): { blocking: Problem[]; pending: Problem[] } {
    const problems = validateCourse(pack, catalogs).problems
    return { blocking: problems.filter((p) => !PENDING_CODES.has(p.code)), pending: problems.filter((p) => PENDING_CODES.has(p.code)) }
  }

  /** Refuses (throws) when `after` has a blocking problem that `before` did not. */
  private refuse(what: string, before: Problem[], after: Problem[]): void {
    const known = new Set(before.map(problemKey))
    const fresh = after.filter((p) => !known.has(problemKey(p)))
    if (fresh.length > 0) throw new Error(`${what} refused, nothing was written: ${fmt(fresh)}`)
  }

  /** Merges strings and accepted lists into the catalogs (a missing catalog of an edition or the target language is created). */
  private mergeText(pack: Json, catalogs: Record<string, Json>, patch: TextPatch | undefined): { catalogs: Record<string, Json>; touched: string[] } {
    const out = { ...catalogs }
    const touched: string[] = []
    const known = new Set<string>([...(Array.isArray(pack.languages) ? (pack.languages as string[]) : []), ...(typeof pack.targetLang === 'string' ? [pack.targetLang] : [])])
    for (const [lang, p] of Object.entries(patch ?? {})) {
      if (!known.has(lang)) throw new Error(`"${lang}" is not an edition or the target language of this course (languages: ${[...known].join(', ')}); add it with edu_course_edit first`)
      const cur: Json = out[lang] ?? { schema: 1, lang, strings: {} }
      const next: Json = { ...cur, strings: { ...(cur.strings as Json), ...(p.strings ?? {}) } }
      if (p.accepted) next.accepted = { ...((cur.accepted as Json | undefined) ?? {}), ...p.accepted }
      const parsed = textCatalogSchema.safeParse(next)
      if (!parsed.success) throw new Error(`the text for "${lang}" is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      out[lang] = next
      touched.push(lang)
    }
    return { catalogs: out, touched }
  }

  private result(slug: string, pack: Json, catalogs: Record<string, unknown>, filter?: (p: Problem) => boolean): MutationResult {
    const pending = this.check(pack, catalogs).pending.filter(filter ?? (() => true))
    return { slug, pending: pending.slice(0, 40), pendingCount: pending.length }
  }

  /**
   * Writes the pack and the catalogs that `assembleCourse` made as the course's files (`courses/<slug>/course/`), over what is there. The course
   * must be complete: any problem of `validateCourse` (a missing text included) refuses the write and nothing is written. Used by the pipeline's
   * assemble step; the files then go through `validate`, `build` and `lint` like any course.
   */
  writeAssembled(slug: string, pack: Record<string, unknown>, catalogs: Record<string, unknown>): Promise<{ slug: string; dir: string }> {
    if (!PACK_SLUG.test(slug)) return Promise.reject(new Error(`invalid slug "${slug}": lower-case letters, digits and -`))
    return this.exclusive(slug, async () => {
      const problems = validateCourse(pack, catalogs).problems
      if (problems.length > 0) throw new Error(`the assembled course is not valid, nothing was written: ${fmt(problems)}`)
      await this.save(slug, pack, catalogs)
      // the catalog of an edition made by an earlier run (`addEditions`) is no longer one: the pack lists one language again, so it would be UNKNOWN_LANGUAGE
      const keep = new Set(Object.keys(catalogs))
      const textDir = path.join(this.root(slug), 'course', 'text')
      for (const f of await fs.readdir(textDir).catch(() => [] as string[])) if (f.endsWith('.json') && !keep.has(f.slice(0, -5))) await fs.rm(path.join(textDir, f), { force: true })
      return { slug, dir: this.root(slug) }
    })
  }

  /**
   * Adds editions to the course (EGS-32): writes the catalogs of the new languages and lists them in `pack.languages` (after the languages that are
   * there), in one step. Refused (nothing written) when the course would not be valid with them, a missing text included: an edition needs every key.
   * The catalog of the source language and of the target language is never touched.
   */
  addEditions(slug: string, editions: Record<string, { strings: Record<string, string>; accepted?: Record<string, string[]> }>): Promise<{ slug: string; languages: string[] }> {
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const langs = Object.keys(editions)
      const known = Array.isArray(pack.languages) ? (pack.languages as string[]) : []
      const reserved = [String(pack.sourceLang), ...(typeof pack.targetLang === 'string' ? [pack.targetLang] : [])]
      for (const l of langs) if (reserved.includes(l)) throw new Error(`"${l}" is the source or the target language of the course: it is not an edition to add`)
      const all: Record<string, Json> = { ...catalogs }
      for (const l of langs) {
        const e = editions[l]!
        const cat: Json = { schema: COURSE_SCHEMA_VERSION, lang: l, strings: e.strings, ...(e.accepted && Object.keys(e.accepted).length ? { accepted: e.accepted } : {}) }
        const parsed = textCatalogSchema.safeParse(cat)
        if (!parsed.success) throw new Error(`the text for "${l}" is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        all[l] = cat
      }
      const next: Json = { ...pack, languages: [...new Set([...known, ...langs])] }
      const problems = validateCourse(next, all).problems
      if (problems.length > 0) throw new Error(`the editions are not complete, nothing was written: ${fmt(problems)}`)
      await this.save(slug, next, all, { catalogs: langs })
      return { slug, languages: next.languages as string[] }
    })
  }

  /**
   * The vocabulary harvest (EGS-36, `harvest.ts`): adds one flashcard for each glossary entry of each reading, in one atomic write. Idempotent: run
   * again, it makes nothing new (the cards that exist are kept). Refused (nothing written) when it would make the pack invalid.
   */
  harvest(slug: string, opts: HarvestOptions = {}): Promise<HarvestResult & { slug: string }> {
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const before = this.check(pack, catalogs).blocking
      const result = harvestGlossary(pack, catalogs, opts)
      if (result.added.length === 0) return { slug, ...result }
      this.refuse('the harvest', before, this.check(pack, catalogs).blocking)
      const langs = [String(pack.sourceLang), ...(typeof pack.targetLang === 'string' ? [pack.targetLang] : [])]
      await this.save(slug, pack, catalogs, { catalogs: langs })
      return { slug, ...result }
    })
  }

  /**
   * Merges the media of the manifest into the pack on disk (`pack.assets`, the alt texts, the links of articles, items and shells: see
   * `media-link.ts`), in one atomic write. Refused (nothing written) when it would make the pack invalid. A build made before is stale after it.
   */
  mergeMedia(slug: string, merge: MediaMerge): Promise<MediaApplied & { slug: string }> {
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const before = this.check(pack, catalogs).blocking
      const lang = String(pack.sourceLang)
      const cat: Json = catalogs[lang] ?? { schema: 1, lang, strings: {} }
      if (!isObj(cat.strings)) cat.strings = {}
      const target = typeof pack.targetLang === 'string' && pack.targetLang !== lang ? pack.targetLang : undefined
      const targetCat: Json | undefined = target ? (catalogs[target] ?? { schema: 1, lang: target, strings: {} }) : undefined
      if (targetCat && !isObj(targetCat.strings)) targetCat.strings = {}
      const applied = applyMedia(pack, cat as { strings: Record<string, string> }, merge, target && targetCat ? { [target]: targetCat as { strings: Record<string, string> } } : {})
      const all = { ...catalogs, [lang]: cat, ...(target && targetCat ? { [target]: targetCat } : {}) }
      this.refuse('the media merge', before, this.check(pack, all).blocking)
      await this.save(slug, pack, all, { catalogs: [lang, ...(target ? [target] : [])] })
      return { slug, ...applied }
    })
  }

  // ---- create / import ----

  async create(input: CreateCourseInput): Promise<MutationResult & { dir: string }> {
    const slug = input.slug
    if (!PACK_SLUG.test(slug)) throw new Error(`invalid slug "${slug}": lower-case letters, digits and -`)
    return this.exclusive(slug, async () => {
      const root = this.root(slug)
      if (await exists(path.join(root, 'course', 'pack.json'))) throw new Error(`the course "${slug}" already exists`)
      if (!input.languages.includes(input.sourceLang)) throw new Error(`sourceLang "${input.sourceLang}" must be one of languages (${input.languages.join(', ')})`)
      if (input.cefr && !(CEFR_LEVELS as readonly string[]).includes(input.cefr)) throw new Error(`cefr must be one of ${CEFR_LEVELS.join(', ')}`)
      const pack: Json = {
        schema: COURSE_SCHEMA_VERSION,
        id: slug,
        slug,
        sourceLang: input.sourceLang,
        languages: input.languages,
        ...(input.targetLang ? { targetLang: input.targetLang } : {}),
        subject: input.subject,
        audience: input.audience,
        ...(input.cefr ? { cefr: input.cefr } : {}),
        matching: { diacritics: 'ignore', typos: true },
        units: [{ id: 'u1', title: 'unit.u1.title', requires: [] }],
        objectives: [{ id: 'u1-o1', unit: 'u1', bloom: 'remember', text: 'obj.u1-o1.text', facts: [] }],
        items: [],
        shells: { enabled: ['quiz-arena'], config: {} },
        assets: [],
        cues: [],
        encyclopedia: { articles: [] },
        factbase: [],
        extensions: {}
      }
      const catalogs: Record<string, Json> = {}
      for (const lang of new Set([...input.languages, ...(input.targetLang ? [input.targetLang] : [])])) {
        const edition = input.languages.includes(lang)
        catalogs[lang] = { schema: 1, lang, strings: edition ? { 'course.title': input.title, 'unit.u1.title': 'Unit 1', 'obj.u1-o1.text': 'Objective 1' } : {} }
      }
      const { blocking } = this.check(pack, catalogs)
      if (blocking.length > 0) throw new Error(`the course is not valid: ${fmt(blocking)}`)
      await this.save(slug, pack, catalogs)
      return { dir: root, ...this.result(slug, pack, catalogs) }
    })
  }

  /** Copies a course folder (`<folder>/course/pack.json`, or `<folder>/pack.json` for the `course/` folder itself) into `courses/<slug>/course`. */
  async importCourse(folder: string, o: { slug?: string; overwrite?: boolean } = {}): Promise<{ slug: string; dir: string; validation: { ok: boolean; problems: Problem[] } }> {
    const abs = path.resolve(folder)
    const src = (await exists(path.join(abs, 'course', 'pack.json'))) ? path.join(abs, 'course') : (await exists(path.join(abs, 'pack.json'))) ? abs : undefined
    if (!src) throw new Error(`"${folder}" is not a course folder: no course/pack.json or pack.json in it`)
    let packText: Json
    try {
      packText = JSON.parse((await fs.readFile(path.join(src, 'pack.json'), 'utf8')).replace(/^\uFEFF/, '')) as Json
    } catch (e) {
      throw new Error(`pack.json cannot be read: ${(e as Error).message}`, { cause: e })
    }
    const slug = o.slug ?? (typeof packText.slug === 'string' ? packText.slug : path.basename(abs))
    if (!PACK_SLUG.test(slug)) throw new Error(`invalid slug "${slug}": lower-case letters, digits and -`)
    return this.exclusive(slug, async () => {
      const dest = path.join(this.root(slug), 'course')
      if ((await exists(dest)) && !o.overwrite) throw new Error(`the course "${slug}" already exists (pass overwrite to replace its course/ folder)`)
      await fs.rm(dest, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.cp(src, dest, { recursive: true })
      if (packText.slug !== slug) await atomicWrite(path.join(dest, 'pack.json'), json({ ...packText, slug }))
      const v = await validateCourseFolder(this.root(slug))
      return { slug, dir: this.root(slug), validation: { ok: v.ok, problems: v.problems } }
    })
  }

  // ---- read ----

  async get(slug: string, o: { text?: boolean; lang?: string } = {}): Promise<{ slug: string; pack: Json; stats: CourseStats; build: BuildState; text?: Record<string, unknown> }> {
    const { pack, catalogs } = await this.load(slug)
    const text = o.lang ? { [o.lang]: catalogs[o.lang] ?? null } : o.text ? catalogs : undefined
    return { slug, pack, stats: this.stats(pack), build: await this.buildState(slug), ...(text ? { text } : {}) }
  }

  private stats(pack: Json): CourseStats {
    const items = Array.isArray(pack.items) ? (pack.items as Json[]) : []
    const byKind: Record<string, number> = {}
    for (const i of items) byKind[String(i.kind)] = (byKind[String(i.kind)] ?? 0) + 1
    return { units: Array.isArray(pack.units) ? pack.units.length : 0, objectives: Array.isArray(pack.objectives) ? pack.objectives.length : 0, items: items.length, byKind }
  }

  async buildState(slug: string): Promise<BuildState> {
    const file = path.join(this.buildDir(slug), GAME_DATA_FILE)
    const st = await fs.stat(file).catch(() => null)
    if (!st) return { built: false }
    let builtAt: string | undefined
    try {
      builtAt = (JSON.parse(await fs.readFile(file, 'utf8')) as { builtAt?: string }).builtAt
    } catch {
      // unreadable: the lint says so
    }
    let newest = 0
    const walk = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) await walk(p)
        else newest = Math.max(newest, (await fs.stat(p).catch(() => null))?.mtimeMs ?? 0)
      }
    }
    await walk(path.join(this.root(slug), 'course'))
    return { built: true, ...(builtAt ? { builtAt } : {}), stale: newest > st.mtimeMs }
  }

  /** A short view of a course for `edu_status`. */
  async summary(slug: string): Promise<{ stats: CourseStats; languages: unknown; build: BuildState } | null> {
    try {
      const { pack } = await this.load(slug)
      return { stats: this.stats(pack), languages: pack.languages, build: await this.buildState(slug) }
    } catch {
      return null
    }
  }

  // ---- edit ----

  /** Applies a JSON merge patch to the pack (`EDITABLE_PACK_FIELDS` only) and, with `text`, merges strings in the same write. */
  async edit(slug: string, patch: Json, text?: TextPatch): Promise<MutationResult> {
    const bad = Object.keys(patch).filter((k) => !(EDITABLE_PACK_FIELDS as readonly string[]).includes(k))
    if (bad.length > 0) throw new Error(`these fields cannot be edited here: ${bad.join(', ')} (editable: ${EDITABLE_PACK_FIELDS.join(', ')}; items have edu_item_add / edu_item_update / edu_item_remove)`)
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const next = mergePatch(pack, patch) as Json
      const merged = this.mergeText(next, catalogs, text)
      this.refuse('the edit', this.check(pack, catalogs).blocking, this.check(next, merged.catalogs).blocking)
      await this.save(slug, next, merged.catalogs, { catalogs: merged.touched })
      return this.result(slug, next, merged.catalogs)
    })
  }

  private async mutateItems(slug: string, what: string, change: (items: Json[], pack: Json) => { items: Json[]; index?: number }, text?: TextPatch): Promise<MutationResult & { item?: Json }> {
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const before = Array.isArray(pack.items) ? (pack.items as Json[]) : []
      const { items, index } = change(before, pack)
      const next: Json = { ...pack, items }
      const merged = this.mergeText(next, catalogs, text)
      this.refuse(what, this.check(pack, catalogs).blocking, this.check(next, merged.catalogs).blocking)
      await this.save(slug, next, merged.catalogs, { catalogs: merged.touched })
      const at = index === undefined ? undefined : `items[${index}]`
      return { ...this.result(slug, next, merged.catalogs, at ? (p) => p.path === at || p.path.startsWith(`${at}.`) || p.path.startsWith(`${at}[`) : undefined), ...(index === undefined ? {} : { item: items[index] }) }
    })
  }

  /** Parses an item with its kind's schema (defaults filled). */
  private parseItem(raw: unknown): Json {
    if (!isObj(raw)) throw new Error('an item is a JSON object')
    const kind = ITEM_KINDS.get(String(raw.kind))
    if (!kind) throw new Error(`unknown item kind "${String(raw.kind)}" (kinds: ${[...ITEM_KINDS.keys()].join(', ')})`)
    const parsed = kind.schema.safeParse(raw)
    if (!parsed.success) throw new Error(`the item is not a valid ${kind.kind}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(item)'}: ${i.message}`).join('; ')}`)
    return parsed.data as Json
  }

  async itemAdd(slug: string, raw: unknown, text?: TextPatch): Promise<MutationResult & { item?: Json }> {
    const item = this.parseItem(raw)
    return this.mutateItems(
      slug,
      'adding the item',
      (items) => {
        if (items.some((i) => i.id === item.id)) throw new Error(`an item "${String(item.id)}" exists already (edu_item_update changes it)`)
        return { items: [...items, item], index: items.length }
      },
      text
    )
  }

  /** Changes an item with a JSON merge patch (an array in the patch replaces the whole array). */
  async itemUpdate(slug: string, id: string, patch: Json, text?: TextPatch): Promise<MutationResult & { item?: Json }> {
    if ('id' in patch && patch.id !== id) throw new Error('the id of an item cannot change: remove it and add it again')
    return this.mutateItems(
      slug,
      'the update',
      (items) => {
        const index = items.findIndex((i) => i.id === id)
        if (index < 0) throw new Error(`no item "${id}"`)
        const item = this.parseItem(mergePatch(items[index], patch))
        return { items: items.map((x, i) => (i === index ? item : x)), index }
      },
      text
    )
  }

  async itemRemove(slug: string, id: string): Promise<MutationResult & { removed: string }> {
    const r = await this.mutateItems(slug, 'the removal', (items) => {
      if (!items.some((i) => i.id === id)) throw new Error(`no item "${id}"`)
      return { items: items.filter((i) => i.id !== id) }
    })
    return { slug: r.slug, pending: r.pending, pendingCount: r.pendingCount, removed: id }
  }

  /** Sets strings, accepted lists and removes keys in one language catalog. */
  async textSet(slug: string, lang: string, o: { strings?: Record<string, string>; accepted?: Record<string, string[]>; remove?: string[] }): Promise<MutationResult & { lang: string; strings: number; accepted: number; removed: number }> {
    return this.exclusive(slug, async () => {
      const { pack, catalogs } = await this.load(slug)
      const merged = this.mergeText(pack, catalogs, { [lang]: { strings: o.strings, accepted: o.accepted } })
      const cat = merged.catalogs[lang] as Json
      let removed = 0
      for (const key of o.remove ?? []) {
        const strings = cat.strings as Json
        const accepted = (cat.accepted ?? {}) as Json
        if (key in strings || key in accepted) removed++
        delete strings[key]
        delete accepted[key]
      }
      const parsed = textCatalogSchema.safeParse(cat)
      if (!parsed.success) throw new Error(`the text for "${lang}" is not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      await this.save(slug, pack, merged.catalogs, { catalogs: [lang] })
      return { ...this.result(slug, pack, merged.catalogs), lang, strings: Object.keys(o.strings ?? {}).length, accepted: Object.keys(o.accepted ?? {}).length, removed }
    })
  }

  // ---- validate / build / lint ----

  async validate(slug: string): Promise<{ slug: string; ok: boolean; problems: Problem[] }> {
    const root = this.root(slug)
    if (!(await exists(path.join(root, 'course', 'pack.json')))) throw new Error(`no course "${slug}"`)
    const v = await validateCourseFolder(root)
    return { slug, ok: v.ok, problems: v.problems }
  }

  /** Builds `courses/<slug>/build/`. Problems stop it unless `force`. */
  async build(slug: string, o: { force?: boolean } = {}): Promise<BuildResult & { slug: string }> {
    const root = this.root(slug)
    if (!(await exists(path.join(root, 'course', 'pack.json')))) throw new Error(`no course "${slug}"`)
    return this.exclusive(slug, async () => {
      const r = await buildCourse(root, undefined, { force: o.force, env: this.opts.env, playerDir: this.opts.playerDir })
      return { ...r, slug, data: undefined }
    })
  }

  /** Lints the build; builds first when there is none. `built` says the build was made for this call. */
  async lint(slug: string, o: { rebuild?: boolean } = {}): Promise<LintResult & { built: boolean; stale?: boolean; buildProblems?: Problem[] }> {
    const state = await this.buildState(slug)
    let built = false
    if (!state.built || o.rebuild) {
      const b = await this.build(slug)
      if (!b.ok) return { ...summarize(slug, [{ code: 'BUILD_FAILED', severity: 'error', path: '', message: `the course cannot be built: ${fmt(b.problems)}` }]), built: false, buildProblems: b.problems }
      built = true
    }
    const result = await lintGame(this.buildDir(slug))
    const after = await this.buildState(slug)
    return { ...result, built, ...(after.stale ? { stale: true } : {}) }
  }
}
