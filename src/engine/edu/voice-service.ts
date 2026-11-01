import { existsSync } from 'node:fs'
import path from 'node:path'
import { languageInfo } from '../../shared/languages'
import { VOICE_KIND, parseCourseMedia, voiceEnabled } from '../../shared/media'
import type { CourseMedia } from '../../shared/media'
import { shortenForSpeech, voiceClipId } from '../../shared/voice'
import type { VoiceAllocationEntry, VoicePlanFile } from '../../shared/voice'
import { getEntry, replaceEntry, resolveFile } from '../assets/manifest'
import { importAssetFile } from '../assets/import'
import { dropPlaceholder } from '../assets/placeholder'
import { allocateVoice, voiceReads } from '../voice/allocate'
import { loadVoiceConfig } from '../voice/config'
import type { VoiceConfig } from '../voice/config'
import { DEFAULT_GEMINI_DAILY_LIMIT, DEFAULT_GEMINI_RESET_TZ, GeminiQuota } from '../voice/quota'
import type { QuotaView } from '../voice/quota'
import { baseEntry, clipHash, effectiveVoice, runVoice } from '../voice/run'
import type { VoiceRunReport } from '../voice/run'
import { resolveTts } from '../voice/speak'
import type { JobContext } from '../queue/scheduler'
import { askRole } from './authoring'
import { buildVoicePlan, checkVoicePlan, fallbackVoiceLines, limitsOf, mergeVoicePlan, textOfKey, voicePlanSchema, voicePromptVars, buildVoiceSource } from './voice'
import type { VoiceLine, VoiceSource } from './voice'
import { dataFolders } from './paths'
import { isDownError, withCircuit } from './media'
import type { EduService } from './service'

/**
 * Everything the app does with the voice of a course (EGS-17): the voice-director's plan (`pipeline/voice.json`: the clips, the listening items derived
 * from taught phrases, how each language is spoken), the generation across the providers by the hub's allocation rule (`voice/allocate.ts`) with the
 * hash index in the asset manifest, hand-made clips, the Gemini quota and the status. The pipeline's `voice_plan` and `voice_generate` steps and the
 * `edu_voice_*` tools share it. The merge into the pack (assets, `listening.asset`, derived items, narration) is `MediaService.mergeFor`.
 */

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

export interface VoiceGenerateJob {
  lang?: string
  ids?: string[]
  force?: boolean
  signal?: AbortSignal
  log?: (m: string) => void
}

export interface VoiceGenerateResult extends VoiceRunReport {
  /** The Gemini quota after the run. */
  quota: QuotaView
  /** The pack was re-linked to the clips. */
  linked: boolean
}

export class VoiceService {
  private quotaOf?: { key: string; quota: GeminiQuota }

  constructor(private readonly svc: EduService) {}

  private get media() {
    return this.svc.media
  }

  // ---- settings, the quota ----

  config(): Promise<VoiceConfig> {
    return loadVoiceConfig(this.svc.dataDir)
  }

  /** The Gemini counter of this data folder (one instance per limit and time zone, so two jobs never lose a count). */
  async quota(): Promise<GeminiQuota> {
    const c = await this.config().catch(() => null)
    const limit = c?.geminiDailyLimit ?? DEFAULT_GEMINI_DAILY_LIMIT
    const tz = c?.geminiResetTz ?? DEFAULT_GEMINI_RESET_TZ
    const key = `${limit}|${tz}`
    if (this.quotaOf?.key !== key) this.quotaOf = { key, quota: new GeminiQuota(this.svc.dataDir, { limit, tz, now: this.svc.deps.voiceRuntime?.now }) }
    return this.quotaOf.quota
  }

  async quotaView(): Promise<QuotaView> {
    return (await this.quota()).read()
  }

  async resetQuota(): Promise<QuotaView> {
    return (await this.quota()).reset()
  }

  /** Whether the voice step runs for a course (`media.voice.enabled`, else for a language course). */
  async enabled(slug: string): Promise<{ enabled: boolean; media: CourseMedia; language: boolean }> {
    const media = await this.media.settings(slug)
    const language = !!(await this.targetLang(slug))
    return { enabled: voiceEnabled(media, language), media, language }
  }

