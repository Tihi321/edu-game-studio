import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetDir, getEntry, loadManifest, resolveFile, saveManifest } from '../src/engine/assets/manifest'
import { mergeVoicePlan } from '../src/engine/edu/voice'
import { isDownError } from '../src/engine/edu/media'
import { runVoice } from '../src/engine/voice/run'
import type { VoiceRunInput, VoiceRunReport } from '../src/engine/voice/run'
import { voiceConfigSchema } from '../src/engine/voice/config'
import { GeminiQuota } from '../src/engine/voice/quota'
import { QUOTA_MIN_MS, parseRetryDelayMs } from '../src/engine/voice/speak'
import { FlowError } from '../src/engine/studios/flow'
import type { NarrateArgs } from '../src/engine/studios/flow'
import { createVibeTtsClient, parseVibeVoices } from '../src/engine/studios/vibetts'
import { StudioError } from '../src/engine/studios/chiptune'
import { parseCourseMedia } from '../src/shared/media'
import type { AssetManifest } from '../src/shared/media'
import type { VoiceClipPlan, VoicePlanFile } from '../src/shared/voice'
import { voiceClipId } from '../src/shared/voice'
import { FakeComfy } from './edu-helpers'
import { FakeFlow } from './flow-fakes'
import { FakeVibeTts, fakeMcpServer, studioResult } from './studio-fakes'

/**
 * Generating the clips of a voice plan (EGS-17) with fakes only: Gemini (the flow fake's `flow_narrate`, counted against the day's quota), VibeTTS (a fake
 * client whose batch writes real wavs) and ComfyUI TTS (the ComfyUI fake): the hash index, the quota, the fall-backs, the placeholders.
 */

const TEXTS: Record<string, Record<string, string>> = {
  hr: { 't.dobar-dan': 'Dobar dan', 't.hvala': 'Hvala lijepa', 't.molim': 'Molim vas' },
  en: { 'unit.u1.summary': 'The first unit teaches greetings.', 'unit.u2.summary': 'The second unit teaches thanks.' }
}
const clip = (lang: string, key: string, role: VoiceClipPlan['role'] = lang === 'hr' ? 'listening' : 'narration'): VoiceClipPlan => ({ id: voiceClipId(lang, key), lang, key, role, text: TEXTS[lang]![key]!, alt: `Audio ${key}` })
const HR = Object.keys(TEXTS.hr!).map((k) => clip('hr', k))
const EN = Object.keys(TEXTS.en!).map((k) => clip('en', k))
const PLAN: VoicePlanFile = { version: 1, source: 'model', at: '2026-10-30T10:00:00Z', sourceLang: 'en', targetLang: 'hr', voices: { hr: { style: 'clear and slow' }, en: { style: 'warm' } }, clips: [...HR, ...EN], derived: [] }

/** A flow fake whose Gemini answers `ok` requests, then a daily-quota error (a 429 with a long retry delay). */
class QuotaFlow extends FakeFlow {
  constructor(private ok: number) {
    super()
  }
  async narrate(a: NarrateArgs) {
    if (this.ok-- <= 0) throw new FlowError('Gemini TTS rate limited (HTTP 429): Quota exceeded for the free tier. Please retry in 20h5m30s', 'rateLimit')
    return super.narrate(a)
  }
}

