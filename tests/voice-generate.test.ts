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
import { FlowError } from '../src/engine/studios/flow'
import type { NarrateArgs } from '../src/engine/studios/flow'
import { parseCourseMedia } from '../src/shared/media'
import type { AssetManifest } from '../src/shared/media'
import type { VoiceClipPlan, VoicePlanFile } from '../src/shared/voice'
import { voiceClipId } from '../src/shared/voice'
import { FakeComfy } from './edu-helpers'
import { FakeFlow } from './flow-fakes'
import { FakeVibeTts } from './studio-fakes'

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
})

describe('the quota and the fall-backs', () => {

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
})
