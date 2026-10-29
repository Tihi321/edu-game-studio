import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { languageInfo } from '../../shared/languages'
import { ART_NEGATIVE } from '../../shared/art'
import type { ArtPlanEntry, ArtPlanFile, ArtTarget } from '../../shared/art'
import { AUDIO_KINDS, FLOW_ENGINE, IMAGE_KINDS, parseCourseMedia } from '../../shared/media'
import { cuesOfPlan } from '../../shared/music'
import type { MusicPlanFile } from '../../shared/music'
import type { AssetEntry, AssetManifest, CourseMedia } from '../../shared/media'
import type { QualityConfig } from '../../shared/schemas'
import type { DesignData, Frame } from './authoring'
import { askRole } from './authoring'
import { artPlanSchema, artPromptVars, checkArtPlan, fallbackArtLines, resolveArtEntries } from './art'
import type { ArtItem, ArtLine, ArtSource } from './art'
import type { MediaLink, MediaMerge } from './media-link'
import { generateAll } from '../assets/generate'
import type { GenerateContext, GenerateAllResult, HotspotOverlay } from '../assets/generate'
import { flowOptionsOf } from '../assets/flow-image'
import { importAssetFile } from '../assets/import'
import { assetDir, getEntry, loadManifest, lock, pickVersion, replaceEntry, resolveFile, saveManifest, unlock } from '../assets/manifest'
import { dropPlaceholder, writePlaceholder } from '../assets/placeholder'
import type { ComfyClient } from '../comfy/client'
import { chatJson } from '../pipeline/llm'
import { buildMessages } from '../pipeline/prompts'
import type { ChatMessage } from '../models/types'
import type { JobContext } from '../queue/scheduler'
import { countsAsRevise, reviewSchemaFor, scoresExample } from '../review/scoring'
import type { ReviewResult } from '../review/scoring'
import { parseCourseMetaMedia } from './course-meta'
import { dataFolders } from './paths'
import { mergePatch } from './store'
import type { EduService } from './service'

/**
 * Everything the app does with the media of a course (EGS-15): the media settings (`course.md`, `media`), the asset manifest
 * (`courses/<slug>/course/assets.json`, the files in `course/assets/<id>/`), the art plan (`pipeline/art.json`), the generation of the images
 * with their placeholders, the art-critic's review rounds and the merge into the pack. The pipeline's art steps and the `edu_asset_*` tools share
 * it. EGS-16 and EGS-17 add the music and the voice to the same manifest.
 */

export interface GenerateJob {
  ids?: string[]
  /** Make the pictures again even when they have a version (locked and hand-made ones are never touched). */
  force?: boolean
  /** Only assets of this kind. */
  kind?: string
  /** Words added to the prompt of an asset for this run (the art-critic's notes). */
  extraPrompts?: Record<string, string>
  signal?: AbortSignal
  log?: (m: string) => void
}

export interface GenerateReport {
  generated: string[]
  skipped: string[]
  /** Pictures that could not be made: a placeholder stands in (or, when the asset had a version, that version stays). */
  failed: { id: string; error: string }[]
  placeholders: string[]
  /** Warnings of the versions made now (Pixel Studio was down, so the built-in pixelate ran ...). */
  warnings: { id: string; warning: string }[]
  /** The provider that was down, when one was. */
  down?: string
}

/** One asset as the tools show it. */
export interface AssetView {
  id: string
  kind: string
  /** What it illustrates (from the art plan), when known. */
  target?: ArtTarget
  selected: number | null
  versions: number
  file?: string
  source: 'generated' | 'custom'
  locked: boolean
  placeholder: boolean
  placeholderReason?: string
  review?: AssetEntry['review']
  prompt: string
  alt?: string
  engine: string
  provider?: string
  warnings?: string[]
  /** A sound: where it plays (`music:<area>` for each area of a track, the event of a sound effect), from the music plan. */
  plays?: string[]
  /** A track made by Chiptune Studio: where the loop starts and ends, in seconds (the player loops between them). */
  loop?: { startSec: number; endSec: number }
}

export interface MediaSummary {
  /** Pictures in the manifest. */
  images: number
  /** Pictures with a real file (a version or a hand-made file). */
  made: number
  /** Pictures that only have a placeholder: the lint warns `PLACEHOLDER_ASSET` for each. */
  placeholders: number
  /** Pictures the art-critic rejected (they stay in the course). */
  rejected: number
  /** Music tracks and sound effects in the manifest (EGS-16). */
  audio: number
  /** Sounds with a real file. */
  audioMade: number
  /** Sounds that only have a silent placeholder: the lint warns `PLACEHOLDER_ASSET` for each. */
  audioPlaceholders: number
}

