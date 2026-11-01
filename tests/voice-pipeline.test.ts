import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlaytest } from '../src/engine/edu/playtest'
import { buildTools, toolList } from '../src/engine/mcp/tools'
import { GUIDE } from '../src/engine/mcp/server'
import { validateCourse } from '../src/shared/edu'
import type { AssetManifest } from '../src/shared/media'
import type { VoicePlanFile } from '../src/shared/voice'
import { deadComfyLane, waitIdle } from './edu-helpers'
import { FIXTURES } from './edu-fixtures'
import { courseFile, json, makePipelineEnv, run, statusOf, toolsOf } from './pipeline-helpers'
import type { PipelineEnv } from './pipeline-helpers'

/**
 * The voice in the pipeline (EGS-17), end to end on the mock team with fakes of ComfyUI, Pixel Studio, Chiptune Studio, Google Flow (Gemini TTS) and
 * VibeTTS: a language course (Croatian taught in English, the rpg shell) with EVERY asset kind (pictures, pixel sprites and tiles, music, sound
 * effects, spoken clips): published, no placeholder, a clean lint, and the real autoplay bot plays it with sound on. No test touches a real provider.
 */

const SLUG = 'croatian-greetings'
const BRIEF_LANG = { topic: 'Croatian greetings', audience: 'adults', age: 30, sourceLang: 'en', targetLang: 'hr', cefr: 'A1', units: 2, story: 'none', shells: ['quiz-arena', 'rpg'], media: { voice: { narration: true } } }
const HR_CLIPS = ['voice-hr-item-u1-q1-opt-a', 'voice-hr-item-u1-q2-listen-transcript', 'voice-hr-item-u2-q1-opt-a', 'voice-hr-item-u2-q2-listen-transcript']
const EN_CLIPS = ['voice-en-unit-u1-summary', 'voice-en-unit-u2-summary']
const DERIVED = ['u1-q1-listen', 'u1-q2-listen', 'u2-q1-listen', 'u2-q2-listen']

interface Pack {
  items: { id: string; kind: string; asset?: string; transcript?: string; extensions?: { facts?: string[]; voice?: { derivedFrom?: string } } }[]
  assets: { id: string; kind: string; file: string; alt: string }[]
  extensions: { narration?: Record<string, string> }
}
const packOf = (env: PipelineEnv, slug = SLUG) => json<Pack>(courseFile(env, slug, 'course', 'pack.json'))
const manifestOf = (env: PipelineEnv, slug = SLUG) => json<AssetManifest>(courseFile(env, slug, 'course', 'assets.json'))
const lintOf = async (env: PipelineEnv, slug = SLUG, rebuild = false) => (await toolsOf(env).call('edu_lint', { slug, rebuild })).data as { ok: boolean; errors: number; warnings: number; problems: { code: string; severity: string; path: string; message: string }[] }
const pf = (env: PipelineEnv, ...p: string[]) => courseFile(env, SLUG, 'pipeline', ...p)
const voicePlanOf = (env: PipelineEnv) => json<VoicePlanFile>(pf(env, 'voice.json'))
const wav = async (file: string) => (await readFile(file)).subarray(0, 4).toString() === 'RIFF'

/** Today's Gemini quota with 7 of 10 requests used: Croatian (4 clips) does not fit in the 3 left, English (2 clips) does. */
async function useQuota(env: PipelineEnv, used: number): Promise<void> {
  await (await env.engine.edu.voice.quota()).add(used)
}