  private async targetLang(slug: string): Promise<string | undefined> {
    const st = await this.svc.pipeline.readSteps(slug)
    if (st) return st.resolved.brief.targetLang
    try {
      const { pack } = await this.svc.courses.get(slug)
      const t = (pack as { targetLang?: unknown }).targetLang
      return typeof t === 'string' ? t : undefined
    } catch {
      return undefined
    }
  }

  readPlan(slug: string): Promise<VoicePlanFile | undefined> {
    return this.svc.pipeline.readJson<VoicePlanFile>(slug, 'voice.json')
  }

  // ---- what the voice-director is shown ----

  /** The pack and the catalogs of the course on disk (after the assemble step, so the final text), as the source of the plan. */
  async source(slug: string): Promise<{ src: VoiceSource; pack: Record<string, unknown> }> {
    const got = await this.svc.courses.get(slug, { text: true })
    const pack = got.pack as Record<string, unknown>
    const catalogs = (got.text ?? {}) as VoiceSource['catalogs']
    const dir = this.media.courseDir(slug)
    const manifest = await this.media.loadManifest(slug)
    const assets = new Map(((pack.assets as { id: string; file: string }[] | undefined) ?? []).map((a) => [a.id, a]))
    /** A real recording of the course's own: in the pack, not a placeholder, not one of our clips, and the file is there. */
    const real = (id: string): boolean => {
      const a = assets.get(id)
      if (!a || /placeholder/i.test(a.file) || id.startsWith('voice-') || getEntry(manifest, id)?.kind === VOICE_KIND) return false
      return existsSync(path.join(dir, ...a.file.split('/')))
    }
    const lang = String(pack.sourceLang)
    const title = textOfKey(catalogs, lang, 'course.title') ?? String(pack.subject)
    const st = await this.svc.pipeline.readSteps(slug)
    const target = typeof pack.targetLang === 'string' ? pack.targetLang : undefined
    const src = buildVoiceSource(pack, catalogs, {
      title,
      languageName: (c) => languageInfo(c)?.name ?? c,
      ...(target ? { targetLanguageName: languageInfo(target)?.name ?? target } : {}),
      kids: st?.resolved.kids ?? false,
      real
    })
    return { src, pack }
  }

  // ---- the plan ----

  /**
   * Asks the voice-director for the plan (one repair round; a deterministic plan from the course text when the answer stays unusable), writes
   * `pipeline/voice.json` and merges the clips into the asset manifest (stable ids keep their versions and hashes).
   */
  async plan(ctx: JobContext, slug: string): Promise<{ plan: VoicePlanFile; added: string[]; kept: string[] }> {
    const media = await this.media.settings(slug)
    const { src } = await this.source(slug)
    const limits = limitsOf(media, !!src.targetLang)
    let lines: VoiceLine
    let by: 'model' | 'fallback' = 'model'
    let note: string | undefined
    try {
      const { value } = await askRole(ctx, { dataDir: this.svc.dataDir, role: 'voice-director', task: 'plan', vars: voicePromptVars(src, media), schema: voicePlanSchema, check: (p) => checkVoicePlan(p, src, limits), maxTokens: 6000 })
      lines = value
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (ctx.signal.aborted || (e instanceof Error && (e.name === 'AbortError' || e.name === 'BudgetError')) || !/still has problems after a repair round|did not return valid JSON twice/.test(m)) throw e
      by = 'fallback'
      note = `the voice-director gave no usable answer (${m.split('\n')[0]!.slice(0, 200)}): the plan was made from the course text`
      ctx.log(`voice-director/plan: ${note}`)
      lines = fallbackVoiceLines(src, limits)
    }
    return this.writePlan(slug, src, lines, by, media, note)
  }

  /** The deterministic plan, with no model (`edu_voice_plan {fallback: true}`, and what `edu_voice_generate` makes when there is no plan yet). */
  async planFromText(slug: string): Promise<{ plan: VoicePlanFile; added: string[]; kept: string[] }> {
    const media = await this.media.settings(slug)
    const { src } = await this.source(slug)
    return this.writePlan(slug, src, fallbackVoiceLines(src, limitsOf(media, !!src.targetLang)), 'fallback', media, 'made from the course text, with no model')
  }