const DOWN = /unreachable|every ComfyUI lane|ECONNREFUSED|connection refused|not running|fetch failed|ENOTFOUND/i
/** Whether a failure says that the provider is not there (not that one picture went wrong). */
export const isDownError = (message: string): boolean => DOWN.test(message)

/** A ComfyUI client that, once one call found ComfyUI down, answers every later call at once with the same error (one wait for the whole run). */
export function withCircuit(comfy: ComfyClient, onDown: (message: string) => void): ComfyClient {
  let down: string | null = null
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (down) throw new Error(down)
    try {
      return await fn()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (isDownError(m) && !(e instanceof Error && e.name === 'AbortError')) {
        down = m
        onDown(m)
      }
      throw e
    }
  }
  return { generate: (req) => guard(() => comfy.generate(req)), removeBackground: (img, o) => guard(() => comfy.removeBackground(img, o)) }
}

const rel = (id: string, file: string): string => `assets/${id}/${file}`

export class MediaService {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly svc: EduService) {}

  private get dataDir(): string {
    return this.svc.dataDir
  }

  /** `courses/<slug>/course`: the folder the manifest and the asset files live in. */
  courseDir(slug: string): string {
    return path.join(this.svc.courses.root(slug), 'course')
  }

  // ---- the settings ----

  /** The media settings of a course (`course.md` `media`, with the defaults). A course with no `course.md` has the defaults. */
  async settings(slug: string): Promise<CourseMedia> {
    return parseCourseMetaMedia(await this.svc.getCourseMeta(slug))
  }

  /** Sets media settings with a JSON merge patch (an object merges, `null` removes a key) and returns the settings after it. Refuses a patch that makes them invalid. */
  async setSettings(slug: string, patch: Record<string, unknown>): Promise<{ media: CourseMedia; stored: Record<string, unknown> }> {
    if (!(await this.svc.courseExists(slug))) throw new Error(`no course "${slug}"`)
    const old = ((await this.svc.getCourseMeta(slug))?.data as { media?: unknown } | undefined)?.media ?? {}
    const stored = mergePatch(old, patch) as Record<string, unknown>
    const media = parseCourseMedia(stored) // refuses an invalid setting before anything is written
    await this.svc.setCourseMeta(slug, { media: Object.keys(stored).length ? stored : null })
    return { media, stored }
  }

  // ---- the manifest ----

  loadManifest(slug: string): Promise<AssetManifest> {
    return loadManifest(this.courseDir(slug))
  }

  /** Reads the manifest, changes it with `fn` and saves it, one writer at a time per course. */
  mutate(slug: string, fn: (m: AssetManifest) => AssetManifest | Promise<AssetManifest>): Promise<AssetManifest> {
    const prev = this.locks.get(slug) ?? Promise.resolve()
    const next = prev.then(async () => {
      const m = await fn(await this.loadManifest(slug))
      await saveManifest(this.courseDir(slug), m)
      return m
    })
    this.locks.set(slug, next.catch(() => undefined))
    return next
  }

  readPlan(slug: string): Promise<ArtPlanFile | undefined> {
    return this.svc.pipeline.readJson<ArtPlanFile>(slug, 'art.json')
  }

  /** The composer's plan (`pipeline/music.json`), when there is one. */
  readMusicPlan(slug: string): Promise<MusicPlanFile | undefined> {
    return this.svc.pipeline.readJson<MusicPlanFile>(slug, 'music.json')
  }

  /** The assets of a course for the tools: their files, versions, placeholders and review. */
  async list(slug: string, o: { kind?: string } = {}): Promise<AssetView[]> {
    const manifest = await this.loadManifest(slug)
    const plan = await this.readPlan(slug)
    const targets = new Map((plan?.entries ?? []).map((e) => [e.id, e.target]))
    const music = await this.readMusicPlan(slug)
    const plays = new Map<string, string[]>([...(music?.tracks ?? []).map((t) => [t.id, t.areas.map((a) => `music:${a}`)] as [string, string[]]), ...(music?.sfx ?? []).map((x) => [x.id, [x.event]] as [string, string[]])])
    const dir = this.courseDir(slug)
    return manifest.assets
      .filter((e) => !o.kind || e.kind === o.kind)
      .map((e) => {
        const file = resolveFile(dir, e)
        const v = e.versions.find((x) => x.n === e.selected)
        return {
          id: e.id,
          kind: e.kind,
          ...(targets.has(e.id) ? { target: targets.get(e.id) } : {}),
          ...(plays.has(e.id) ? { plays: plays.get(e.id) } : {}),
          selected: e.selected,
          versions: e.versions.length,
          ...(file ? { file: rel(e.id, path.basename(file)) } : e.placeholder ? { file: rel(e.id, e.placeholder.file) } : {}),
          source: e.source,
          locked: e.locked,
          placeholder: !file && !!e.placeholder,
          ...(!file && e.placeholder ? { placeholderReason: e.placeholder.reason } : {}),
          ...(e.review ? { review: e.review } : {}),
          prompt: e.prompt,
          ...(e.alt ? { alt: e.alt } : {}),
          engine: e.engine,
          ...(e.provider ? { provider: e.provider } : {}),
          ...(v?.warnings?.length ? { warnings: v.warnings } : {}),
          ...(AUDIO_KINDS.has(e.kind) && v && v.loopStartSec != null && v.loopEndSec != null && v.loopEndSec > v.loopStartSec ? { loop: { startSec: v.loopStartSec, endSec: v.loopEndSec } } : {})
        }
      })
  }

  async summary(slug: string): Promise<MediaSummary> {
    const manifest = await this.loadManifest(slug)
    const dir = this.courseDir(slug)
    const images = manifest.assets.filter((e) => IMAGE_KINDS.has(e.kind))
    const made = images.filter((e) => resolveFile(dir, e)).length
    const sounds = manifest.assets.filter((e) => AUDIO_KINDS.has(e.kind))
    return {
      images: images.length,
      made,
      placeholders: images.filter((e) => !resolveFile(dir, e) && e.placeholder).length,
      rejected: images.filter((e) => e.review?.status === 'rejected').length,
      audio: sounds.length,
      audioMade: sounds.filter((e) => resolveFile(dir, e)).length,
      audioPlaceholders: sounds.filter((e) => !resolveFile(dir, e) && e.placeholder).length
    }
  }

  // ---- the art plan ----

  /** What the art-director is shown, from the files of a pipeline run (before the assemble step writes the pack). */
  async artSourceFromPipeline(slug: string): Promise<ArtSource> {
    const P = this.svc.pipeline
    const st = await P.requireSteps(slug)
    const R = st.resolved
    const plan = await P.readJson<{ title: string }>(slug, 'plan.json')
    const cur = await P.curriculum(slug)
    if (!cur) throw new Error('there is no curriculum yet')
    const articles = (await Promise.all(cur.units.map((u) => P.articles(slug, u.id)))).flat()
    const unitOfObjective = new Map(cur.objectives.map((o) => [o.id, o.unit]))
    const items: ArtItem[] = (await Promise.all(cur.units.map((u) => P.items(slug, u.id)))).flat().map((i) => ({ id: i.id, kind: i.kind, unit: unitOfObjective.get(i.objective), prompt: i.prompt, hasPicture: false }))
    const design = await P.readJson<DesignData>(slug, 'design.json')
    const story = await P.readJson<{ frame?: Frame }>(slug, 'story.json')
    const title = plan?.title ?? R.brief.topic
    return {
      title,
      subject: R.brief.topic,
      audience: R.brief.audience,
      ...(R.brief.age !== undefined ? { age: String(R.brief.age) } : {}),
      language: languageInfo(R.brief.sourceLang)?.name ?? R.brief.sourceLang,
      units: cur.units.map((u) => ({ id: u.id, title: u.title, summary: u.summary })),
      articles: articles.map((a) => ({ id: a.id, unit: a.unit, title: a.title, body: a.body })),
      items,
      shells: [...new Set(['quiz-arena', ...R.brief.shells, ...(design?.enabled ?? []), ...(design?.requested ?? [])])],
      characters: story?.frame?.characters ?? []
    }
  }

  /** What the art-director is shown, from the pack of a course on disk (a hand-made course, or a finished one). */
  async artSourceFromPack(slug: string): Promise<ArtSource> {
    const got = await this.svc.courses.get(slug, { text: true })
    const pack = got.pack as Record<string, unknown>
    const catalogs = (got.text ?? {}) as Record<string, { strings?: Record<string, string> } | null>
    const lang = String(pack.sourceLang)
    const t = (key: unknown): string => (typeof key === 'string' ? (catalogs[lang]?.strings?.[key] ?? (pack.targetLang ? catalogs[String(pack.targetLang)]?.strings?.[key] : undefined) ?? key) : '')
    const dir = this.courseDir(slug)
    const manifest = await this.loadManifest(slug)
    const assets = new Map(((pack.assets as { id: string; file: string }[] | undefined) ?? []).map((a) => [a.id, a]))
    /** A real picture: the pack names the asset, its file is there, and it is neither a placeholder file nor a placeholder of the manifest. */
    const real = (id: unknown): boolean => {
      if (typeof id !== 'string') return false
      const a = assets.get(id)
      if (!a || /placeholder/i.test(a.file)) return false
      if (getEntry(manifest, id)?.placeholder && !resolveFile(dir, getEntry(manifest, id)!)) return false
      return existsSync(path.join(dir, ...a.file.split('/')))
    }
    const units = (pack.units as { id: string; title: string; summary?: string }[]).map((u) => ({ id: u.id, title: t(u.title), ...(u.summary ? { summary: t(u.summary) } : {}) }))
    const unitOf = new Map(((pack.objectives as { id: string; unit: string }[]) ?? []).map((o) => [o.id, o.unit]))
    const rawItems = (pack.items as Record<string, unknown>[]) ?? []
    const items: ArtItem[] = rawItems.map((i) => ({
      id: String(i.id),
      kind: String(i.kind),
      unit: unitOf.get(String(i.objective)),
      prompt: t(i.prompt),
      hasPicture: real(i.asset),
      ...(i.kind === 'hotspot' ? { asset: String(i.asset), width: Number(i.width), height: Number(i.height), regions: (i.regions as { id: string; shape: never }[]) ?? [] } : {})
    }))
    const enc = (pack.encyclopedia as { articles?: Record<string, unknown>[] } | undefined)?.articles ?? []
    const shellsCfg = (pack.shells as { enabled?: string[]; config?: Record<string, unknown> } | undefined) ?? {}
    const story = (pack.extensions as { story?: { characters?: { name: string; role: string; description: string }[] } } | undefined)?.story
    return {
      title: t('course.title') === 'course.title' ? String(pack.subject) : t('course.title'),
      subject: String(pack.subject),
      audience: String(pack.audience),
      language: languageInfo(lang)?.name ?? lang,
      units,
      articles: enc.map((a) => ({ id: String(a.id), unit: typeof a.unit === 'string' ? a.unit : undefined, title: t(a.title), body: t(a.body), hasPicture: real(a.asset) })),
      items,
      shells: [...new Set([...(shellsCfg.enabled ?? ['quiz-arena']), ...Object.keys(shellsCfg.config ?? {})])],
      characters: (story?.characters ?? []).map((c) => ({ name: t(c.name), role: t(c.role), description: t(c.description) }))
    }
  }

  /**
   * Asks the art-director for the plan (one repair round; a deterministic plan from the course text when the answer stays unusable), writes
   * `pipeline/art.json` and merges the plan into the manifest (stable ids keep their versions, prompts set by hand and locked assets).
   */
  async planArt(ctx: JobContext, slug: string, src: ArtSource): Promise<{ plan: ArtPlanFile; added: string[]; kept: string[] }> {
    const media = await this.settings(slug)
    let lines: ArtLine[]
    let by: 'model' | 'fallback' = 'model'
    let note: string | undefined
    try {
      const { value } = await askRole(ctx, { dataDir: this.dataDir, role: 'art-director', task: 'plan', vars: artPromptVars(src, media), schema: artPlanSchema, check: (p) => checkArtPlan(p, src), maxTokens: 12_000 })
      lines = value.images
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (ctx.signal.aborted || (e instanceof Error && (e.name === 'AbortError' || e.name === 'BudgetError')) || !/still has problems after a repair round|did not return valid JSON twice/.test(m)) throw e
      by = 'fallback'
      note = `the art-director gave no usable answer (${m.split('\n')[0]!.slice(0, 200)}): the plan was made from the course text`
      ctx.log(`art-director/plan: ${note}`)
      lines = fallbackArtLines(src)
    }
    return this.writePlan(slug, src, lines, by, media, note)
  }

  /** The deterministic plan, with no model (`edu_asset_plan` without an art-director, tests). */
  planFromText(slug: string, src: ArtSource, media: CourseMedia): Promise<{ plan: ArtPlanFile; added: string[]; kept: string[] }> {
    return this.writePlan(slug, src, fallbackArtLines(src), 'fallback', media, 'made from the course text, with no model')
  }

  private async writePlan(slug: string, src: ArtSource, lines: ArtLine[], by: 'model' | 'fallback', media: CourseMedia, note?: string): Promise<{ plan: ArtPlanFile; added: string[]; kept: string[] }> {
    const entries = resolveArtEntries(lines, src, { media, by })
    const plan: ArtPlanFile = { version: 1, source: by, ...(note ? { note } : {}), style: media.art.style, at: new Date().toISOString(), entries }
    await this.svc.pipeline.writeJson(slug, 'art.json', plan)
    const before = new Set((await this.loadManifest(slug)).assets.map((a) => a.id))
    await this.mutate(slug, (m) => mergePlan(m, entries, media))
    return { plan, added: entries.filter((e) => !before.has(e.id)).map((e) => e.id), kept: entries.filter((e) => before.has(e.id)).map((e) => e.id) }
  }

  // ---- making the images ----

  /** The overlays of the hotspot items of the pack on disk, by the asset they name. */
  private async hotspots(slug: string): Promise<Map<string, HotspotOverlay>> {
    const out = new Map<string, HotspotOverlay>()
    try {
      const { pack } = await this.svc.courses.get(slug)
      for (const i of ((pack as { items?: Record<string, unknown>[] }).items ?? []).filter((x) => x.kind === 'hotspot')) {
        out.set(String(i.asset), { width: Number(i.width), height: Number(i.height), regions: ((i.regions as { shape: never }[]) ?? []).map((r) => ({ shape: r.shape })) })
      }
    } catch {
      /* no pack yet (a pipeline run before the assemble step): no hotspot to draw */
    }
    return out
  }

  /**
   * Makes every picture of the manifest that has no file yet (or those of `ids`, or all with `force`), through the providers of the course: ComfyUI
   * (the default), Google Flow only when the course says `art.provider: flow`, Pixel Studio for the pixel art of the RPG tiles and sprites. The
   * manifest is saved after each asset, so a stopped run resumes where it was. A provider that is down, or a picture that fails, does not fail the
   * run: the asset gets its placeholder (see `placeholder.ts`) and the report lists it. ComfyUI and the studios are started first when
   * `config/autostart.md` allows it.
   */
  async generate(slug: string, job: GenerateJob = {}): Promise<GenerateReport> {
    const media = await this.settings(slug)
    const report: GenerateReport = { generated: [], skipped: [], failed: [], placeholders: [], warnings: [] }
    if (!media.art.enabled) return report
    const dir = this.courseDir(slug)
    const manifest = await this.loadManifest(slug)
    const plan = await this.readPlan(slug)
    const planned = new Set((plan?.entries ?? []).map((e) => e.id))
    const hot = await this.hotspots(slug)
    const studios = await this.svc.studios({ autoStart: true, log: job.log })
    const comfy = withCircuit(await this.svc.comfy({ autoStart: true, log: job.log }), (m) => {
      report.down = m
    })
    const ctx: GenerateContext = {
      slug,
      settings: media,
      projectDir: dir,
      tmpRoot: path.join(this.svc.courses.root(slug), '.tmp'),
      comfy,
      pixel: studios.pixel,
      flow: studios.flow,
      flowOptions: flowOptionsOf(studios.config),
      palettesDir: dataFolders(this.dataDir).palettes,
      hotspotOf: (id) => hot.get(id) ?? null,
      ratioOf: (id) => {
        const s = getEntry(manifest, id)?.size
        return s && s.w === s.h ? '1:1' : undefined
      },
      signal: job.signal,
      onProgress: (e) => job.log?.(`${e.id}: ${e.stage} ${e.message}`)
    }
    const wanted = job.ids ? new Set(job.ids) : null
    const ids = manifest.assets.filter((e) => IMAGE_KINDS.has(e.kind) && (!wanted || wanted.has(e.id)) && (!job.kind || e.kind === job.kind)).map((e) => e.id)
    const exclude = job.ids || planned.size === 0 ? [] : manifest.assets.filter((e) => !planned.has(e.id)).map((e) => e.id)
    const res: GenerateAllResult = await generateAll(ctx, manifest, {
      ids,
      force: job.force,
      exclude,
      extraPrompts: job.extraPrompts,
      commit: (entry) => this.mutate(slug, (m) => replaceEntry(m, entry)),
      onFailure: async (entry, error) => {
        if (resolveFile(dir, entry)) return entry // a regenerate that failed: the version it has stays
        return writePlaceholder(dir, entry, error)
      }
    })
    report.generated = res.generated
    report.skipped = res.skipped
    report.failed = res.failed
    const after = await this.loadManifest(slug)
    report.placeholders = after.assets.filter((e) => res.failed.some((f) => f.id === e.id) && e.placeholder && !resolveFile(dir, e)).map((e) => e.id)
    for (const id of res.generated) for (const w of getEntry(after, id)?.versions.find((v) => v.n === getEntry(after, id)?.selected)?.warnings ?? []) report.warnings.push({ id, warning: w })
    return report
  }

  // ---- the art-critic ----

  /** Whether the art-critic can run for a course: the course asks for it and a model with vision is available. `reason` says why not. */
  async criticAvailable(slug: string): Promise<{ ok: boolean; reason?: string }> {
    const media = await this.settings(slug)
    if (!media.art.review) return { ok: false, reason: 'media.art.review is false' }
    const models = this.svc.deps.router.candidates('art-critic', { visionOnly: true, projectModel: this.svc.courseModel(slug, 'art-critic') })
    if (models.length === 0) return { ok: false, reason: 'no model with vision is available for the art-critic (set vision: true on a model in config/providers.md, or use client/claude-code); the images were not reviewed' }
    return { ok: true }
  }

  /** What the course is about, for the art-critic: the run's plan title, else the pack's subject, else the slug. */
  private async courseTitle(slug: string): Promise<string> {
    const plan = await this.svc.pipeline.readJson<{ title?: string }>(slug, 'plan.json')
    if (plan?.title) return plan.title
    const got = await this.svc.courses.get(slug).catch(() => null)
    return String((got?.pack as { subject?: unknown } | undefined)?.subject ?? slug)
  }

  /** The text that says what a picture is for (the art-critic compares the picture to it). */
  private describe(e: ArtPlanEntry | undefined, a: AssetEntry): string {
    const t = e?.target
    if (!t) return a.alt ?? a.id
    switch (t.type) {
      case 'article':
        return `the picture of the encyclopedia article ${t.article}`
      case 'item':
        return `the ${t.side === 'back' ? 'back ' : ''}picture of the item ${t.item}`
      case 'hotspot':
        return `the picture of the hotspot item ${t.item} (clickable places will be drawn over it)`
      case 'shell':
        return `the art "${t.slot}" of the shell ${t.shell}`
    }
  }

  /**
   * One review round: the art-critic looks at every picture whose selected version it has not seen, against its plan line, and answers
   * `{verdict, scores, notes, problems}`. A `revise` (counted by `countsAsRevise`: the critic is not a must-pass reviewer) sends the picture to a new
   * round with its notes; after the last round it stays with `review.status: rejected` and the note. Hand-made, locked and placeholder
   * assets are not reviewed. Writes `pipeline/reviews/art_review-k<round>.json`.
   */
  async reviewRound(ctx: JobContext, slug: string, round: number, q: QualityConfig): Promise<{ reviewed: number; approved: number; revise: { id: string; note: string }[]; rejected: string[] }> {
    const dir = this.courseDir(slug)
    const plan = await this.readPlan(slug)
    const byId = new Map((plan?.entries ?? []).map((e) => [e.id, e]))
    const manifest = await this.loadManifest(slug)
    const media = await this.settings(slug)
    const title = await this.courseTitle(slug)
    const results: Record<string, unknown>[] = []
    const revise: { id: string; note: string }[] = []
    const rejected: string[] = []
    let approved = 0
    const last = round >= q.max_rounds
    for (const entry of manifest.assets) {
      if (!IMAGE_KINDS.has(entry.kind) || entry.locked || entry.source === 'custom') continue
      const file = resolveFile(dir, entry)
      if (!file) continue
      const seen = entry.review?.version === entry.selected
      if (seen) {
        // looked at already: a picture still waiting for a new version (its regeneration failed) is out of rounds at the last one
        if (entry.review?.status === 'pending' && last) {
          rejected.push(entry.id)
          await this.mutate(slug, (m) => replaceEntry(m, { ...entry, review: { ...entry.review!, status: 'rejected' } }))
        }
        continue
      }
      if (ctx.signal.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      const e = byId.get(entry.id)
      const jpeg = await sharp(file).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
      const { messages } = await buildMessages(this.dataDir, ctx, 'art-critic', 'review', {
        title,
        asset_id: entry.id,
        kind: entry.kind,
        target: this.describe(e, entry),
        prompt: e?.prompt ?? entry.prompt,
        alt: entry.alt ?? '',
        style: entry.style ?? media.art.style,
        round,
        scores_example: scoresExample('art-critic')
      })
      const user = messages[messages.length - 1]!
      const withImage: ChatMessage[] = [...messages.slice(0, -1), { role: 'user', content: [{ type: 'text', text: typeof user.content === 'string' ? user.content : '' }, { type: 'image', mime: 'image/jpeg', data: jpeg.toString('base64') }] }]
      const { value } = await chatJson(ctx, withImage, reviewSchemaFor('art-critic'), { maxTokens: 1500, temperature: 0.2 })
      const review: ReviewResult = { role: 'art-critic', verdict: value.verdict, scores: value.scores as Record<string, number>, notes: value.notes, problems: value.problems }
      const sends = countsAsRevise(review, q)
      const note = [review.notes, ...review.problems.map((p) => `${p.issue}${p.fix ? ` (${p.fix})` : ''}`)].filter(Boolean).join(' ').slice(0, 600)
      let status: 'approved' | 'pending' | 'rejected' = 'approved'
      if (sends) {
        if (last) {
          status = 'rejected'
          rejected.push(entry.id)
        } else {
          status = 'pending'
          revise.push({ id: entry.id, note: note || 'the picture does not match what it should show' })
        }
      } else approved++
      await this.mutate(slug, (m) => replaceEntry(m, { ...(getEntry(m, entry.id) ?? entry), review: { status, ...(note ? { note } : {}), version: entry.selected ?? undefined, rounds: round } }))
      results.push({ id: entry.id, version: entry.selected, verdict: review.verdict, scores: review.scores, notes: review.notes, problems: review.problems, status })
    }
    await this.svc.pipeline.writeJson(slug, `reviews/art_review-k${round}.json`, { round, results, revise, rejected })
    return { reviewed: results.length, approved, revise, rejected }
  }

  // ---- merging into the pack ----

  /** The assets of the manifest as the pack needs them, with what each illustrates. */
  async mergeFor(slug: string): Promise<MediaMerge> {
    const manifest = await this.loadManifest(slug)
    const plan = await this.readPlan(slug)
    const dir = this.courseDir(slug)
    const musicOn = (await this.settings(slug)).music.enabled
    const music = await this.readMusicPlan(slug)
    /** With a music plan only its sounds are linked (an asset the plan dropped stays in the manifest, not in the build); with none, every audio asset that has a file. */
    const planned = music ? new Set([...music.tracks.map((t) => t.id), ...music.sfx.map((x) => x.id)]) : null
    const assets: MediaLink[] = []
    const loops: Record<string, { startSec: number; endSec: number }> = {}
    for (const e of manifest.assets) {
      if (AUDIO_KINDS.has(e.kind)) {
        if (!musicOn || (planned && !planned.has(e.id))) continue // music switched off: no sound is linked (and the cues of an earlier plan go)
        const file = resolveFile(dir, e)
        const name = file ? path.basename(file) : e.placeholder && existsSync(path.join(assetDir(dir, e.id), e.placeholder.file)) ? e.placeholder.file : undefined
        if (!name) continue
        assets.push({ id: e.id, kind: 'audio', file: rel(e.id, name), alt: e.alt ?? e.id, ...(file ? {} : { placeholder: true }) })
        const v = e.versions.find((x) => x.n === e.selected)
        if (file && e.source === 'generated' && v && v.loopStartSec != null && v.loopEndSec != null && v.loopEndSec > v.loopStartSec) loops[e.id] = { startSec: v.loopStartSec, endSec: v.loopEndSec }
        continue
      }
      if (!IMAGE_KINDS.has(e.kind)) continue
      const file = resolveFile(dir, e)
      const name = file ? path.basename(file) : e.placeholder && existsSync(path.join(assetDir(dir, e.id), e.placeholder.file)) ? e.placeholder.file : undefined
      if (!name) continue
      assets.push({ id: e.id, kind: 'image', file: rel(e.id, name), alt: e.alt ?? plan?.entries.find((p) => p.id === e.id)?.alt ?? e.id, ...(file ? {} : { placeholder: true }) })
    }
    const targets: Record<string, ArtTarget> = {}
    for (const p of plan?.entries ?? []) targets[p.id] = p.target
    const linked = new Set(assets.map((a) => a.id))
    const hasAudio = assets.some((a) => a.kind === 'audio')
    return { assets, targets, ...(music ? { cues: cuesOfPlan(music, (id) => linked.has(id)) } : {}), ...(music || hasAudio ? { loops } : {}) }
  }

  /** Re-links the pack on disk to the manifest (after the tools changed it). Null when the course has no pack yet. */
  async relink(slug: string): Promise<{ assets: number; links: number; cues?: number } | null> {
    if (!existsSync(path.join(this.courseDir(slug), 'pack.json'))) return null
    return this.svc.courses.mergeMedia(slug, await this.mergeFor(slug))
  }

  // ---- jobs of the tools ----

  /**
   * Queues a job of the media tools (`asset_plan`, `asset_generate`). Its id is `<slug>--<task>--q<time>--r0` (not a step of a run, so it works on a
   * hand-made course too); `params` are in the job file. Returns the job id.
   */
  async queue(slug: string, task: 'asset_plan' | 'asset_generate' | 'asset_music_plan', role: string, params: Record<string, unknown>, label: string): Promise<string> {
    if (!(await this.svc.courseExists(slug))) throw new Error(`no course "${slug}"`)
    const id = `${slug}--${task}--q${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}--r0`
    await this.svc.deps.jobs.enqueue({ id, task, role, book: slug, requested_by: 'you', priority: 1, label, params } as never, `Media job ${task} for the course ${slug}.\n`)
    this.svc.deps.kick?.()
    return id
  }

  // ---- the manual edits of the tools ----

  private async entry(slug: string, id: string): Promise<AssetEntry> {
    const e = getEntry(await this.loadManifest(slug), id)
    if (!e) throw new Error(`no asset "${id}" in the manifest of "${slug}" (edu_asset_list shows them)`)
    return e
  }

  /** `edu_asset_set`: the prompt, the negative prompt, the provider or the engine of one asset. A prompt set by hand is kept by the art-director. */
  async setAsset(slug: string, id: string, o: { prompt?: string; negative?: string; provider?: 'comfy' | 'flow'; engine?: string }): Promise<AssetEntry> {
    const current = await this.entry(slug, id)
    if (o.provider !== undefined && AUDIO_KINDS.has(current.kind)) throw new Error(`${id} is a sound: the music provider is media.music.provider (edu_media_settings), then edu_music_plan and edu_asset_generate`)
    let out!: AssetEntry
    await this.mutate(slug, (m) => {
      const e = getEntry(m, id)!
      out = {
        ...e,
        ...(o.prompt !== undefined ? { prompt: o.prompt, promptByHand: true } : {}),
        ...(o.negative !== undefined ? { negative: o.negative } : {}),
        ...(o.provider !== undefined ? { provider: o.provider, engine: o.provider === 'flow' ? FLOW_ENGINE : e.engine === FLOW_ENGINE ? parseCourseMedia(undefined).art.generator : e.engine } : {}),
        ...(o.engine !== undefined ? { engine: o.engine } : {})
      }
      return replaceEntry(m, out)
    })
    return out
  }

  /** `edu_asset_select`: makes an earlier version the one the course uses. */
  async selectVersion(slug: string, id: string, version: number): Promise<AssetEntry> {
    let out!: AssetEntry
    await this.entry(slug, id)
    await this.mutate(slug, async (m) => {
      out = pickVersion(getEntry(m, id)!, version)
      out = await dropPlaceholder(this.courseDir(slug), out)
      return replaceEntry(m, out)
    })
    return out
  }

  /** `edu_asset_replace`: a file made by hand becomes the asset (`source: custom`, locked). */
  async replaceFile(slug: string, id: string, file: string): Promise<AssetEntry> {
    const dir = this.courseDir(slug)
    let out!: AssetEntry
    await this.entry(slug, id)
    await this.mutate(slug, async (m) => {
      out = await importAssetFile(dir, getEntry(m, id)!, path.resolve(file))
      return replaceEntry(m, out)
    })
    return out
  }

  /** `edu_asset_lock`. */
  async setLocked(slug: string, id: string, locked: boolean): Promise<AssetEntry> {
    let out!: AssetEntry
    await this.entry(slug, id)
    await this.mutate(slug, (m) => {
      const e = getEntry(m, id)!
      out = locked ? lock(e) : unlock(e)
      return replaceEntry(m, out)
    })
    return out
  }
}