describe('a language course with every asset kind', () => {
  it('published: pictures, pixel art, music, sound effects and spoken clips; no placeholder; a clean lint; the pack links the clips; Croatian is spoken by VibeTTS and English by Gemini (the quota rule)', async () => {
    const env = await makePipelineEnv()
    try {
      await useQuota(env, 7)
      const { failed, slug } = await run(env, BRIEF_LANG, 150_000)
      expect(slug).toBe(SLUG)
      expect(failed).toEqual([])
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[]; blockedBy?: string[] }
      expect(st.stage, JSON.stringify(st.blockedBy)).toBe('published')

      // the voice steps: after the audience review, before the build; real, not skipped
      const order = st.steps.map((s) => s.step)
      expect(order.indexOf('voice_plan:all')).toBeGreaterThan(order.indexOf('review_accessibility:all'))
      expect(order.indexOf('voice_generate:all')).toBeGreaterThan(order.indexOf('voice_plan:all'))
      expect(order.indexOf('build:all')).toBeGreaterThan(order.indexOf('voice_generate:all'))
      expect(statusOf(st, 'voice_plan:all')).toBe('done')
      expect(statusOf(st, 'voice_generate:all')).toBe('done')
      expect(st.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/^6 clip\(s\) planned \(4 listening, 2 narration\), 4 listening item\(s\) made from taught phrases, 6 new/)
      expect(st.steps.find((s) => s.step === 'voice_generate:all')!.note).toMatch(/^6 clip\(s\) spoken \(vibetts 4, gemini 2\).*hr: vibetts, en: gemini/)
      expect(st.steps.filter((s) => s.status === 'skipped').map((s) => s.step)).not.toContain('voice_plan:all')
      expect(env.author.count('voice-director/plan')).toBe(1)

      // the allocation rule: 3 Gemini requests left, Croatian needs 4 (local, VibeTTS reads it), English needs 2 (Gemini)
      const plan = await voicePlanOf(env)
      expect(plan).toMatchObject({ source: 'model', sourceLang: 'en', targetLang: 'hr' })
      expect(plan.allocation).toMatchObject({ hr: { provider: 'vibetts', need: 4, made: { vibetts: 4 }, placeholders: 0 }, en: { provider: 'gemini', need: 2, made: { gemini: 2 }, placeholders: 0 } })
      expect(env.vibetts.spoken.map((s) => [s.lang, s.voice])).toEqual(HR_CLIPS.map(() => ['hr', 'supertonic:F1']))
      expect(env.flow.spoken.map((s) => s.engine)).toEqual(['gemini', 'gemini']) // the paid Flow engine is never sent
      expect(env.flow.calls.filter((c) => c.tool === 'flow_narrate')).toHaveLength(2)
      expect(await (await env.engine.edu.voice.quota()).read()).toMatchObject({ used: 9, remaining: 1 })

      // every asset kind is in the manifest, with a real file, and nothing is a placeholder
      const manifest = await manifestOf(env)
      const kinds = [...new Set(manifest.assets.map((a) => a.kind))].sort()
      expect(kinds).toEqual(['background', 'illustration', 'music', 'sfx', 'sprite', 'tileset', 'voice'])
      expect(manifest.assets.filter((a) => ['background', 'illustration'].includes(a.kind))).toHaveLength(6)
      expect(manifest.assets.filter((a) => a.kind === 'tileset' || a.kind === 'sprite')).toHaveLength(4) // the RPG tiles and sprites (Pixel Studio)
      expect(manifest.assets.filter((a) => a.kind === 'music')).toHaveLength(7)
      expect(manifest.assets.filter((a) => a.kind === 'sfx')).toHaveLength(5)
      expect(manifest.assets.filter((a) => a.kind === 'voice').map((a) => a.id).sort()).toEqual([...HR_CLIPS, ...EN_CLIPS].sort())
      expect(manifest.assets).toHaveLength(28)
      expect(manifest.assets.filter((a) => a.placeholder)).toEqual([])
      expect(manifest.assets.filter((a) => a.versions.length !== 1)).toEqual([])
      expect(env.pixel.calls.length).toBeGreaterThan(0) // Pixel Studio made the pixel art
      expect(env.chiptune.calls.filter((c) => c.tool === 'compose_track')).toHaveLength(2)
      expect(env.chiptune.calls.filter((c) => c.tool === 'compose_sfx')).toHaveLength(5)

      // the pack: 28 assets (10 images, 12 sounds, 6 clips), none a placeholder, every clip an audio asset with an alt text
      const pack = await packOf(env)
      expect(pack.assets).toHaveLength(28)
      expect(pack.assets.filter((a) => /placeholder/i.test(a.file))).toEqual([])
      const catalog = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
      const clips = pack.assets.filter((a) => a.id.startsWith('voice-'))
      expect(clips.map((a) => a.id).sort()).toEqual([...HR_CLIPS, ...EN_CLIPS].sort())
      for (const a of clips) {
        expect(a, a.id).toMatchObject({ kind: 'audio', alt: `asset.${a.id}.alt`, file: expect.stringMatching(new RegExp(`^assets/${a.id}/v1\\.wav$`)) })
        expect(catalog.strings[a.alt], a.alt).toBeTruthy()
        expect(await wav(courseFile(env, SLUG, 'course', 'assets', a.id, 'v1.wav')), a.id).toBe(true)
        expect(existsSync(courseFile(env, SLUG, 'build', 'assets', a.id, 'v1.wav')), `build ${a.id}`).toBe(true)
      }

      // listening items: the four derived ones (same objective and facts as their source, marked) and every listening item points at a clip whose file exists
      const listening = pack.items.filter((i) => i.kind === 'listening')
      expect(listening.map((i) => i.id)).toEqual(DERIVED)
      expect(listening.map((i) => i.extensions?.voice?.derivedFrom)).toEqual(['u1-q1', 'u1-q2', 'u2-q1', 'u2-q2'])
      for (const it of listening) {
        expect(it.asset, it.id).toMatch(/^voice-hr-/)
        expect(clips.some((a) => a.id === it.asset), it.id).toBe(true)
        expect(existsSync(courseFile(env, SLUG, 'build', 'assets', it.asset!, 'v1.wav')), it.id).toBe(true)
        const source = pack.items.find((i) => i.id === it.extensions!.voice!.derivedFrom)!
        expect(it.extensions!.facts, it.id).toEqual(source.extensions!.facts) // the facts of the source item that passed the fact-check
      }
      expect(pack.items.findIndex((i) => i.id === 'u1-q1-listen')).toBe(pack.items.findIndex((i) => i.id === 'u1-q1') + 1) // put after its source

      // the narration: `pack.extensions.narration` maps the text key to its clip
      expect(pack.extensions.narration).toEqual({ 'unit.u1.summary': 'voice-en-unit-u1-summary', 'unit.u2.summary': 'voice-en-unit-u2-summary' })
      const hr = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'hr.json'))
      for (const it of listening) expect(hr.strings[it.transcript!] ?? Object.values(hr.strings).length, it.id).toBeTruthy() // the transcript is in the target-language catalog
      const en = await json<{ lang: string; strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'en.json'))
      expect(en.strings['item.u1-q1-listen.prompt']).toMatch(/Listen to the recording/)
      expect(validateCourse(pack, { en: { schema: 1, ...en }, hr: { schema: 1, lang: 'hr', ...hr } } as never).problems).toEqual([])

      // the lint: 0 errors, 0 warnings, with and without a rebuild; the pipeline's own lint saw the same
      for (const rebuild of [false, true]) expect(await lintOf(env, SLUG, rebuild)).toMatchObject({ ok: true, errors: 0, warnings: 0, problems: [] })
      expect(await json(pf(env, 'lint.json'))).toMatchObject({ ok: true, errors: 0 })
      const status = (await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }
      expect(status.media).toMatchObject({ images: 10, made: 10, audio: 18, audioMade: 18, audioPlaceholders: 0 })
    } finally {
      await env.cleanup()
    }
  }, 200_000)

  it('is idempotent and resumable: edu_voice_generate again speaks nothing; a changed text speaks exactly that clip as a new version; restart from voice keeps every clip', async () => {
    const env = await makePipelineEnv()
    try {
      await useQuota(env, 7)
      await run(env, BRIEF_LANG, 150_000)
      const { call } = toolsOf(env)
      const flowCalls = () => env.flow.calls.filter((c) => c.tool === 'flow_narrate').length
      expect([env.vibetts.spoken.length, flowCalls()]).toEqual([4, 2])

      const again = await call('edu_voice_generate', { slug: SLUG })
      expect(again.ok, again.text).toBe(true)
      expect((await waitIdle(env, SLUG, 60_000)).failed).toEqual([])
      expect([env.vibetts.spoken.length, flowCalls()]).toEqual([4, 2]) // nothing spoken
      const job = (await env.engine.jobs.list('done')).find((j) => j.id === (again.data.jobs as string[])[0])!
      expect(job.data).toMatchObject({ task: 'asset_voice_generate', role: 'voice-director' })

      // a hand edit of one Croatian text: exactly that clip is spoken again (a new version), the others are kept
      const hrCat = await json<{ strings: Record<string, string> }>(courseFile(env, SLUG, 'course', 'text', 'hr.json'))
      const key = 'item.u1-q2-listen.transcript'
      expect(hrCat.strings[key]).toBeTruthy()
      const set = await call('edu_text_set', { slug: SLUG, lang: 'hr', strings: { [key]: 'Dobro jutro' } })
      expect(set.ok, set.text).toBe(true)
      await call('edu_voice_generate', { slug: SLUG })
      await waitIdle(env, SLUG, 60_000)
      // one clip of Croatian needs speaking and 1 Gemini request is left (7 + 2 used): it fits, so Croatian goes to Gemini this time
      expect(env.vibetts.spoken).toHaveLength(4)
      expect(flowCalls()).toBe(3)
      expect(env.flow.spoken.at(-1)).toMatchObject({ text: 'Dobro jutro', engine: 'gemini' })
      expect(await (await env.engine.edu.voice.quota()).read()).toMatchObject({ used: 10, remaining: 0 })
      const e = (await manifestOf(env)).assets.find((a) => a.id === 'voice-hr-item-u1-q2-listen-transcript')!
      expect(e).toMatchObject({ selected: 2, voice: { text: 'Dobro jutro' } })
      expect(e.versions.map((v) => v.n)).toEqual([1, 2])
      expect((await packOf(env)).assets.find((a) => a.id === e.id)!.file).toBe(`assets/${e.id}/v2.wav`) // the pack follows the new version

      // restart from the voice stage: the plan is made again, every clip is kept (the hash index), the derived items stay, the build and the lint run again
      const r = await call('edu_run_pipeline', { slug: SLUG, restart: true, from: 'voice' })
      expect(r.ok, r.text).toBe(true)
      expect((await waitIdle(env, SLUG, 100_000)).failed).toEqual([])
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { run: number; stage: string; steps: { step: string; status: string; note?: string }[] }
      expect(st).toMatchObject({ run: 2, stage: 'published' })
      expect(st.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/^6 clip\(s\) planned.*4 listening item\(s\) made from taught phrases, 0 new, 6 kept from earlier/)
      expect(st.steps.find((s) => s.step === 'voice_generate:all')!.note).toMatch(/^0 clip\(s\) spoken, 6 already there/)
      expect(env.vibetts.spoken).toHaveLength(4)
      expect(flowCalls()).toBe(3)
      expect((await packOf(env)).items.filter((i) => i.kind === 'listening').map((i) => i.id)).toEqual(DERIVED)
      expect(await lintOf(env)).toMatchObject({ errors: 0, warnings: 0 })
    } finally {
      await env.cleanup()
    }
  }, 300_000)

  it('the voice-director gives no usable answer: the deterministic plan is used (a repair round first), the step never blocks, the clips are made', async () => {
    const env = await makePipelineEnv({ voicePlan: 'unusable' })
    try {
      await run(env, BRIEF_LANG, 150_000)
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[] }
      expect(st.stage).toBe('published')
      expect(env.author.count('voice-director/plan')).toBe(2) // the answer, then the repair round
      expect(st.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/from the course text: the voice-director gave no usable answer/)
      expect(await voicePlanOf(env)).toMatchObject({ source: 'fallback' })
      expect((await manifestOf(env)).assets.filter((a) => a.kind === 'voice' && !a.placeholder).length).toBeGreaterThan(0)
      expect((await lintOf(env)).errors).toBe(0)
    } finally {
      await env.cleanup()
    }
  }, 200_000)

  it('every provider down: silent placeholders and warnings, the run still publishes, the lint warns PLACEHOLDER_ASSET for each clip; a provider coming back replaces them', async () => {
    const env = await makePipelineEnv()
    try {
      env.flow.up = false
      env.vibetts.down = true
      env.comfy.down = true
      await run(env, { ...BRIEF_LANG, media: { voice: { narration: true }, art: { enabled: false }, music: { enabled: false } } }, 150_000)
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[] }
      expect(st.stage).toBe('published')
      expect(st.steps.find((s) => s.step === 'voice_generate:all')!.note).toMatch(/^0 clip\(s\) spoken, 6 placeholder\(s\) stand in/)
      const manifest = await manifestOf(env)
      expect(manifest.assets.filter((a) => a.kind === 'voice' && a.placeholder)).toHaveLength(6)
      const lint = await lintOf(env)
      expect(lint.errors).toBe(0)
      expect(lint.problems.filter((p) => p.code === 'PLACEHOLDER_ASSET')).toHaveLength(6)
      expect(((await toolsOf(env).call('edu_status', { slug: SLUG })).data as { media: Record<string, unknown> }).media).toMatchObject({ audio: 6, audioMade: 0, audioPlaceholders: 6 })

      env.vibetts.down = false // VibeTTS is back: edu_voice_generate speaks the placeholders (Gemini stays down, so everything is local)
      await toolsOf(env).call('edu_voice_generate', { slug: SLUG })
      await waitIdle(env, SLUG, 60_000)
      expect((await manifestOf(env)).assets.filter((a) => a.kind === 'voice' && a.placeholder)).toEqual([])
      expect(env.vibetts.spoken).toHaveLength(6)
      expect(await lintOf(env, SLUG, true)).toMatchObject({ errors: 0, warnings: 0 })
    } finally {
      await env.cleanup()
    }
  }, 300_000)

  it('media.voice.enabled: false skips both steps with the reason; a course that is not a language course skips them too (narration is opt-in); true makes narration only', async () => {
    const off = await makePipelineEnv()
    try {
      await run(off, { ...BRIEF_LANG, media: { voice: { enabled: false } } }, 150_000)
      const st = (await toolsOf(off).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[] }
      expect(st.stage).toBe('published')
      for (const s of ['voice_plan:all', 'voice_generate:all']) expect(st.steps.find((x) => x.step === s)).toMatchObject({ status: 'skipped', note: expect.stringMatching(/media\.voice\.enabled is false/) })
      expect(off.author.count('voice-director')).toBe(0)
      expect((await manifestOf(off)).assets.filter((a) => a.kind === 'voice')).toEqual([])
      expect((await packOf(off)).items.some((i) => i.kind === 'listening')).toBe(false)
    } finally {
      await off.cleanup()
    }
    const narrationOnly = await makePipelineEnv()
    try {
      await run(narrationOnly, { topic: 'The Roman Empire', audience: 'teenagers', age: 14, sourceLang: 'en', units: 2, story: 'none', media: { voice: { enabled: true }, art: { enabled: false }, music: { enabled: false } } }, 150_000)
      const slug = 'the-roman-empire'
      const st = (await toolsOf(narrationOnly).call('edu_status', { slug })).data.pipeline as { stage: string; steps: { step: string; status: string; note?: string }[] }
      expect(st.stage).toBe('published')
      expect(st.steps.find((s) => s.step === 'voice_plan:all')!.note).toMatch(/^2 clip\(s\) planned \(0 listening, 2 narration\), 0 listening item\(s\)/)
      // no Croatian: every clip is English, spoken by Gemini (2 of the 10 requests)
      expect(narrationOnly.flow.spoken).toHaveLength(2)
      expect(Object.keys((await packOf(narrationOnly, slug)).extensions.narration ?? {}).sort()).toEqual(['unit.u1.summary', 'unit.u2.summary'])
      expect(await lintOf(narrationOnly, slug)).toMatchObject({ errors: 0, warnings: 0 })
    } finally {
      await narrationOnly.cleanup()
    }
  }, 300_000)
})

