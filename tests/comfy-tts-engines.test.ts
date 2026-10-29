import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComfyClient, parseComfyConfig } from '../src/engine/comfy/client'
import { ENGINES, enginesOfKind } from '../src/engine/comfy/graphs'
import type { BuildOpts, EngineDef } from '../src/engine/comfy/graphs'
import { engineReports } from '../src/engine/comfy/inventory'
import {
  engineLanguageList,
  engineLanguageValue,
  engineReadsLanguage,
  TTS_ENGINE_IDS,
  TTS_ENGINES,
  VOICE_ENGINE_IDS
} from '../src/engine/comfy/tts-engines'
import { languageInfo } from '../src/shared/languages'
import { deadComfyLane, makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

const IDS = ['omnivoice', 'higgs-audio-v3', 'chatterbox-23lang', 'vibevoice', 'qwen3-tts', 'index-tts-2', 'f5-tts', 'moss-soundeffect-v2']
const TTS_ONLY = IDS.slice(0, 7)

/** Every required widget input of an engine node, from the code/`object_info` presets frozen in `tts-engines.ts`. */
const REQUIRED_INPUTS: Record<string, string[]> = {
  omnivoice: ['model_variant', 'device', 'num_step', 'guidance_scale', 't_shift', 'speed', 'duration'],
  'higgs-audio-v3': ['model', 'device', 'dtype', 'attention', 'temperature', 'top_p', 'top_k', 'max_new_tokens'],
  'chatterbox-23lang': ['model_version', 'device', 'exaggeration', 'temperature', 'cfg_weight', 'repetition_penalty', 'min_p', 'top_p'],
  vibevoice: ['model', 'device', 'quantize_llm_4bit', 'attention_mode', 'multi_speaker_mode', 'cfg_scale', 'inference_steps', 'use_sampling', 'temperature', 'top_p', 'chunk_minutes', 'max_new_tokens'],
  'qwen3-tts': ['model_variant', 'device', 'voice_preset', 'top_k', 'top_p', 'temperature', 'repetition_penalty', 'max_new_tokens'],
  'index-tts-2': [
    'model_path', 'device', 'emotion_alpha', 'use_random', 'max_text_tokens_per_segment', 'interval_silence', 'temperature', 'top_p', 'top_k', 'do_sample',
    'length_penalty', 'num_beams', 'repetition_penalty', 'max_mel_tokens', 'use_fp16', 'use_deepspeed'
  ],
  'f5-tts': ['device', 'temperature', 'speed', 'target_rms', 'cross_fade_duration', 'nfe_step', 'cfg_strength'],
  'moss-soundeffect-v2': ['model', 'device', 'dtype', 'inference_steps', 'cfg_scale', 'sigma_shift']
}

const opts = (over: Partial<BuildOpts> = {}): BuildOpts => ({ files: {}, filenamePrefix: 'edu_voice_test', seed: 1234, text: 'Dobar dan, kako si?', format: 'mp3', ...over })

const classes = (def: EngineDef, o: BuildOpts): string[] => Object.values(def.build(o)).map((n) => n.class_type)

let env: EduEnv | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  await env?.cleanup()
  env = undefined
})