  private async writePlan(slug: string, src: VoiceSource, lines: VoiceLine, by: 'model' | 'fallback', media: CourseMedia, note?: string): Promise<{ plan: VoicePlanFile; added: string[]; kept: string[] }> {
    const config = await this.config()
    const old = await this.readPlan(slug)
    const plan: VoicePlanFile = { ...buildVoicePlan(lines, src, { media, by, ...(note ? { note } : {}), maxChars: config.narrationMaxChars }), ...(old?.allocation ? { allocation: old.allocation } : {}) }
    await this.svc.pipeline.writeJson(slug, 'voice.json', plan)
    const before = new Set((await this.media.loadManifest(slug)).assets.map((a) => a.id))
    await this.media.mutate(slug, (m) => mergeVoicePlan(m, plan))
    const ids = plan.clips.map((c) => c.id)
    return { plan, added: ids.filter((i) => !before.has(i)), kept: ids.filter((i) => before.has(i)) }
  }

  // ---- making the clips ----

  /**
   * Speaks every clip of the plan whose hash index entry is out of date, across the providers by the hub's allocation rule (see `voice/allocate.ts`):
   * Google's free Gemini voices while the day's quota lasts (Croatian first), else VibeTTS, else ComfyUI TTS; a provider that is down gives its clips
   * to the next one; what nothing can speak becomes a silent placeholder (the lint warns). With no plan yet the deterministic plan is made first.
   * The manifest is saved after every clip, so a stopped run resumes where it was; a second run speaks nothing. Afterwards the pack is re-linked.
   */
  async generate(slug: string, job: VoiceGenerateJob = {}): Promise<VoiceGenerateResult> {
    const e = await this.enabled(slug)
    const quota = await this.quota()
    if (!e.enabled) return { allocation: {}, made: [], kept: [], keptImported: [], failed: [], placeholders: [], warnings: ['the voice step is off for this course (media.voice.enabled is false)'], quota: await quota.read(), linked: false }
    let plan = await this.readPlan(slug)
    if (!plan) plan = (await this.planFromText(slug)).plan
    const config = await this.config()
    const got = await this.svc.courses.get(slug, { text: true })
    const catalogs = (got.text ?? {}) as VoiceSource['catalogs']
    const studios = await this.svc.studios({ autoStart: true, log: job.log })
    const downs: string[] = []
    const comfy = withCircuit(await this.svc.comfy({ autoStart: true, log: job.log }), (m) => downs.push(`ComfyUI: ${m}`))
    const rt = this.svc.deps.voiceRuntime
    const report = await runVoice({
      slug,
      courseDir: this.media.courseDir(slug),
      tmpDir: path.join(this.svc.courses.root(slug), '.tmp', 'voice'),
      workflowDirs: dataFolders(this.svc.dataDir).workflows,
      media: e.media,
      config,
      plan,
      textOf: (clip) => {
        const t = textOfKey(catalogs, clip.lang, clip.key)
        if (t === undefined) return clip.text
        return clip.role === 'narration' ? shortenForSpeech(t, config.narrationMaxChars) : t
      },
      loadManifest: () => this.media.loadManifest(slug),
      mutate: (fn) => this.media.mutate(slug, fn),
      flow: studios.flow,
      vibetts: studios.vibetts,
      comfy,
      quota,
      sleep: rt?.sleep ?? realSleep,
      flowPauseMs: studios.config.flowVoicePauseMs,
      flowRetries: studios.config.flowVoiceRetries,
      isDown: isDownError,
      lang: job.lang,
      ids: job.ids,
      force: job.force,
      signal: job.signal,
      log: (m) => job.log?.(m)
    })
    for (const d of downs) if (!report.warnings.some((w) => w.includes(d))) report.warnings.push(d)
    if (Object.keys(report.allocation).length) {
      const fresh = (await this.readPlan(slug)) ?? plan
      await this.svc.pipeline.writeJson(slug, 'voice.json', { ...fresh, allocation: { ...(fresh.allocation ?? {}), ...report.allocation } })
    }
    const linked = !!(await this.media.relink(slug))
    return { ...report, quota: await quota.read(), linked }
  }

  // ---- a clip made by hand ----

