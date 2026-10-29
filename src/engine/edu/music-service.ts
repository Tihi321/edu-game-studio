import path from 'node:path'
import { languageInfo } from '../../shared/languages'
import { AUDIO_KINDS, FLOW_MUSIC_ENGINE, flowMusicAllowed } from '../../shared/media'
import type { AssetEntry, CourseMedia } from '../../shared/media'
import type { MusicPlanFile } from '../../shared/music'
import type { DesignData, Frame } from './authoring'
import { askRole } from './authoring'
import { checkMusicPlan, engineOfProvider, fallbackMusicLines, mergeMusicPlan, musicPlanSchema, musicPromptVars, resolveMusicEntries, trackProvider } from './music'
import type { MusicLine, MusicSource, SfxLine } from './music'
import { generateAll } from '../assets/generate'
import type { GenerateContext, GenerateAllResult } from '../assets/generate'
import type { AudioGenInfo } from '../assets/generate-audio'
import { flowOptionsOf } from '../assets/flow-image'
import { getEntry, loadManifest, replaceEntry, resolveFile } from '../assets/manifest'
import { writePlaceholder } from '../assets/placeholder'
import type { ChiptuneClient } from '../studios/chiptune'
import { StudioError } from '../studios/chiptune'
import { countFlowSongs } from '../studios/flow-music'
import type { JobContext } from '../queue/scheduler'
import { dataFolders } from './paths'
import { isDownError, withCircuit } from './media'
import type { GenerateJob, GenerateReport } from './media'
import type { EduService } from './service'

/**
 * Everything the app does with the music and the sound effects of a course (EGS-16): the composer's plan (`pipeline/music.json`, merged into the
 * asset manifest with stable ids), the generation with the providers (Chiptune Studio, ComfyUI ACE-Step, Flow Music only on an explicit opt-in)
 * with placeholders, and the source of what the composer is shown. The pipeline's `music_plan` and `music_generate` steps and the `edu_music_plan`
 * and `edu_asset_generate` tools share it. The merge into the pack (assets, cues, loop points) is `MediaService.mergeFor`.
 */

/** A Chiptune Studio client that, once one call found the studio down, answers every later call at once with the same error (one wait for the whole run). */
export function withChiptuneCircuit(client: ChiptuneClient, onDown: (message: string) => void): ChiptuneClient {
  let down: string | null = null
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (down) throw new StudioError(down, 'unreachable')
    try {
      return await fn()
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (!(e instanceof Error && e.name === 'AbortError') && ((e instanceof StudioError && e.kind === 'unreachable') || isDownError(m))) {
        down = m
        onDown(m)
      }
      throw e
    }
  }
  return {
    url: client.url,
    composeTrack: (a, s) => guard(() => client.composeTrack(a, s)),
    composeSfx: (a, s) => guard(() => client.composeSfx(a, s)),
    renderAudio: (a, s) => guard(() => client.renderAudio(a, s)),
    saveSong: (a, s) => guard(() => client.saveSong(a, s)),
    listSongs: (s) => guard(() => client.listSongs(s)),
    openSong: (a, s) => guard(() => client.openSong(a, s)),
    deleteSong: (a, s) => guard(() => client.deleteSong(a, s)),
    listTools: (s) => guard(() => client.listTools(s))
  }
}

export class MusicService {
  constructor(private readonly svc: EduService) {}

  private get media() {
    return this.svc.media
  }

  // ---- what the composer is shown ----

  private genreText(media: CourseMedia, ...parts: (string | undefined)[]): string {
    return [...parts, media.art.style === 'pixel' ? 'pixel retro' : ''].filter(Boolean).join(' ')
  }