describe('the TTS/SFX engine registry', () => {
  it('lists the engines in priority order: OmniVoice first, MOSS last, the seven voice engines before it', () => {
    expect(IDS).toEqual(TTS_ENGINE_IDS)
    expect(Object.keys(TTS_ENGINES)).toEqual(IDS)
    expect(VOICE_ENGINE_IDS).toEqual(TTS_ONLY)
    expect(enginesOfKind('audio').slice(4)).toEqual(IDS) // after the four music engines
    expect(Object.keys(TTS_ENGINES).filter((id) => TTS_ENGINES[id]!.task === 'tts')).toEqual(TTS_ONLY)
    expect(TTS_ENGINES['omnivoice']).toMatchObject({ kind: 'audio', task: 'tts' })
    expect(TTS_ENGINES['moss-soundeffect-v2']).toMatchObject({ kind: 'audio', task: 'sfx' })
  })

  it('marks only OmniVoice and Higgs Audio v3 as reading any language, and MOSS as having none', () => {
    const anyLanguage = Object.entries(TTS_ENGINES).filter(([, e]) => e.languages === '*').map(([id]) => id)
    expect(anyLanguage).toEqual(['omnivoice', 'higgs-audio-v3'])
    expect(TTS_ENGINES['moss-soundeffect-v2']!.languages).toEqual([])
    expect(engineReadsLanguage(TTS_ENGINES['omnivoice']!, 'hr')).toBe(true)
    expect(engineReadsLanguage(TTS_ENGINES['chatterbox-23lang']!, 'en')).toBe(true)
    expect(engineReadsLanguage(TTS_ENGINES['chatterbox-23lang']!, 'hr')).toBe(false)
    expect(engineLanguageList(TTS_ENGINES['omnivoice']!)).toBe('any language')
    expect(engineLanguageList(TTS_ENGINES['vibevoice']!)).toBe('en, zh')
  })

  it('uses real language codes for every fixed list (no code the project cannot use)', () => {
    const unknown: string[] = []
    for (const [id, def] of Object.entries(TTS_ENGINES)) {
      if (def.languages === '*' || !def.languages) continue
      for (const code of def.languages) if (!languageInfo(code)) unknown.push(`${id}:${code}`)
    }
    expect(unknown).toEqual([])
  })

  it('maps exactly its own language list to the engine input, and F5 to the model variants', () => {
    for (const id of ['chatterbox-23lang', 'qwen3-tts', 'index-tts-2', 'f5-tts']) {
      const def = TTS_ENGINES[id]!
      expect(def.language?.input, id).toBe('language')
      expect(Object.keys(def.language?.map ?? {}).sort(), id).toEqual([...(def.languages as string[])].sort())
    }
    const f5 = TTS_ENGINES['f5-tts']!
    expect(Object.values(f5.language!.map!)).toEqual(['F5TTS_v1_Base', 'F5-DE', 'F5-ES', 'F5-FR', 'F5-JP', 'F5-IT', 'F5-PT-BR', 'F5-Polish', 'F5-Hindi-Small'])
    expect(Object.values(f5.language!.map!).every((v) => v.startsWith('F5'))).toBe(true)
    // the engines without a language input: Higgs infers it, VibeVoice has none, MOSS makes sound
    expect(TTS_ENGINES['higgs-audio-v3']!.language).toBeUndefined()
    expect(TTS_ENGINES['vibevoice']!.language).toBeUndefined()
    expect(TTS_ENGINES['moss-soundeffect-v2']!.language).toBeUndefined()
  })

  it('turns a project language into the value its engine input takes', () => {
    expect(engineLanguageValue(TTS_ENGINES['omnivoice']!, 'en')).toBe('English')
    expect(engineLanguageValue(TTS_ENGINES['omnivoice']!, 'hr')).toBe('Croatian')
    expect(engineLanguageValue(TTS_ENGINES['chatterbox-23lang']!, 'de')).toBe('German')
    expect(engineLanguageValue(TTS_ENGINES['chatterbox-23lang']!, 'hr')).toBeUndefined() // not in its list
    expect(engineLanguageValue(TTS_ENGINES['qwen3-tts']!, 'ja')).toBe('Japanese')
    expect(engineLanguageValue(TTS_ENGINES['index-tts-2']!, 'es')).toBe('Spanish')
    expect(engineLanguageValue(TTS_ENGINES['f5-tts']!, 'de')).toBe('F5-DE')
    expect(engineLanguageValue(TTS_ENGINES['f5-tts']!, 'ja')).toBe('F5-JP')
    expect(engineLanguageValue(TTS_ENGINES['higgs-audio-v3']!, 'en')).toBeUndefined() // language inferred from the text
    expect(engineLanguageValue(TTS_ENGINES['vibevoice']!, 'en')).toBeUndefined()
    expect(engineLanguageValue(TTS_ENGINES['moss-soundeffect-v2']!, 'en')).toBeUndefined()
  })
})