  /**
   * `edu_voice_import`: a file you recorded (or made elsewhere) becomes the clip of `key` in `lang`: copied as it is, the clip is locked and marked
   * imported, so generation keeps it (`status` counts those whose text changed since). The clip must be in the plan (`edu_voice_plan`).
   */
  async importClip(slug: string, o: { lang: string; key: string; file: string }): Promise<{ id: string; file: string; stale: boolean }> {
    const plan = await this.readPlan(slug)
    if (!plan) throw new Error(`the course "${slug}" has no voice plan yet: run edu_voice_plan {slug} first`)
    const id = voiceClipId(o.lang, o.key)
    const clip = plan.clips.find((c) => c.id === id)
    if (!clip) throw new Error(`no clip "${id}" in the voice plan: the clips are ${plan.clips.slice(0, 10).map((c) => `${c.lang}/${c.key}`).join(', ')}${plan.clips.length > 10 ? ' ...' : ''}`)
    const got = await this.svc.courses.get(slug, { text: true })
    const text = textOfKey((got.text ?? {}) as VoiceSource['catalogs'], clip.lang, clip.key) ?? clip.text
    const dir = this.media.courseDir(slug)
    let out = ''
    await this.media.mutate(slug, async (m) => {
      const base = getEntry(m, id) ?? baseEntry(clip)
      const imported = await importAssetFile(dir, base, path.resolve(o.file))
      const e = await dropPlaceholder(dir, { ...imported, voice: { lang: clip.lang, key: clip.key, role: clip.role, text, hash: `import:${text.length}`, provider: 'import', imported: true } })
      out = path.basename(resolveFile(dir, e) ?? e.customFile ?? '')
      return replaceEntry(m, e)
    })
    await this.media.relink(slug)
    return { id, file: `assets/${id}/${out}`, stale: false }
  }

  // ---- looking ----

  /** The Gemini and VibeTTS side of `edu_voice_status`: who is reachable, the voices, the quota. Never throws. */
  async providers(): Promise<Record<string, unknown>> {
    const studios = await this.svc.studios()
    const quota = await this.quotaView()
    const gemini: Record<string, unknown> = { quota }
    try {
      const st = await studios.flow.status()
      gemini.up = st.up && st.signedIn !== false
      if (!gemini.up) gemini.error = st.hint ?? (st.up ? 'Google Flow is not signed in' : 'flow-music-mcp is not running')
      else {
        const v = await studios.flow.voices()
        gemini.ready = v.geminiReady
        gemini.voices = v.gemini.map((g) => `gemini:${g.name}`)
        if (!v.geminiReady) gemini.error = 'no Google AI Studio key is set up in flow-music-mcp'
      }
    } catch (e) {
      gemini.up = false
      gemini.error = (e as Error).message
    }
    const vibetts: Record<string, unknown> = { url: studios.vibetts.url }
    try {
      const v = await studios.vibetts.listVoices()
      Object.assign(vibetts, {
        up: true,
        voices: v.voices.map((x) => ({ id: x.id, label: x.label, engine: x.engine, languages: x.languages })),
        languages: v.languages,
        readsDe: v.voices.some((x) => voiceReads(x, 'de')),
        languageVoices: v.languageVoices,
        readLanguage: v.readLanguage,
        supertonicInstalled: v.supertonicInstalled,
        higgsInstalled: v.higgsInstalled
      })
    } catch (e) {
      Object.assign(vibetts, { up: false, error: (e as Error).message })
    }
    // German (EGS-33): who reads it. Gemini is never used for German by the rule in practice (10 requests a day), so only the local providers count here.
    let comfyDe: boolean
    try {
      comfyDe = 'engine' in (await resolveTts(dataFolders(this.svc.dataDir).workflows, parseCourseMedia({}), 'de'))
    } catch {
      comfyDe = false
    }
    const readsDe = { vibetts: vibetts.readsDe === true, comfy: comfyDe }
    const warnings = readsDe.vibetts || readsDe.comfy ? [] : ['no local provider reads German (de): German listening clips become silent placeholders; install the Supertonic or Higgs voices in VibeTTS']
    return { gemini, vibetts, comfy: { readsDe: comfyDe }, readsDe, ...(warnings.length ? { warnings } : {}) }
  }