interface Harness {
  dir: string
  courseDir: string
  flow: FakeFlow
  vibetts: FakeVibeTts
  comfy: FakeComfy
  quota: GeminiQuota
  texts: Record<string, Record<string, string>>
  run(o?: Partial<VoiceRunInput> & { provider?: 'auto' | 'gemini' | 'vibetts' | 'comfy'; plan?: VoicePlanFile }): Promise<VoiceRunReport>
  manifest(): Promise<AssetManifest>
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'edu-voice-gen-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function harness(o: { flow?: FakeFlow; used?: number } = {}): Promise<Harness> {
  const courseDir = path.join(dir, 'course')
  const flow = o.flow ?? new FakeFlow()
  const vibetts = new FakeVibeTts()
  const comfy = new FakeComfy()
  const quota = new GeminiQuota(path.join(dir, 'data'), { limit: 10, tz: 'America/Los_Angeles', now: () => new Date('2026-10-30T12:00:00Z') })
  if (o.used) await quota.add(o.used)
  await saveManifest(courseDir, mergeVoicePlan({ assets: [] }, PLAN))
  const texts = structuredClone(TEXTS)
  const h: Harness = {
    dir,
    courseDir,
    flow,
    vibetts,
    comfy,
    quota,
    texts,
    manifest: () => loadManifest(courseDir),
    async run(opts = {}) {
      const { provider, plan, ...rest } = opts
      let chain: Promise<unknown> = Promise.resolve()
      return runVoice({
        slug: 'demo',
        courseDir,
        tmpDir: path.join(dir, 'tmp'),
        workflowDirs: [],
        media: parseCourseMedia({ voice: { provider: provider ?? 'auto' } }),
        config: voiceConfigSchema.parse({}),
        plan: plan ?? PLAN,
        textOf: (c) => texts[c.lang]?.[c.key] ?? c.text,
        loadManifest: () => loadManifest(courseDir),
        mutate: async (fn) => {
          const next = chain.then(async () => {
            const m = await fn(await loadManifest(courseDir))
            await saveManifest(courseDir, m)
            return m
          })
          chain = next.catch(() => undefined)
          return next
        },
        flow,
        vibetts,
        comfy,
        quota,
        sleep: async () => undefined,
        flowPauseMs: 0,
        flowRetries: 1,
        isDown: isDownError,
        log: () => undefined,
        ...rest
      })
    }
  }
  return h
}

const narrates = (f: FakeFlow) => f.calls.filter((c) => c.tool === 'flow_narrate')

describe('Gemini within the quota', () => {
  it('speaks every clip through flow_narrate (engine gemini, never the paid one), counts each request, and records the hash and the provider', async () => {
    const h = await harness()
    const r = await h.run()
    expect(r.made.sort()).toEqual([...HR, ...EN].map((c) => c.id).sort())
    expect(r.placeholders).toEqual([])
    expect(r.allocation.hr).toMatchObject({ provider: 'gemini', need: 3, made: { gemini: 3 } })
    expect(r.allocation.en).toMatchObject({ provider: 'gemini', need: 2, made: { gemini: 2 } })
    expect(narrates(h.flow)).toHaveLength(5)
    expect(h.flow.spoken.every((s) => s.engine === 'gemini' && /^[A-Z]/.test(s.voice))).toBe(true)
    expect(h.flow.spoken.find((s) => s.text === 'Dobar dan')).toMatchObject({ voice: 'Kore', style: 'clear and slow' })
    expect(h.vibetts.calls.filter((c) => c.tool === 'synthesize_batch')).toEqual([])
    expect(await h.quota.read()).toMatchObject({ used: 5, remaining: 5 })

    const m = await h.manifest()
    for (const c of [...HR, ...EN]) {
      const e = getEntry(m, c.id)!
      expect(e, c.id).toMatchObject({ kind: 'voice', selected: 1, voice: { lang: c.lang, key: c.key, text: TEXTS[c.lang]![c.key], provider: 'gemini', hash: expect.stringMatching(/^[0-9a-f]{40}$/) } })
      expect(resolveFile(h.courseDir, e), c.id).toMatch(/v1\.wav$/) // the bytes are sniffed: a wav whatever the extension asked for
      expect((await readFile(resolveFile(h.courseDir, e)!)).subarray(0, 4).toString()).toBe('RIFF')
    }
  })
})