describe('the built graphs', () => {
  it('every engine builds its node, and carries every required preset input', () => {
    for (const id of IDS) {
      const def = TTS_ENGINES[id]!
      const graph = def.build(opts())
      expect(graph[1], id).toMatchObject({ class_type: def.node })
      expect(Object.keys(graph[1]!.inputs), id).toEqual(expect.arrayContaining(REQUIRED_INPUTS[id]!))
      expect(def.preset, id).toBeTruthy()
      expect(Object.keys(def.preset!), id).toEqual(expect.arrayContaining(REQUIRED_INPUTS[id]!))
    }
  })

  it('a TTS graph is engine -> UnifiedTTSTextNode -> save node, with no reference clip when none is given', () => {
    for (const id of TTS_ONLY) {
      const def = TTS_ENGINES[id]!
      const graph = def.build(opts({ format: 'wav' }))
      expect(graph[4], id).toMatchObject({ class_type: 'UnifiedTTSTextNode' })
      expect(graph[4]!.inputs.TTS_engine, id).toEqual(['1', 0])
      expect(graph[4]!.inputs.text, id).toBe('Dobar dan, kako si?')
      expect(graph[4]!.inputs.seed, id).toBe(1234)
      expect(graph[2], id).toBeUndefined()
      expect(graph[3], id).toBeUndefined()
      expect(graph[4]!.inputs.opt_narrator, id).toBeUndefined()
      expect(graph[5], id).toMatchObject({ class_type: 'SaveAudio', inputs: { audio: ['4', 0], filename_prefix: 'edu_voice_test' } })
      expect(def.outputNode, id).toBe('5')
      expect(classes(def, opts()), id).toEqual([def.node, 'UnifiedTTSTextNode', 'SaveAudioAdvanced'])
    }
  })

  it('adds LoadAudio and CharacterVoicesNode only with a reference clip, and wires opt_narrator', () => {
    for (const id of TTS_ONLY) {
      const def = TTS_ENGINES[id]!
      const graph = def.build(opts({ voiceRef: 'clip.wav', voiceRefText: 'the transcript' }))
      expect(graph[2], id).toMatchObject({ class_type: 'LoadAudio', inputs: { audio: 'clip.wav' } })
      expect(graph[3], id).toMatchObject({
        class_type: 'CharacterVoicesNode',
        inputs: { voice_name: 'none', reference_text: 'the transcript', trim_start: 0, trim_end: 0, customized: false, opt_audio_input: ['2', 0] }
      })
      expect(graph[4]!.inputs.opt_narrator, id).toEqual(['3', 0])
    }
  })

  it('writes mp3 through SaveAudioAdvanced (with its format.quality) and wav through SaveAudio', () => {
    for (const id of IDS) {
      const def = TTS_ENGINES[id]!
      const saveNode = def.task === 'sfx' ? '3' : '5'
      const source = def.task === 'sfx' ? ['2', 0] : ['4', 0]
      const mp3 = def.build(opts({ format: 'mp3', quality: 'V0', ...(def.task === 'sfx' ? { seconds: 7 } : {}) }))
      expect(mp3[saveNode], id).toMatchObject({ class_type: 'SaveAudioAdvanced', inputs: { audio: source, format: 'mp3', 'format.quality': 'V0' } })
      expect(def.outputNode, id).toBe(saveNode)
      const wav = def.build(opts({ format: 'wav' }))
      expect(wav[saveNode], id).toMatchObject({ class_type: 'SaveAudio', inputs: { audio: source, filename_prefix: 'edu_voice_test' } })
    }
  })

  it('a sound effect is engine -> UnifiedSoundEffectsNode -> save node, with the description and length', () => {
    const graph = TTS_ENGINES['moss-soundeffect-v2']!.build(opts({ text: 'a ship bell', seconds: 7, format: 'wav' }))
    expect(graph[1]).toMatchObject({ class_type: 'MossSoundEffectV2EngineNode', inputs: { model: 'MOSS-SoundEffect-v2.0', inference_steps: 100, cfg_scale: 4, sigma_shift: 5, negative_prompt: '' } })
    expect(graph[2]).toMatchObject({ class_type: 'UnifiedSoundEffectsNode', inputs: { TTS_engine: ['1', 0], description: 'a ship bell', duration_seconds: 7, seed: 1234, crossfade_seconds: 1, enable_audio_cache: true } })
    expect(graph[3]).toMatchObject({ class_type: 'SaveAudio', inputs: { audio: ['2', 0] } })
    expect(Object.values(graph).some((n) => n.class_type === 'UnifiedTTSTextNode')).toBe(false)
    // the prompt stands in for the description when no text was given
    const fromPrompt = TTS_ENGINES['moss-soundeffect-v2']!.build(opts({ text: '', prompt: 'a door slam' }))
    expect(fromPrompt[2]!.inputs.description).toBe('a door slam')
    expect(fromPrompt[2]!.inputs.duration_seconds).toBe(5)
  })

  it('puts the delivery style in the engine input, or in front of the text for Higgs inline tags', () => {
    const omni = TTS_ENGINES['omnivoice']!.build(opts({ instruct: '  a warm whisper  ' }))
    expect(omni[1]!.inputs.instruct).toBe('a warm whisper')
    expect(omni[4]!.inputs.text).toBe('Dobar dan, kako si?')
    const higgs = TTS_ENGINES['higgs-audio-v3']!.build(opts({ instruct: '<|emotion:calm|>' }))
    expect(higgs[1]!.inputs).not.toHaveProperty('instruct')
    expect(higgs[4]!.inputs.text).toBe('<|emotion:calm|> Dobar dan, kako si?')
    // a plain note is not inline-tag syntax: it never reaches a Higgs clip
    expect(TTS_ENGINES['higgs-audio-v3']!.build(opts({ instruct: 'gently' }))[4]!.inputs.text).toBe('Dobar dan, kako si?')
    // only the engines whose preset takes a speed read config speed
    expect(TTS_ENGINES['f5-tts']!.build(opts({ speed: 1.4 }))[1]!.inputs.speed).toBe(1.4)
    expect(TTS_ENGINES['chatterbox-23lang']!.build(opts({ speed: 1.4 }))[1]!.inputs.speed).toBeUndefined()
    // Qwen3 uses the clip without its transcript in x-vector-only mode
    expect(TTS_ENGINES['qwen3-tts']!.build(opts({ voiceRef: 'clip.wav' }))[1]!.inputs.x_vector_only_mode).toBe(true)
    expect(TTS_ENGINES['qwen3-tts']!.build(opts({ voiceRef: 'clip.wav', voiceRefText: 'hi' }))[1]!.inputs.x_vector_only_mode).toBe(false)
  })
})