  /** The voice of one course: the plan, the clips (how many are made, placeholders, imported) and the allocation (the last run's, and what it would be now). */
  async courseStatus(slug: string): Promise<Record<string, unknown>> {
    const e = await this.enabled(slug)
    const plan = await this.readPlan(slug)
    const manifest = await this.media.loadManifest(slug)
    const dir = this.media.courseDir(slug)
    const clips = (plan?.clips ?? []).map((c) => {
      const entry = getEntry(manifest, c.id)
      const file = entry ? resolveFile(dir, entry) : null
      return { id: c.id, lang: c.lang, key: c.key, role: c.role, state: !entry ? 'planned' : entry.voice?.imported && file ? 'imported' : file ? 'made' : entry.placeholder ? 'placeholder' : 'planned', ...(entry?.voice?.provider ? { provider: entry.voice.provider } : {}), ...(entry?.versions.length ? { versions: entry.versions.length } : {}) }
    })
    const count = (s: string): number => clips.filter((c) => c.state === s).length
    return {
      enabled: e.enabled,
      provider: e.media.voice.provider,
      ...(plan ? { plan: { source: plan.source, at: plan.at, clips: plan.clips.length, listening: plan.clips.filter((c) => c.role === 'listening').length, narration: plan.clips.filter((c) => c.role === 'narration').length, derivedItems: plan.derived.map((d) => d.id), voices: plan.voices, ...(plan.warnings?.length ? { warnings: plan.warnings } : {}) } } : { plan: null }),
      clips: { total: clips.length, made: count('made'), imported: count('imported'), placeholders: count('placeholder'), planned: count('planned') },
      ...(plan?.allocation ? { allocation: plan.allocation as Record<string, VoiceAllocationEntry> } : {}),
      detail: clips
    }
  }

  /** What the allocation would be right now for a course (the clips that need speaking, the providers and the quota): a dry run, nothing is spoken. */
  async preview(slug: string): Promise<{ allocation: Record<string, VoiceAllocationEntry>; need: Record<string, number> }> {
    const e = await this.enabled(slug)
    const plan = await this.readPlan(slug)
    if (!plan) return { allocation: {}, need: {} }
    const config = await this.config()
    const manifest = await this.media.loadManifest(slug)
    const dir = this.media.courseDir(slug)
    const got = await this.svc.courses.get(slug, { text: true })
    const catalogs = (got.text ?? {}) as VoiceSource['catalogs']
    const need: Record<string, number> = {}
    for (const c of plan.clips) {
      const t = (() => {
        const x = textOfKey(catalogs, c.lang, c.key)
        return x === undefined ? c.text : c.role === 'narration' ? shortenForSpeech(x, config.narrationMaxChars) : x
      })()
      const eff = effectiveVoice(e.media, plan, c.lang)
      const hash = clipHash({ text: t.trim(), lang: c.lang, gemini: eff.gemini, vibetts: eff.vibetts, style: eff.style, speed: config.speed, format: config.format })
      const entry = getEntry(manifest, c.id)
      const file = entry ? resolveFile(dir, entry) : null
      if ((entry?.voice?.imported || entry?.locked) && file) continue
      if (entry?.voice?.hash === hash && file) continue
      need[c.lang] = (need[c.lang] ?? 0) + 1
    }
    const studios = await this.svc.studios()
    const prov = await this.providers()
    const geminiUp = (prov.gemini as { up?: boolean; ready?: boolean }).up === true && (prov.gemini as { ready?: boolean }).ready !== false
    let vibe = null as Awaited<ReturnType<typeof studios.vibetts.listVoices>> | null
    try {
      vibe = await studios.vibetts.listVoices()
    } catch {
      vibe = null
    }
    const engines = new Set<string>()
    for (const lang of Object.keys(need)) if ('engine' in (await resolveTts(dataFolders(this.svc.dataDir).workflows, e.media, lang))) engines.add(lang)
    const q = await this.quotaView()
    const allocation = allocateVoice({
      need,
      provider: e.media.voice.provider,
      quota: { limit: q.limit, used: q.used },
      avail: { gemini: { up: geminiUp }, vibetts: { up: !!vibe, reads: (l) => !!vibe?.voices.some((v) => voiceReads(v, l)) }, comfy: { up: true, reads: (l) => engines.has(l) } }
    })
    return { allocation, need }
  }
}