// ---- the real autoplay bot on the course, only where Chromium is installed ----

async function chromiumAvailable(): Promise<string | null> {
  try {
    const { chromium } = await import('playwright')
    const b = await chromium.launch()
    await b.close()
    return null
  } catch (e) {
    return e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : String(e)
  }
}
const unavailable = await chromiumAvailable()
if (unavailable) console.warn(`[voice-pipeline] the real-bot test is SKIPPED: Chromium cannot be launched (${unavailable}). Run "yarn playwright install chromium".`)

describe.skipIf(!!unavailable)('the real autoplay bot plays the language course with sound on', () => {
  it('0 console errors, 0 media errors, every image and audio file of the build (pictures, music, sound effects and the 6 spoken clips) is loaded, the course is finished; a broken clip is a media error', async () => {
    const env = await makePipelineEnv({ playtest: (dir, opts) => runPlaytest(dir, { ...opts, personas: ['perfect', 'average'], concurrency: 1, timeoutMs: 200_000 }) })
    try {
      await useQuota(env, 7)
      await run(env, BRIEF_LANG, 250_000)
      const st = (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { stage: string; blockedBy?: string[]; failed?: unknown[] }
      expect(st.stage, JSON.stringify(st.blockedBy ?? st.failed)).toBe('published')
      const play = await json<{ ok: boolean; runs: { persona: string; summary: { finished: boolean; consoleErrors: number; mediaErrors: number; steps: number; media: { checked: boolean; images: number; audio: number } } }[] }>(pf(env, 'playtest.json'))
      expect(play.ok).toBe(true)
      expect(play.runs.map((r) => r.persona)).toEqual(['perfect', 'average'])
      for (const r of play.runs) {
        expect([r.summary.finished, r.summary.consoleErrors, r.summary.mediaErrors], r.persona).toEqual([true, 0, 0])
        expect(r.summary.media, r.persona).toEqual({ checked: true, images: 10, audio: 18 })
      }
      // the bot answered the derived listening items too (they are part of the 22 items)
      expect((await packOf(env)).items.filter((i) => i.kind === 'listening')).toHaveLength(4)

      // a clip that does not decode: a media error that fails the run, like a console error
      const build = courseFile(env, SLUG, 'build')
      await writeFile(path.join(build, 'assets', HR_CLIPS[0]!, 'v1.wav'), 'this is not audio')
      const bad = await runPlaytest(build, { personas: ['perfect'], timeoutMs: 120_000 })
      expect(bad.ok).toBe(false)
      expect(bad.runs[0]!.summary!.mediaErrors).toBeGreaterThanOrEqual(1)
      expect(bad.failures.some((f) => new RegExp(`media: ${HR_CLIPS[0]}`).test(f))).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 500_000)
})

// ---- the tools, on the golden fixture ----

describe('the voice tools', () => {
  it('the tools are listed with schemas and described in the MCP guide (the rule, the quota, the providers)', async () => {
    const env = await makePipelineEnv()
    try {
      const names = toolList(buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })).map((t) => t.name)
      for (const t of ['edu_voice_plan', 'edu_voice_generate', 'edu_voice_status', 'edu_voice_quota', 'edu_voice_import', 'edu_studios_status']) expect(names, t).toContain(t)
      for (const t of ['edu_voice_plan', 'edu_voice_generate', 'edu_voice_status', 'edu_voice_quota', 'edu_voice_import', 'state/gemini-tts.json', 'geminiDailyLimit', 'VibeTTS', 'pack.extensions.narration', '-listen']) expect(GUIDE, t).toContain(t)
    } finally {
      await env.cleanup()
    }
  })

  it('edu_studios_status lists VibeTTS with its voices when it is up, and the start hint (never started by Edu Studio) when it is down', async () => {
    const env = await makePipelineEnv()
    try {
      const { call } = toolsOf(env)
      const list = async () => ((await call('edu_studios_status')).data.studios as { id: string; ok: boolean; tools: number; error: string; hint: string }[]).find((s) => s.id === 'vibetts')!
      expect(await list()).toMatchObject({ id: 'vibetts', ok: true, tools: 3 })
      env.vibetts.down = true
      const down = await list()
      expect(down).toMatchObject({ ok: false, tools: 0 })
      expect(down.error).toMatch(/Edu Studio never starts it/)
      expect(down.hint).toMatch(/Edu Studio never starts it/)
    } finally {
      await env.cleanup()
    }
  })

  it('edu_voice_generate on a COPY of the golden fixture hr-a1-greetings replaces its tone placeholders: the lint then shows 0 PLACEHOLDER_ASSET', async () => {
    const env = await makePipelineEnv()
    try {
      const { call } = toolsOf(env)
      const folder = path.join(FIXTURES, 'hr-a1-greetings')
      const before = await readFile(path.join(folder, 'course', 'pack.json'), 'utf8')
      const imported = await call('edu_import_course', { folder })
      expect(imported.ok, imported.text).toBe(true)
      const slug = imported.data.slug as string
      const first = await lintOf(env, slug)
      expect(first.problems.filter((p) => p.code === 'PLACEHOLDER_ASSET')).toHaveLength(2) // the two tones that stand in for a recording
      expect(first.errors).toBe(0)

      const gen = await call('edu_voice_generate', { slug })
      expect(gen.ok, gen.text).toBe(true)
      expect((await waitIdle(env, slug, 100_000)).failed).toEqual([])
      const after = await lintOf(env, slug, true)
      expect(after.problems.filter((p) => p.code === 'PLACEHOLDER_ASSET')).toEqual([])
      expect(after).toMatchObject({ ok: true, errors: 0 })
      // the two listening items now point at spoken clips (Croatian), not at the tones
      const pack = await packOf(env, slug)
      const original = pack.items.filter((i) => i.kind === 'listening' && !i.extensions?.voice)
      expect(original.length).toBeGreaterThanOrEqual(2)
      for (const it of original) {
        expect(it.asset, it.id).toMatch(/^voice-hr-/)
        expect(await wav(courseFile(env, slug, 'course', 'assets', it.asset!, 'v1.wav')), it.id).toBe(true)
      }
      expect(pack.assets.filter((a) => /placeholder/i.test(a.file))).toEqual([])
      // no model was asked (the plan was made from the course text) and the committed fixture is untouched
      expect(env.author.count('voice-director')).toBe(0)
      expect(await readFile(path.join(folder, 'course', 'pack.json'), 'utf8')).toBe(before)
      expect(existsSync(path.join(folder, 'course', 'assets.json'))).toBe(false)
      expect((await json<VoicePlanFile>(courseFile(env, slug, 'pipeline', 'voice.json'))).source).toBe('fallback')
    } finally {
      await env.cleanup()
    }
  }, 200_000)

  it('edu_voice_plan {fallback}, edu_voice_status (providers, quota, the course, the allocation preview), edu_voice_quota, edu_voice_import and the refusals', async () => {
    const env = await makePipelineEnv()
    try {
      await deadComfyLane(env)
      const { call } = toolsOf(env)
      const slug = ((await call('edu_import_course', { folder: path.join(FIXTURES, 'hr-a1-greetings') })).data.slug as string) ?? 'hr-a1-greetings'

      // before a plan: the status has the providers and the quota, the course has no plan
      const s0 = await call('edu_voice_status', { slug })
      expect(s0.ok, s0.text).toBe(true)
      expect(s0.data).toMatchObject({ quota: { limit: 10, used: 0, remaining: 10, tz: 'America/Los_Angeles' }, course: { enabled: true, provider: 'auto', plan: null }, preview: { allocation: {}, need: {} } })
      const prov = s0.data.providers as { gemini: { up: boolean; ready: boolean; voices: string[]; quota: unknown }; vibetts: { up: boolean; voices: { id: string }[]; languages: { code: string }[]; languageVoices: Record<string, string>; supertonicInstalled: boolean } }
      expect(prov.gemini).toMatchObject({ up: true, ready: true, quota: { remaining: 10 } })
      expect(prov.gemini.voices).toContain('gemini:Kore')
      expect(prov.vibetts).toMatchObject({ up: true, supertonicInstalled: true, languageVoices: { hr: 'supertonic:F1' } })
      expect(prov.vibetts.voices.map((v) => v.id)).toContain('am_michael')
      expect(prov.vibetts.languages.map((l) => l.code)).toEqual(['en', 'hr', 'de'])
      expect(s0.data.providers).toMatchObject({ readsDe: { vibetts: true } }) // EGS-33: German readiness per provider
      expect(s0.data.engines).toBeDefined() // the local ComfyUI engines are still listed

      await call('edu_media_settings', { slug, set: { voice: { narration: true } } }) // narration is off by default for a language course (EGS-33)
      // the plan from the course text: no model
      const plan = await call('edu_voice_plan', { slug, fallback: true })
      expect(plan.ok, plan.text).toBe(true)
      expect(plan.data).toMatchObject({ source: 'fallback', packLinked: true })
      expect(plan.data.clips as number).toBeGreaterThan(0)
      expect((plan.data.derivedItems as string[]).every((id) => id.endsWith('-listen'))).toBe(true)
      expect(env.author.count('voice-director')).toBe(0)

      // the preview: what a run would do now (Croatian first, Gemini within the quota)
      const s1 = await call('edu_voice_status', { slug })
      const need = (s1.data.preview as { need: Record<string, number> }).need
      expect(Object.keys(need).sort()).toEqual(['en', 'hr'])
      const alloc = (s1.data.preview as { allocation: Record<string, { provider: string; reason: string }> }).allocation
      expect(alloc.hr!.provider).toBe(need.hr! <= 10 ? 'gemini' : 'vibetts')
      expect(alloc.en!.provider).toBe(need.en! <= 10 - (need.hr! <= 10 ? need.hr! : 0) ? 'gemini' : 'vibetts')
      expect(s1.data.course).toMatchObject({ plan: { source: 'fallback' }, clips: { planned: need.hr! + need.en!, made: 0 } })

      // the quota tool: read, and the manual reset
      await (await env.engine.edu.voice.quota()).add(4)
      expect((await call('edu_voice_quota')).data).toMatchObject({ quota: { limit: 10, used: 4, remaining: 6 } })
      expect((await call('edu_voice_quota', { reset: true })).data).toMatchObject({ reset: true, quota: { used: 0, remaining: 10 } })

      // import a clip made by hand: copied as it is, locked and imported; a generation keeps it (even when its text changes), the status says imported
      const hrClip = (await voicePlanOf2(env, slug)).clips.find((c) => c.lang === 'hr')!
      const tone = path.join(env.dir, 'mine.wav')
      const { toneWav } = await import('../src/engine/assets/wav')
      await writeFile(tone, toneWav(0.3, 523))
      const imp = await call('edu_voice_import', { slug, lang: 'hr', key: hrClip.key, file: tone })
      expect(imp.ok, imp.text).toBe(true)
      expect(imp.data).toMatchObject({ id: hrClip.id, stale: false, packLinked: true })
      await call('edu_voice_generate', { slug })
      await waitIdle(env, slug, 100_000)
      const entry = (await manifestOf(env, slug)).assets.find((a) => a.id === hrClip.id)!
      expect(entry).toMatchObject({ source: 'custom', locked: true, voice: { imported: true, provider: 'import' } })
      expect(entry.versions.length).toBe(0) // generation never made a version for it
      expect(env.vibetts.spoken.some((s) => s.text === hrClip.text)).toBe(false)
      expect(env.flow.spoken.some((s) => s.text === hrClip.text)).toBe(false)
      const s2 = await call('edu_voice_status', { slug })
      expect((s2.data.course as { clips: { imported: number } }).clips.imported).toBe(1)
      expect(await lintOf(env, slug, true)).toMatchObject({ errors: 0, warnings: 0 })

      // refusals
      expect((await call('edu_voice_import', { slug, lang: 'hr', key: 'no.such.key', file: tone })).text).toMatch(/no clip "voice-hr-no-such-key" in the voice plan/)
      expect((await call('edu_voice_generate', { slug: 'nope' })).text).toMatch(/no course "nope"/)
      expect((await call('edu_voice_plan', { slug: 'nope' })).text).toMatch(/no course "nope"/)
      expect((await call('edu_voice_status', { slug: 'nope' })).text).toMatch(/no course "nope"/)
      await call('edu_media_settings', { slug, set: { voice: { enabled: false } } })
      expect((await call('edu_voice_generate', { slug })).text).toMatch(/media\.voice\.enabled is false/)
      expect((await call('edu_voice_plan', { slug, fallback: true })).text).toMatch(/media\.voice\.enabled is false/)
    } finally {
      await env.cleanup()
    }
  }, 200_000)

  it('edu_voice_plan without fallback queues the voice-director (a model job); a course that is not a language course is refused until media.voice.enabled is true', async () => {
    const env = await makePipelineEnv()
    try {
      const { call } = toolsOf(env)
      const must = async (name: string, args: Record<string, unknown>) => {
        const r = await call(name, args)
        expect(r.ok, `${name}: ${r.text}`).toBe(true)
        return r.data
      }
      await must('edu_create_course', { slug: 'hand', title: 'Italy', languages: ['en'], sourceLang: 'en', subject: 'Italy', audience: 'teenagers' })
      expect((await call('edu_voice_plan', { slug: 'hand', fallback: true })).text).toMatch(/not a language course; set media\.voice\.enabled: true/)
      expect((await call('edu_voice_generate', { slug: 'hand' })).text).toMatch(/not a language course/)
      await must('edu_media_settings', { slug: 'hand', set: { voice: { enabled: true } } })
      env.mock.on({ role: 'voice-director' }, () => JSON.stringify({ voices: { en: { style: 'calm' } }, narration: [], derive: [], notes: 'none' }))
      const queued = await must('edu_voice_plan', { slug: 'hand' })
      const jobId = (queued.jobs as string[])[0]!
      expect(jobId).toMatch(/^hand--asset_voice_plan--q/)
      expect((await waitIdle(env, 'hand', 60_000)).failed).toEqual([])
      expect((await env.engine.jobs.list('done')).find((j) => j.id === jobId)!.data).toMatchObject({ task: 'asset_voice_plan', role: 'voice-director' })
      expect(await json<VoicePlanFile>(courseFile(env, 'hand', 'pipeline', 'voice.json'))).toMatchObject({ source: 'model', clips: [], derived: [] })
    } finally {
      await env.cleanup()
    }
  }, 120_000)
})

async function voicePlanOf2(env: PipelineEnv, slug: string): Promise<VoicePlanFile> {
  return json<VoicePlanFile>(courseFile(env, slug, 'pipeline', 'voice.json'))
}