describe('the hash index', () => {
  it('a second run speaks nothing (and counts no request); changing one text speaks exactly that clip, as a new version', async () => {
    const h = await harness()
    await h.run()
    expect(narrates(h.flow)).toHaveLength(5)
    const before = await h.manifest()

    const again = await h.run()
    expect(again.made).toEqual([])
    expect(again.kept).toHaveLength(5)
    expect(again.allocation).toEqual({}) // nothing to allocate
    expect(narrates(h.flow)).toHaveLength(5)
    expect((await h.quota.read()).used).toBe(5)
    expect(await h.manifest()).toEqual(before)

    h.texts.hr!['t.hvala'] = 'Hvala puno'
    const changed = await h.run()
    expect(changed.made).toEqual([voiceClipId('hr', 't.hvala')])
    expect(changed.kept).toHaveLength(4)
    expect(narrates(h.flow)).toHaveLength(6)
    expect(h.flow.spoken.at(-1)).toMatchObject({ text: 'Hvala puno' })
    expect((await h.quota.read()).used).toBe(6)
    const e = getEntry(await h.manifest(), voiceClipId('hr', 't.hvala'))!
    expect(e.versions.map((v) => v.n)).toEqual([1, 2]) // the old version stays
    expect(e).toMatchObject({ selected: 2, voice: { text: 'Hvala puno' } })
    expect(existsSync(path.join(assetDir(h.courseDir, e.id), 'v1.wav'))).toBe(true)
    expect(existsSync(path.join(assetDir(h.courseDir, e.id), 'v2.wav'))).toBe(true)
  })

  it('a changed style or voice is a new hash; the provider that made the clip does not matter; force speaks again; a locked or imported clip is kept', async () => {
    const h = await harness()
    await h.run({ provider: 'vibetts' }) // made by VibeTTS
    const n = h.vibetts.spoken.length
    expect(n).toBe(5)
    const same = await h.run() // auto: Gemini would speak, but nothing changed: the hash does not know the provider
    expect(same.made).toEqual([])
    expect(narrates(h.flow)).toHaveLength(0)

    const style = await h.run({ plan: { ...PLAN, voices: { ...PLAN.voices, hr: { style: 'fast and cheerful' } } } })
    expect(style.made.sort()).toEqual(HR.map((c) => c.id).sort()) // only Croatian changed
    const forced = await h.run({ force: true, lang: 'en' })
    expect(forced.made.sort()).toEqual(EN.map((c) => c.id).sort())

    // a locked clip is never made again, even with force
    const m = await h.manifest()
    const id = HR[0]!.id
    await saveManifest(h.courseDir, { assets: m.assets.map((a) => (a.id === id ? { ...a, locked: true } : a)) })
    const locked = await h.run({ force: true, lang: 'hr' })
    expect(locked.made).not.toContain(id)
    expect(locked.kept).toContain(id)
  })
})