describe('readiness and the engine listing', () => {
  it('engineReports flags missing TTS nodes and carries the task and languages', () => {
    const { engines } = engineReports(parseComfyConfig({}), {}, ['OmniVoiceEngineNode', 'UnifiedTTSTextNode', 'CharacterVoicesNode', 'LoadAudio'])
    const omni = engines.find((e) => e.id === 'omnivoice')!
    expect(omni).toMatchObject({ task: 'tts', languages: '*', ready: false })
    expect(omni.missing).toEqual(expect.arrayContaining(['node:SaveAudio', 'node:SaveAudioAdvanced']))
    expect(engines.find((e) => e.id === 'moss-soundeffect-v2')).toMatchObject({ task: 'sfx', languages: [] })
    expect(engines.find((e) => e.id === 'ace-step-v1')).toMatchObject({ task: 'music', languages: [] })
    const nodes = [...new Set(Object.values(ENGINES).flatMap((e) => e.requiresNodes ?? []))]
    expect(engineReports(parseComfyConfig({}), {}, nodes).engines.filter((e) => e.task !== 'music').every((e) => e.ready)).toBe(true)
  })

  it('listEngines carries task and languages for every engine', async () => {
    env = await makeEduEnv()
    const lists = await env.engine.edu.listEngines()
    const by = (id: string) => lists.audio.find((e) => e.id === id)!
    expect(by('omnivoice')).toMatchObject({ kind: 'audio', task: 'tts', languages: '*', edit: false })
    expect(by('chatterbox-23lang').languages).toContain('en')
    expect(by('moss-soundeffect-v2')).toMatchObject({ task: 'sfx', languages: [] })
    expect(by('ace-step-v1')).toMatchObject({ task: 'music', languages: [] })
    expect(lists.audio.every((e) => e.task === 'music' || e.task === 'tts' || e.task === 'sfx')).toBe(true)
    expect(lists.image.every((e) => e.task === 'music')).toBe(true)
  })

  it('voiceStatus lists the local engines and custom TTS workflows without touching a real ComfyUI', async () => {
    env = await makeEduEnv()
    const lane = await deadComfyLane(env)
    const status = await env.engine.edu.voiceStatus()
    expect(status).toMatchObject({ type: 'voice.status', ok: false, comfyUrl: lane, defaultEngine: 'omnivoice' })
    expect(status.error).toMatch(/not reachable/)
    expect(status.engines.find((e) => e.id === 'omnivoice')).toMatchObject({ label: 'OmniVoice (600+ languages)', task: 'tts', languages: '*' })
    expect(status.engines.find((e) => e.id === 'higgs-audio-v3')).toMatchObject({ task: 'tts', languages: '*' })
    expect(status.engines.find((e) => e.id === 'moss-soundeffect-v2')).toMatchObject({ task: 'sfx', languages: [] })
    expect(status.engines.some((e) => e.task === 'music')).toBe(false)
    expect(status.workflows).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'chatterbox-multilingual', languages: expect.arrayContaining(['en']) })]))
  })

  it('refuses a voice job whose TTS Audio Suite nodes ComfyUI does not list, with the install hint', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input))
        if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] })
        if (url.pathname === '/object_info') return json({ KSampler: {} })
        return undefined
      })
    )
    const client = createComfyClient({ config: parseComfyConfig({ pollIntervalMs: 1 }) })
    await expect(client.generate({ engine: 'omnivoice', text: 'Dobar dan.', language: 'en' })).rejects.toThrow(
      /engine "omnivoice" needs the ComfyUI nodes OmniVoiceEngineNode, UnifiedTTSTextNode, CharacterVoicesNode, LoadAudio, SaveAudio, SaveAudioAdvanced \(TTS Audio Suite\): install it or pick another voice engine/
    )
  })

  it('refuses a language the engine does not read before submitting anything', async () => {
    const generate = vi.fn(async () => new Response(JSON.stringify({ queue_running: [], queue_pending: [] })))
    vi.stubGlobal('fetch', generate)
    const client = createComfyClient({ config: parseComfyConfig({}) })
    await expect(client.generate({ engine: 'chatterbox-23lang', text: 'Dobar dan.', language: 'hr' })).rejects.toThrow(
      /engine "chatterbox-23lang" does not read hr \(it reads: ar, da, de, el, en, es, fi, fr, he, hi, it, ja, ko, nl, no, pl, pt, ru, sv, tr, zh\)/
    )
  })
})
