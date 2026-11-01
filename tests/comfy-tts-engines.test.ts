import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComfyClient, parseComfyConfig } from '../src/engine/comfy/client'
import type { BuildOpts, EngineDef } from '../src/engine/comfy/graphs'
import {
  TTS_ENGINES,
} from '../src/engine/comfy/tts-engines'
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
})

describe('readiness and the engine listing', () => {

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