describe('the quota and the fall-backs', () => {
  it('hr and en over what is left: Croatian on Gemini, English on VibeTTS (a language is never split)', async () => {
    const h = await harness({ used: 6 }) // 4 left: hr 3 fits, en 2 does not
    const r = await h.run()
    expect(r.allocation.hr).toMatchObject({ provider: 'gemini', made: { gemini: 3 } })
    expect(r.allocation.en).toMatchObject({ provider: 'vibetts', made: { vibetts: 2 } })
    expect(h.flow.spoken.map((s) => s.text).sort()).toEqual(Object.values(TEXTS.hr!).sort())
    expect(h.vibetts.spoken.map((s) => s.text).sort()).toEqual(Object.values(TEXTS.en!).sort())
    expect(h.vibetts.spoken.every((s) => s.lang === 'en' && s.voice === 'am_michael')).toBe(true) // Kokoro reads English
    expect((await h.quota.read()).used).toBe(9)
  })

  it('neither fits: both local; Croatian goes to the voice VibeTTS has for it', async () => {
    const h = await harness({ used: 9 })
    const r = await h.run()
    expect(r.allocation.hr).toMatchObject({ provider: 'vibetts' })
    expect(r.allocation.en).toMatchObject({ provider: 'vibetts' })
    expect(narrates(h.flow)).toHaveLength(0)
    expect(h.vibetts.spoken.find((s) => s.lang === 'hr')).toMatchObject({ voice: 'supertonic:F1' })
    expect(await h.quota.read()).toMatchObject({ used: 9 }) // local clips cost no quota
  })

  it('a quota error mid-run (429, "retry in 20h"): the counter is exhausted, the clips already made stay, the rest of the language falls back to VibeTTS', async () => {
    const h = await harness({ flow: new QuotaFlow(2) })
    const r = await h.run()
    expect(r.allocation.hr).toMatchObject({ provider: 'gemini', made: { gemini: 2, vibetts: 1 } })
    expect(r.allocation.en).toMatchObject({ provider: 'gemini', made: { vibetts: 2 } }) // the quota was used up: English never reached Gemini
    expect(r.made).toHaveLength(5)
    expect(r.placeholders).toEqual([])
    expect(r.warnings.join('\n')).toMatch(/gemini stopped for hr \(Gemini's daily voice quota is used up.*1 clip\(s\) left go to vibetts/)
    expect(await h.quota.read()).toMatchObject({ used: 10, remaining: 0 })
    const m = await h.manifest()
    expect(getEntry(m, HR[0]!.id)!.voice!.provider).toBe('gemini') // already made: kept
    expect(getEntry(m, HR[1]!.id)!.voice!.provider).toBe('gemini')
    expect(getEntry(m, HR[2]!.id)!.voice!.provider).toBe('vibetts')
    // the next run: the used-up quota sends everything local (nothing to speak here, but a changed clip goes local)
    h.texts.en!['unit.u1.summary'] = 'The first unit is about greetings.'
    const next = await h.run({ flow: new FakeFlow() })
    expect(next.allocation.en).toMatchObject({ provider: 'vibetts' })
  })

  it('a rate limit with a short delay is retried (each retry counts), then the clip fails alone', async () => {
    const f = new FakeFlow()
    f.rateLimited = 1 // the first call is rate limited ("wait about a minute")
    const h = await harness({ flow: f })
    const r = await h.run({ lang: 'hr' })
    expect(r.made).toHaveLength(3)
    expect(narrates(f)).toHaveLength(4) // 3 clips + 1 retry
    expect((await h.quota.read()).used).toBe(4) // the retry counted
  })

  it('Gemini down (flow-music-mcp not running): the whole run is local, with a note; the clips are made', async () => {
    const f = new FakeFlow()
    f.up = false
    const h = await harness({ flow: f })
    const r = await h.run()
    expect(r.made).toHaveLength(5)
    expect(narrates(f)).toEqual([])
    expect(r.allocation.hr!.reason).toMatch(/Gemini is not available/)
    expect(await h.quota.read()).toMatchObject({ used: 0 })
  })

  it('Gemini signed out or without a key counts as down', async () => {
    const f = new FakeFlow()
    f.geminiReady = false
    const h = await harness({ flow: f })
    const r = await h.run()
    expect(r.allocation.hr!.reason).toMatch(/no Google AI Studio key/)
    expect(r.allocation.hr!.provider).toBe('vibetts')
  })

  it('VibeTTS down: ComfyUI TTS speaks (OmniVoice reads Croatian); a clip VibeTTS fails on goes to ComfyUI', async () => {
    const h = await harness({ used: 10 })
    h.vibetts.down = true
    const r = await h.run()
    expect(r.allocation.hr).toMatchObject({ provider: 'comfy', made: { comfy: 3 } })
    expect(r.allocation.en).toMatchObject({ provider: 'comfy', made: { comfy: 2 } })
    expect(h.comfy.requests.map((q) => [q.engine, q.language]).slice(0, 1)).toEqual([['omnivoice', 'hr']])
    expect(getEntry(await h.manifest(), HR[0]!.id)!.voice).toMatchObject({ provider: 'comfy' })

    const g = await harness({ used: 10 })
    g.vibetts.failTexts.add('Hvala lijepa')
    const r2 = await g.run()
    expect(r2.made).toHaveLength(5)
    expect(getEntry(await g.manifest(), voiceClipId('hr', 't.hvala'))!.voice!.provider).toBe('comfy')
    expect(getEntry(await g.manifest(), voiceClipId('hr', 't.molim'))!.voice!.provider).toBe('vibetts')
  })

  it('everything down: placeholders and warnings, the run does not fail; a later run with a provider back replaces them', async () => {
    const f = new FakeFlow()
    f.up = false
    const h = await harness({ flow: f })
    h.vibetts.down = true
    h.comfy.down = true
    const r = await h.run()
    expect(r.made).toEqual([])
    expect(r.placeholders.sort()).toEqual([...HR, ...EN].map((c) => c.id).sort())
    expect(r.failed).toHaveLength(5)
    expect(r.warnings.join('\n')).toMatch(/comfy stopped for hr/)
    const m = await h.manifest()
    for (const c of [...HR, ...EN]) {
      const e = getEntry(m, c.id)!
      expect(e.placeholder, c.id).toMatchObject({ file: 'placeholder.wav' })
      expect(existsSync(path.join(assetDir(h.courseDir, c.id), 'placeholder.wav'))).toBe(true)
      expect(e.versions).toEqual([])
    }
    h.vibetts.down = false
    const back = await h.run()
    expect(back.made).toHaveLength(5)
    const e = getEntry(await h.manifest(), HR[0]!.id)!
    expect(e.placeholder).toBeUndefined() // the placeholder file is gone
    expect(existsSync(path.join(assetDir(h.courseDir, e.id), 'placeholder.wav'))).toBe(false)
    expect(e.versions).toHaveLength(1)
  })

  it('nothing can speak a language (VibeTTS does not read it, no ComfyUI engine): placeholders for that language only', async () => {
    const h = await harness({ used: 10 })
    h.vibetts.voices = { ...h.vibetts.voices, voices: h.vibetts.voices.voices.map((v) => ({ ...v, languages: v.languages.filter((l) => l !== 'hr') })) }
    h.comfy.down = true // ComfyUI is unreachable, so hr cannot be spoken by it either: hr is allocated to comfy (it reads any language) and fails over
    const r = await h.run()
    expect(r.allocation.hr).toMatchObject({ provider: 'comfy' })
    expect(r.allocation.en).toMatchObject({ provider: 'vibetts', made: { vibetts: 2 } })
    expect(r.placeholders.sort()).toEqual(HR.map((c) => c.id).sort())
  })

  it('forced providers: vibetts and comfy never reach Gemini; gemini still respects the quota', async () => {
    const a = await harness()
    await a.run({ provider: 'vibetts' })
    expect(a.flow.calls).toEqual([]) // not even flow_status
    expect(a.vibetts.spoken).toHaveLength(5)
    const b = await harness()
    await b.run({ provider: 'comfy' })
    expect(b.flow.calls).toEqual([])
    expect(b.comfy.requests).toHaveLength(5)
    const c = await harness({ used: 8 }) // 2 left: hr (3) does not fit, en (2) does
    const r = await c.run({ provider: 'gemini' })
    expect(r.allocation.hr!.provider).toBe('vibetts')
    expect(r.allocation.en!.provider).toBe('gemini')
  })

  it('a clip whose text is empty or gone is skipped with a warning, never spoken', async () => {
    const h = await harness()
    h.texts.hr!['t.molim'] = '   '
    const r = await h.run()
    expect(r.made).toHaveLength(4)
    expect(r.warnings.join('\n')).toMatch(/the text of "t\.molim" is empty or gone/)
  })
})

describe('the helpers', () => {
  it('parseRetryDelayMs reads the wait Google asks for', () => {
    expect(parseRetryDelayMs('Please retry in 21h21m47.5s')).toBe(76_907_500)
    expect(parseRetryDelayMs('retry in 45s')).toBe(45_000)
    expect(parseRetryDelayMs('quota exceeded. retry in 20h')).toBe(72_000_000)
    expect(parseRetryDelayMs('{"retryDelay": "76907s"}')).toBe(76_907_000)
    expect(parseRetryDelayMs('Gemini TTS rate limited (HTTP 429): wait about a minute')).toBeUndefined()
    expect(QUOTA_MIN_MS).toBe(300_000)
  })

  it('the voice config has the hub defaults: 10 requests a day, Pacific time', () => {
    expect(voiceConfigSchema.parse({})).toMatchObject({ geminiDailyLimit: 10, geminiResetTz: 'America/Los_Angeles', narrationMaxChars: 600, format: 'mp3' })
  })
})

describe('the VibeTTS client', () => {
  const VOICES = {
    voices: [
      { id: 'am_michael', label: 'Michael', engine: 'kokoro', languages: ['en'] },
      { id: 'supertonic:F1', label: 'F1', engine: 'supertonic', languages: ['en', 'hr'] }
    ],
    languages: [{ code: 'hr', name: 'Croatian' }],
    language_voices: { hr: 'supertonic:F1', en: 'am_michael' },
    read_language: 'auto',
    supertonic_installed: true,
    higgs_installed: false
  }
  let closers: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(closers.map((c) => c()))
    closers = []
  })

  it('parseVibeVoices reads list_voices (and gives safe defaults for a missing field)', () => {
    const v = parseVibeVoices(VOICES)
    expect(v.voices.map((x) => x.id)).toEqual(['am_michael', 'supertonic:F1'])
    expect(v).toMatchObject({ languageVoices: { hr: 'supertonic:F1' }, readLanguage: 'auto', supertonicInstalled: true, higgsInstalled: false, languages: [{ code: 'hr', name: 'Croatian' }] })
    expect(parseVibeVoices({ voices: [{ id: 'x' }] })).toMatchObject({ voices: [{ id: 'x', label: 'x', engine: '', languages: [] }], languages: [], languageVoices: {}, readLanguage: 'auto', supertonicInstalled: false })
    expect(() => parseVibeVoices({ nope: 1 })).toThrow(/did not return "voices"/)
    expect(() => parseVibeVoices(null)).toThrow(StudioError)
  })

  it('talks MCP: list_voices, synthesize_batch with one result per clip (a failed clip has ok false), a contract error when results are missing, and the down case', async () => {
    const seen: Record<string, unknown>[] = []
    const server = await fakeMcpServer({
      tools: {
        list_voices: () => studioResult('2 voices', VOICES),
        synthesize_batch: (args) => {
          seen.push(args)
          const items = args.items as { output: string; text: string }[]
          if (items.some((i) => i.text === 'short')) return studioResult('1 of 2 clips', { results: [{ output: items[0]!.output, ok: true, duration_s: 1.2 }] })
          return studioResult('done', { results: items.map((i, n) => (i.text === 'bad' ? { output: i.output, ok: false, error: 'no engine for xx' } : { output: i.output, ok: true, duration_s: 1 + n })) })
        },
        synthesize_to_file: (args) => studioResult('ok', { output: args.output, duration_s: 2 })
      }
    })
    closers.push(server.close)
    const c = createVibeTtsClient({ url: server.url, notRunningHint: 'start VibeTTS', timeoutMs: 3000 })
    expect((await c.listVoices()).voices).toHaveLength(2)
    const r = await c.synthesizeBatch(
      [
        { text: 'Dobar dan', output: 'C:\\t\\a.wav', lang: 'hr', voice: 'supertonic:F1', speed: 1 },
        { text: 'bad', output: 'C:\\t\\b.wav', lang: 'xx' }
      ],
      { overwrite: true }
    )
    expect(r).toEqual([
      { output: 'C:\\t\\a.wav', ok: true, durationS: 1 },
      { output: 'C:\\t\\b.wav', ok: false, error: 'no engine for xx' }
    ])
    expect(seen[0]).toMatchObject({ overwrite: true, items: [{ text: 'Dobar dan', lang: 'hr', voice: 'supertonic:F1' }, { text: 'bad' }] })
    await expect(c.synthesizeBatch([{ text: 'x', output: 'o1' }, { text: 'short', output: 'o2' }])).rejects.toThrow(/did not return a result for each clip/)
    expect(await c.synthesizeBatch([])).toEqual([]) // no call for no clips
    expect(await c.synthesizeToFile({ text: 'Hi', output: 'C:\\t\\c.wav' })).toMatchObject({ output: 'C:\\t\\c.wav', ok: true, durationS: 2 })

    const dead = createVibeTtsClient({ url: 'http://127.0.0.1:9/mcp', notRunningHint: 'start VibeTTS', timeoutMs: 1500 })
    await expect(dead.listVoices()).rejects.toMatchObject({ name: 'StudioError', kind: 'unreachable', message: expect.stringMatching(/start VibeTTS/) })
  })

  it('a bearer token is sent when there is one', async () => {
    const server = await fakeMcpServer({ tools: { list_voices: () => studioResult('v', VOICES) } })
    closers.push(server.close)
    await createVibeTtsClient({ url: server.url, notRunningHint: 'h', timeoutMs: 3000, token: 'secret-token' }).listVoices()
    expect(server.seen.some((s) => s.headers.authorization === 'Bearer secret-token')).toBe(true)
  })
})