  /** From the files of a pipeline run (before the assemble step writes the pack). */
  async sourceFromPipeline(slug: string): Promise<MusicSource> {
    const P = this.svc.pipeline
    const st = await P.requireSteps(slug)
    const R = st.resolved
    const media = await this.media.settings(slug)
    const plan = await P.readJson<{ title: string }>(slug, 'plan.json')
    const cur = await P.curriculum(slug)
    if (!cur) throw new Error('there is no curriculum yet')
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
      shells: [...new Set(['quiz-arena', ...R.brief.shells, ...(design?.enabled ?? []), ...(design?.requested ?? [])])],
      genreText: this.genreText(media, title, R.brief.topic, R.brief.audience, story?.frame?.premise)
    }
  }

  /** From the pack of a course on disk (a hand-made course, or a finished one). */
  async sourceFromPack(slug: string): Promise<MusicSource> {
    const got = await this.svc.courses.get(slug, { text: true })
    const pack = got.pack as Record<string, unknown>
    const catalogs = (got.text ?? {}) as Record<string, { strings?: Record<string, string> } | null>
    const lang = String(pack.sourceLang)
    const t = (key: unknown): string => (typeof key === 'string' ? (catalogs[lang]?.strings?.[key] ?? (pack.targetLang ? catalogs[String(pack.targetLang)]?.strings?.[key] : undefined) ?? key) : '')
    const media = await this.media.settings(slug)
    const shellsCfg = (pack.shells as { enabled?: string[]; config?: Record<string, unknown> } | undefined) ?? {}
    const title = t('course.title') === 'course.title' ? String(pack.subject) : t('course.title')
    return {
      title,
      subject: String(pack.subject),
      audience: String(pack.audience),
      language: languageInfo(lang)?.name ?? lang,
      units: (pack.units as { id: string; title: string; summary?: string }[]).map((u) => ({ id: u.id, title: t(u.title), ...(u.summary ? { summary: t(u.summary) } : {}) })),
      shells: [...new Set([...(shellsCfg.enabled ?? ['quiz-arena']), ...Object.keys(shellsCfg.config ?? {})])],
      genreText: this.genreText(media, title, String(pack.subject), String(pack.audience))
    }
  }

  // ---- the plan ----

  /**
   * Asks the composer for the plan (one repair round; a deterministic plan from the course text when the answer stays unusable), writes
   * `pipeline/music.json` and merges it into the manifest (stable ids keep their versions, prompts set by hand and locked assets).
   */
  async plan(ctx: JobContext, slug: string, src: MusicSource): Promise<{ plan: MusicPlanFile; added: string[]; kept: string[] }> {
    const media = await this.media.settings(slug)
    let lines: { music: MusicLine[]; sfx: SfxLine[] }
    let by: 'model' | 'fallback' = 'model'
    let note: string | undefined
    try {
      const { value } = await askRole(ctx, { dataDir: this.svc.dataDir, role: 'composer', task: 'plan', vars: musicPromptVars(src, media), schema: musicPlanSchema, check: (p) => checkMusicPlan(p, src), maxTokens: 8000 })
      lines = { music: value.music, sfx: value.sfx }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (ctx.signal.aborted || (e instanceof Error && (e.name === 'AbortError' || e.name === 'BudgetError')) || !/still has problems after a repair round|did not return valid JSON twice/.test(m)) throw e
      by = 'fallback'
      note = `the composer gave no usable answer (${m.split('\n')[0]!.slice(0, 200)}): the plan was made from the course text`
      ctx.log(`composer/plan: ${note}`)
      lines = fallbackMusicLines(src)
    }
    return this.writePlan(slug, src, lines, by, media, note)
  }

  /** The deterministic plan, with no model (`edu_music_plan {fallback: true}`, tests). */
  planFromText(slug: string, src: MusicSource, media: CourseMedia): Promise<{ plan: MusicPlanFile; added: string[]; kept: string[] }> {
    return this.writePlan(slug, src, fallbackMusicLines(src), 'fallback', media, 'made from the course text, with no model')
  }

  private async writePlan(slug: string, src: MusicSource, lines: { music: MusicLine[]; sfx: SfxLine[] }, by: 'model' | 'fallback', media: CourseMedia, note?: string): Promise<{ plan: MusicPlanFile; added: string[]; kept: string[] }> {
    const r = resolveMusicEntries(lines, src, { media, by })
    const plan: MusicPlanFile = { version: 1, source: by, ...(note ? { note } : {}), at: new Date().toISOString(), tracks: r.tracks, sfx: r.sfx, ...(r.warnings.length ? { warnings: r.warnings } : {}) }
    await this.svc.pipeline.writeJson(slug, 'music.json', plan)
    const before = new Set((await this.media.loadManifest(slug)).assets.map((a) => a.id))
    await this.media.mutate(slug, (m) => mergeMusicPlan(m, plan, media))
    const ids = [...r.tracks.map((t) => t.id), ...r.sfx.map((s) => s.id)]
    return { plan, added: ids.filter((i) => !before.has(i)), kept: ids.filter((i) => before.has(i)) }
  }

  // ---- making the sounds ----

  /**
   * Makes every track and sound effect of the plan that has no file yet (or those of `ids`, or all with `force`). Chiptune Studio makes the
   * sound effects and the music of RPG and castle areas (and of a pixel course), ComfyUI (ACE-Step) the other music, and Flow Music ONLY when the
   * course opted in (`music.provider: flow` and `music.flowCredits: true`), at most `flowMusicMaxSongs` songs: the tracks beyond the cap are made
   * by the default provider instead. The manifest is saved after each asset, so a stopped run resumes where it was. A provider that is down, or a
   * sound that fails, does not fail the run: the asset gets its silent placeholder and the report lists it.
   */
  async generate(slug: string, job: GenerateJob = {}): Promise<GenerateReport> {
    const media = await this.media.settings(slug)
    const report: GenerateReport = { generated: [], skipped: [], failed: [], placeholders: [], warnings: [] }
    if (!media.music.enabled) return report
    const dir = this.media.courseDir(slug)
    const plan = await this.media.readMusicPlan(slug)
    let manifest = await loadManifest(dir)
    const planned = plan ? new Set([...plan.tracks.map((t) => t.id), ...plan.sfx.map((s) => s.id)]) : null
    const wanted = job.ids ? new Set(job.ids) : null
    const inScope = (e: AssetEntry): boolean => AUDIO_KINDS.has(e.kind) && (!wanted || wanted.has(e.id)) && (!job.kind || e.kind === job.kind) && (!!job.ids || !planned || planned.has(e.id))
    if (!manifest.assets.some(inScope)) return report

    const studios = await this.svc.studios({ autoStart: true, log: job.log })
    const downs: string[] = []
    const chiptune = withChiptuneCircuit(studios.chiptune, (m) => downs.push(`Chiptune Studio: ${m}`))
    const comfy = withCircuit(await this.svc.comfy({ autoStart: true, log: job.log }), (m) => downs.push(`ComfyUI: ${m}`))
    const flowOptions = flowOptionsOf(studios.config)

    // Flow Music spends credits: only with the opt-in, and no more than the cap. A track that may not use it is made by the default provider.
    const allowed = flowMusicAllowed(media)
    let room = allowed ? Math.max(0, flowOptions.maxSongs - countFlowSongs(manifest.assets)) : 0
    for (const e of manifest.assets.filter((x) => inScope(x) && x.kind === 'music' && x.engine === FLOW_MUSIC_ENGINE && !resolveFile(dir, x))) {
      if (room > 0) {
        room--
        continue
      }
      const track = plan?.tracks.find((t) => t.id === e.id)
      const provider = trackProvider({ art: media.art, music: { ...media.music, provider: undefined } }, track?.areas ?? [])
      const engine = engineOfProvider(provider, media)
      await this.media.mutate(slug, (m) => replaceEntry(m, { ...(getEntry(m, e.id) ?? e), engine }))
      report.warnings.push({ id: e.id, warning: allowed ? `Flow Music cap reached (flowMusicMaxSongs ${flowOptions.maxSongs}): made with ${engine} instead` : `Flow Music is not allowed for this course (media.music.flowCredits is not true): made with ${engine} instead` })
    }
    manifest = await loadManifest(dir)

    const info = new Map<string, AudioGenInfo>()
    for (const t of plan?.tracks ?? []) info.set(t.id, { chip: { mood: t.mood, chip: t.chip, bpm: t.bpm, key: t.key, bars: t.bars }, prompt: t.prompt, seconds: t.seconds })
    for (const s of plan?.sfx ?? []) info.set(s.id, { sound: s.sound, prompt: s.prompt })
    const ctx: GenerateContext = {
      slug,
      settings: media,
      projectDir: dir,
      tmpRoot: path.join(this.svc.courses.root(slug), '.tmp'),
      comfy,
      chiptune,
      flow: studios.flow,
      flowOptions,
      flowSongs: { made: countFlowSongs(manifest.assets) },
      palettesDir: dataFolders(this.svc.dataDir).palettes,
      audioOf: (id) => info.get(id),
      signal: job.signal,
      onProgress: (e) => job.log?.(`${e.id}: ${e.stage} ${e.message}`)
    }
    const ids = manifest.assets.filter(inScope).map((e) => e.id)
    const res: GenerateAllResult = await generateAll(ctx, manifest, {
      ids,
      force: job.force,
      kinds: AUDIO_KINDS,
      commit: (entry) => this.media.mutate(slug, (m) => replaceEntry(m, entry)),
      onFailure: async (entry, error) => {
        if (resolveFile(dir, entry)) return entry // a regenerate that failed: the version it has stays
        return writePlaceholder(dir, entry, error)
      }
    })
    report.generated = res.generated
    report.skipped = res.skipped
    report.failed = res.failed
    if (downs.length) report.down = downs.join('; ')
    const after = await loadManifest(dir)
    report.placeholders = after.assets.filter((e) => res.failed.some((f) => f.id === e.id) && e.placeholder && !resolveFile(dir, e)).map((e) => e.id)
    for (const id of res.generated) for (const w of getEntry(after, id)?.versions.find((v) => v.n === getEntry(after, id)?.selected)?.warnings ?? []) report.warnings.push({ id, warning: w })
    return report
  }
}