/**
 * The manifest after a plan: an asset the plan names keeps its versions, selection, lock and review, and (when it has versions, was locked or its
 * prompt was set by hand) its prompt, engine and size; its kind, alt text, style and final size follow the plan. A new asset is added; an asset the
 * plan no longer names stays (nothing is deleted).
 */
export function mergePlan(manifest: AssetManifest, entries: readonly ArtPlanEntry[], media: Pick<CourseMedia, 'art'>): AssetManifest {
  let m = manifest
  for (const p of entries) {
    const derived: AssetEntry = {
      id: p.id,
      kind: p.kind,
      prompt: p.prompt,
      negative: ART_NEGATIVE,
      engine: p.provider === 'flow' ? FLOW_ENGINE : media.art.generator,
      seed: null,
      size: p.size,
      fit: p.fit,
      alt: p.alt,
      style: p.style,
      versions: [],
      selected: null,
      source: 'generated',
      locked: false
    }
    const old = getEntry(m, p.id)
    if (!old) {
      m = replaceEntry(m, derived)
      continue
    }
    const keep = old.promptByHand === true || old.locked || old.source === 'custom' || old.versions.length > 0
    m = replaceEntry(m, { ...old, kind: p.kind, alt: p.alt, style: p.style, fit: p.fit, ...(keep ? {} : { prompt: p.prompt, engine: derived.engine, size: p.size }) })
  }
  return m
}