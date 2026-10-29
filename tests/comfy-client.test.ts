import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectOutputs,
  createComfyClient,
  firstReachableLane,
  lanesOf,
  parseComfyConfig,
  pickLane,
  removalModelsOf,
  waitForOutputs
} from '../src/engine/comfy/client'
import { buildInventory, engineReports } from '../src/engine/comfy/inventory'
import { buildRemoveBackground, DEFAULT_FILES, ENGINES, enginesOfKind, mergeFiles, sizeOf, snap16, type BuildOpts, type Graph } from '../src/engine/comfy/graphs'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Handler = (url: URL, init?: RequestInit) => Response | undefined | Promise<Response | undefined>
function stubFetch(handler: Handler) {
  const calls: Array<{ url: URL; init?: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      const r = await handler(url, init)
      if (!r) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      return r
    })
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

const baseOpts = (over: Partial<BuildOpts> = {}): BuildOpts => ({
  files: { ...mergeFiles(undefined).zImage },
  filenamePrefix: 'p',
  seed: 7,
  steps: 8,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
  width: 1664,
  height: 928,
  prompt: 'a harbour',
  ...over
})
const classes = (g: Graph) => Object.values(g).map((n) => n.class_type)

describe('graphs', () => {
  it('snaps sizes to multiples of 16', () => {
    expect(snap16(1000)).toBe(1008)
    expect(snap16(10)).toBe(64)
    expect(sizeOf('landscape')).toEqual({ width: 1664, height: 928 })
    expect(sizeOf('nope')).toEqual({ width: 1328, height: 1328 })
  })

  it('builds the z-image graph with width, height, prompt and seed', () => {
    const g = ENGINES['z-image-turbo']!.build(baseOpts())
    expect(classes(g)).toEqual(['UNETLoader', 'ModelSamplingAuraFlow', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage'])
    expect(g[5]!.inputs.text).toBe('a harbour')
    expect(g[7]!.inputs).toMatchObject({ width: 1664, height: 928 })
    expect(g[8]!.inputs).toMatchObject({ seed: 7, steps: 8, sampler_name: 'euler' })
    expect(g[10]!.inputs.filename_prefix).toBe('p')
  })

  it('builds qwen t2i with an empty latent and the edit graph with references', () => {
    const files = { ...mergeFiles(undefined).qwen }
    const t2i = ENGINES['qwen-image-2.1']!.build(baseOpts({ files }))
    expect(classes(t2i)).toContain('EmptyLatentImage')
    expect(t2i[5]!.inputs).toMatchObject({ prompt: 'a harbour' })
    const edit = ENGINES['qwen-image-2.1-edit']!.build(baseOpts({ files, references: ['sheet.png'], autoLatent: true }))
    expect(classes(edit)).not.toContain('EmptyLatentImage')
    expect(edit[20]).toEqual({ class_type: 'LoadImage', inputs: { image: 'sheet.png' } })
    expect(edit[5]!.inputs['images.image_1']).toEqual(['20', 0])
    expect(edit[7]!.inputs.latent_image).toEqual(['5', 2])
    const sized = ENGINES['qwen-image-2.1-edit']!.build(baseOpts({ files, references: ['sheet.png'] }))
    expect(sized[6]!.inputs).toMatchObject({ width: 1664, height: 928 })
  })

  it('uses the turbo UNet for qwen turbo', () => {
    const files = { ...mergeFiles(undefined).qwen }
    const g = ENGINES['qwen-image-2.1-turbo']!.build(baseOpts({ files }))
    expect(g[1]!.inputs.unet_name).toBe(DEFAULT_FILES.qwen.turboUnet)
  })

  it('builds krea2 and the music engines with seconds and format', () => {
    const krea = ENGINES['krea2-turbo']!.build(baseOpts({ files: { ...mergeFiles(undefined).krea2 } }))
    expect(krea[2]!.inputs.type).toBe('krea2')
    const audioFiles = { ...mergeFiles(undefined).audio }
    const ace = ENGINES['ace-step-v1-instrumental']!.build(baseOpts({ files: audioFiles, tags: 'calm piano', seconds: 90, format: 'mp3' }))
    expect(ace[2]!.inputs).toMatchObject({ tags: 'calm piano', lyrics: '' })
    expect(ace[4]!.inputs.seconds).toBe(90)
    expect(ace[10]).toMatchObject({ class_type: 'SaveAudioAdvanced', inputs: { format: 'mp3', 'format.quality': 'V0' } })
    const wav = ENGINES['ace-step-v1']!.build(baseOpts({ files: audioFiles, format: 'wav' }))
    expect(wav[10]!.class_type).toBe('SaveAudio')
    const yue = ENGINES.yue2!.build(baseOpts({ files: audioFiles, style: 's', seconds: 30, format: 'opus' }))
    expect(yue[2]!.inputs).toMatchObject({ style: 's', max_duration: 30 })
    expect(yue[7]!.inputs).toMatchObject({ format: 'opus', 'format.quality': '128k' })
    const mm = ENGINES['minimax-music-3']!.build(baseOpts({ files: audioFiles, caption: 'c', seconds: 20 }))
    expect(mm[4]!.inputs).toMatchObject({ caption: 'c', max_duration: 20 })
    // the audio registry also carries the TTS Audio Suite voice engines and MOSS-SoundEffect v2
    const music = enginesOfKind('audio').filter((id) => (ENGINES[id]!.task ?? 'music') === 'music')
    expect(music).toEqual(['ace-step-v1', 'ace-step-v1-instrumental', 'yue2', 'minimax-music-3'])
    expect(enginesOfKind('audio')).toHaveLength(12)
    expect(enginesOfKind('audio').filter((id) => ENGINES[id]!.task === 'tts')).toHaveLength(7)
    expect(enginesOfKind('audio').filter((id) => ENGINES[id]!.task === 'sfx')).toEqual(['moss-soundeffect-v2'])
    expect(enginesOfKind('image')).toHaveLength(5)
  })

  it('saves an OmniVoice clip as mp3 through SaveAudioAdvanced and as wav through SaveAudio', () => {
    const opts = (format: string): BuildOpts => ({ files: {}, filenamePrefix: 'edu_voice', seed: 1, text: 'Dobar dan.', format })
    const mp3 = ENGINES['omnivoice']!.build(opts('mp3'))
    expect(mp3[5]).toMatchObject({ class_type: 'SaveAudioAdvanced', inputs: { audio: ['4', 0], format: 'mp3', 'format.quality': 'V0' } })
    const wav = ENGINES['omnivoice']!.build(opts('wav'))
    expect(wav[5]).toMatchObject({ class_type: 'SaveAudio', inputs: { audio: ['4', 0], filename_prefix: 'edu_voice' } })
    expect(ENGINES['omnivoice']!.outputNode).toBe('5')
  })

  it('builds the background removal graph', () => {
    const g = buildRemoveBackground({ image: 'a.png', model: 'm.safetensors', filenamePrefix: 'x' })
    expect(classes(g)).toEqual(['LoadImage', 'LoadBackgroundRemovalModel', 'RemoveBackground', 'InvertMask', 'JoinImageWithAlpha', 'SaveImage'])
  })

  it('wires the mask like the utility_birefnet_remove_background workflow: the foreground mask is inverted before it becomes the alpha', () => {
    const g = buildRemoveBackground({ image: 'a.png', model: 'birefnet.safetensors', filenamePrefix: 'x' })
    expect(g[3]!.inputs).toEqual({ bg_removal_model: ['2', 0], image: ['1', 0] })
    expect(g[5]!.inputs).toEqual({ mask: ['3', 0] })
    expect(g[6]!.inputs).toEqual({ image: ['1', 0], alpha: ['5', 0] })
    expect(g[7]!.inputs.images).toEqual(['6', 0])
  })
})

describe('lanes', () => {
  it('trims and de-duplicates lanes', () => {
    expect(lanesOf({ lanes: ['http://a:1/', 'http://a:1', ' '] })).toEqual(['http://a:1'])
    expect(lanesOf(undefined)).toEqual(['http://127.0.0.1:8188'])
  })

  it('picks the first free lane, treating unreachable and busy ones as busy', async () => {
    stubFetch((url) => {
      if (url.host === 'down:1') return undefined
      if (url.pathname === '/queue') return json(url.host === 'busy:1' ? { queue_running: [1], queue_pending: [] } : { queue_running: [], queue_pending: [] })
    })
    expect(await pickLane({ lanes: ['http://down:1', 'http://busy:1', 'http://free:1'] })).toEqual({ lane: 'http://free:1', busy: [] })
    const none = await pickLane({ lanes: ['http://down:1', 'http://busy:1'] })
    expect(none.lane).toBeUndefined()
    expect(none.busy[0]).toMatch(/unreachable/)
    expect(none.busy[1]).toMatch(/busy \(1 running/)
    expect(await firstReachableLane({ lanes: ['http://down:1', 'http://busy:1'] })).toBe('http://busy:1')
  })
})

describe('waitForOutputs', () => {
  const history = (entry: unknown) => stubFetch((url) => (url.pathname.startsWith('/history/') ? json(entry) : undefined))

  it('returns the outputs when the job has them', async () => {
    history({ p1: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'a.png' }] } } } })
    const out = await waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })
    expect(collectOutputs(out).images[0]?.filename).toBe('a.png')
  })

  it('throws the execution error message', async () => {
    history({ p1: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'out of memory', node_id: '8', node_type: 'KSampler' }]] } } })
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })).rejects.toThrow(/out of memory at node 8 \(KSampler\)/)
  })

  it('reports an interrupt', async () => {
    history({ p1: { status: { status_str: 'error', messages: [['execution_interrupted', { node_id: '8', node_type: 'KSampler' }]] } } })
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })).rejects.toThrow(/interrupted at node 8/)
  })

  it('does not treat an error without detail as success, and times out when nothing arrives', async () => {
    history({ p1: { status: { status_str: 'error' } } })
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })).rejects.toThrow(/no detail/)
    vi.unstubAllGlobals()
    history({})
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/did not finish/)
  })

  it('fails a prompt that is in neither the queue nor the history, but not one still queued', async () => {
    stubFetch((url) => (url.pathname === '/queue' ? json({ queue_running: [], queue_pending: [] }) : json({})))
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })).rejects.toThrow(/lost job p1/)
    vi.unstubAllGlobals()
    let polls = 0
    stubFetch((url) => {
      if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [[0, 'p1', {}]] })
      polls++
      return json(polls > 3 ? { p1: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'a.png' }] } } } } : {})
    })
    const out = await waitForOutputs('http://x', 'p1', { timeoutMs: 1000, pollMs: 1 })
    expect(collectOutputs(out).images).toHaveLength(1)
  })

  it('fails when ComfyUI stays unreachable longer than the bound', async () => {
    stubFetch(() => undefined)
    await expect(waitForOutputs('http://x', 'p1', { timeoutMs: 5000, pollMs: 2, unreachableMs: 30 })).rejects.toThrow(/has not answered/)
  })

  it('prefers the named output node', () => {
    const outputs = { 3: { audio: [{ filename: 'one.mp3' }] }, 5: { audio: [{ filename: 'two.mp3' }] } }
    expect(collectOutputs(outputs, '5').audio.map((a) => a.filename)).toEqual(['two.mp3'])
    expect(collectOutputs(outputs, '99').audio).toHaveLength(2)
  })
})

/** A fake ComfyUI: queue, upload, prompt, history, view. */
function fakeComfy(opts: { outputName?: string; kind?: 'images' | 'audio'; bytes?: string; busy?: boolean } = {}) {
  const posted: Array<{ prompt: Graph }> = []
  const uploads: string[] = []
  const calls = stubFetch(async (url, init) => {
    if (url.pathname === '/queue') return json({ queue_running: opts.busy ? [1] : [], queue_pending: [] })
    if (url.pathname === '/upload/image') {
      const form = init!.body as FormData
      const file = form.get('image') as File
      uploads.push(file.name)
      return json({ name: file.name, subfolder: '', type: 'input' })
    }
    if (url.pathname === '/prompt') {
      posted.push(JSON.parse(String(init!.body)))
      return json({ prompt_id: 'pid1' })
    }
    if (url.pathname === '/history/pid1') {
      return json({ pid1: { status: { status_str: 'success' }, outputs: { 99: { [opts.kind ?? 'images']: [{ filename: opts.outputName ?? 'out_00001_.png', subfolder: '', type: 'output' }] } } } })
    }
    if (url.pathname === '/view') return new Response(opts.bytes ?? 'BYTES')
    if (url.pathname === '/object_info') {
      return json({
        RemoveBackground: { input: { required: {} } },
        LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: ['COMBO', { options: ['birefnet.safetensors'] }] } } }
      })
    }
  })
  return { calls, posted, uploads }
}

const config = (over: Record<string, unknown> = {}) => parseComfyConfig({ pollIntervalMs: 1, jobTimeoutMs: 2000, ...over })

describe('createComfyClient: a lost prompt', () => {
  /** Fake ComfyUI whose first `lose` prompts vanish (empty queue and history), as after a crash and restart. */
  function flaky(lose: number) {
    let n = 0
    const ok = new Set<string>()
    stubFetch((url) => {
      if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] })
      if (url.pathname === '/prompt') {
        const id = `pid${++n}`
        if (n > lose) ok.add(id)
        return json({ prompt_id: id })
      }
      if (url.pathname.startsWith('/history/')) {
        const id = url.pathname.split('/')[2]!
        return json(ok.has(id) ? { [id]: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } } : {})
      }
      if (url.pathname === '/view') return new Response('BYTES')
    })
    return () => n
  }

  it('submits a vanished prompt once more and succeeds', async () => {
    const posted = flaky(1)
    const r = await createComfyClient({ config: config() }).generate({ engine: 'z-image-turbo', prompt: 'x' })
    expect(r.bytes.toString()).toBe('BYTES')
    expect(posted()).toBe(2)
  })

  it('fails the job when the prompt vanishes twice', async () => {
    const posted = flaky(2)
    await expect(createComfyClient({ config: config() }).generate({ engine: 'z-image-turbo', prompt: 'x' })).rejects.toThrow(/lost again, so the job failed/)
    expect(posted()).toBe(2)
  })
})

describe('createComfyClient', () => {
  it('runs a text-to-image engine and returns bytes and extension', async () => {
    const fake = fakeComfy({ bytes: 'PNGDATA' })
    const stages: string[] = []
    const r = await createComfyClient({ config: config() }).generate({
      engine: 'z-image-turbo', prompt: 'hi', width: 1000, height: 600, seed: 5, onProgress: (p) => stages.push(p.stage)
    })
    expect(r.bytes.toString()).toBe('PNGDATA')
    expect(r.ext).toBe('png')
    expect(r.kind).toBe('image')
    expect(r.seed).toBe(5)
    const g = fake.posted[0]!.prompt
    expect(g[7]!.inputs).toMatchObject({ width: 1008, height: 608 })
    expect(stages).toEqual(expect.arrayContaining(['lane', 'queued', 'running', 'download']))
  })

  it('uploads reference images first for the edit engine and uses the reference size when none is given', async () => {
    const fake = fakeComfy()
    await createComfyClient({ config: config() }).generate({ engine: 'qwen-image-2.1-edit', prompt: 'same, sad', references: [Buffer.from('x')] })
    expect(fake.uploads).toHaveLength(1)
    const order = fake.calls.map((c) => c.url.pathname)
    expect(order.indexOf('/upload/image')).toBeLessThan(order.indexOf('/prompt'))
    const g = fake.posted[0]!.prompt
    expect(g[20]!.inputs.image).toBe(fake.uploads[0])
    expect(g[7]!.inputs.latent_image).toEqual(['5', 2])
  })

  it('fails the edit engine without a reference', async () => {
    fakeComfy()
    await expect(createComfyClient({ config: config() }).generate({ engine: 'qwen-image-2.1-edit', prompt: 'x' })).rejects.toThrow(/reference/)
  })

  it('returns audio from a music engine with the saved extension', async () => {
    const fake = fakeComfy({ kind: 'audio', outputName: 'audio/edu_00001_.mp3' })
    const r = await createComfyClient({ config: config() }).generate({ engine: 'ace-step-v1-instrumental', prompt: 'calm', seconds: 90, format: 'mp3' })
    expect(r.kind).toBe('audio')
    expect(r.ext).toBe('mp3')
    expect(fake.posted[0]!.prompt[10]!.inputs).toMatchObject({ format: 'mp3' })
    expect(fake.posted[0]!.prompt[4]!.inputs.seconds).toBe(90)
  })

  it('applies per-engine overrides from the config', async () => {
    const fake = fakeComfy()
    await createComfyClient({ config: config({ engineSettings: { 'z-image-turbo': { steps: 12 } }, files: { zImage: { unet: 'my.safetensors' } } }) }).generate({ engine: 'z-image-turbo', prompt: 'x' })
    const g = fake.posted[0]!.prompt
    expect(g[8]!.inputs.steps).toBe(12)
    expect(g[1]!.inputs.unet_name).toBe('my.safetensors')
  })

  it('refuses when every lane is busy under the refuse policy, queues under wait', async () => {
    fakeComfy({ busy: true })
    await expect(createComfyClient({ config: config({ queuePolicy: 'refuse' }) }).generate({ engine: 'z-image-turbo', prompt: 'x' })).rejects.toThrow(/busy or unreachable/)
    const r = await createComfyClient({ config: config({ queuePolicy: 'wait' }) }).generate({ engine: 'z-image-turbo', prompt: 'x' })
    expect(r.lane).toBe('http://127.0.0.1:8188')
  })

  it('rejects an unknown engine', async () => {
    fakeComfy()
    await expect(createComfyClient({ config: config() }).generate({ engine: 'nope', prompt: 'x' })).rejects.toThrow(/unknown engine/)
  })

  it('uses the configured removal model when ComfyUI lists it, else the first listed file (only birefnet is listed here)', async () => {
    const fake = fakeComfy({ bytes: 'CUT' })
    await createComfyClient({ config: config({ backgroundRemovalModel: 'birefnet.safetensors' }) }).removeBackground(Buffer.from('img'))
    expect(fake.posted[0]!.prompt[2]!.inputs.bg_removal_name).toBe('birefnet.safetensors')
    await createComfyClient({ config: config({ backgroundRemovalModel: 'unlisted.safetensors' }) }).removeBackground(Buffer.from('img'))
    expect(fake.posted[1]!.prompt[2]!.inputs.bg_removal_name).toBe('birefnet.safetensors') // only one listed here: the fallback
  })

  it('removes backgrounds through ComfyUI when a model exists, else returns null', async () => {
    const fake = fakeComfy({ bytes: 'CUT' })
    const out = await createComfyClient({ config: config() }).removeBackground(Buffer.from('img'))
    expect(out?.toString()).toBe('CUT')
    expect(fake.posted[0]!.prompt[2]!.inputs.bg_removal_name).toBe('birefnet.safetensors')
    vi.unstubAllGlobals()
    stubFetch((url) => {
      if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] })
      if (url.pathname === '/object_info') return json({ LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: ['COMBO', { options: [] }] } } } })
    })
    expect(await createComfyClient({ config: config() }).removeBackground(Buffer.from('img'))).toBeNull()
  })
})

describe('inventory', () => {
  it('reports lanes, engine readiness and background removal', async () => {
    stubFetch((url) => {
      if (url.host === 'down:1') return undefined
      if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [1] })
      if (url.pathname.startsWith('/models/')) {
        const folder = url.pathname.split('/')[2]
        return json(folder === 'diffusion_models' ? [DEFAULT_FILES.zImage.unet] : folder === 'vae' ? [DEFAULT_FILES.zImage.vae] : folder === 'text_encoders' ? ['other.safetensors'] : [])
      }
      if (url.pathname === '/object_info') return json({ KSampler: {}, LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: [['m.safetensors']] } } }, RemoveBackground: {} })
    })
    const inv = await buildInventory(parseComfyConfig({ lanes: ['http://down:1', 'http://up:1'] }))
    expect(inv.ok).toBe(true)
    expect(inv.lanes.map((l) => l.reachable)).toEqual([false, true])
    expect(inv.lanes[1]).toMatchObject({ pending: 1 })
    const z = inv.engines.find((e) => e.id === 'z-image-turbo')!
    expect(z.ready).toBe(false)
    expect(z.missing[0]).toMatch(/^clip=/)
    expect(inv.engines.find((e) => e.id === 'ace-step-v1')!.ready).toBe(true) // checkpoints folder empty: unknown, not missing
    expect(inv.backgroundRemoval).toEqual({ available: true, models: ['m.safetensors'] })
    expect(inv.nodes).toContain('KSampler')
  })

  it('treats an unlistable folder as unknown', () => {
    const { engines } = engineReports(parseComfyConfig({}), {})
    expect(engines.every((e) => e.ready)).toBe(true)
  })

  it('reports the missing TTS Audio Suite nodes and the task and languages of every engine', () => {
    const { engines } = engineReports(parseComfyConfig({}), {}, ['OmniVoiceEngineNode', 'UnifiedTTSTextNode', 'CharacterVoicesNode', 'LoadAudio'])
    const omni = engines.find((e) => e.id === 'omnivoice')!
    expect(omni).toMatchObject({ kind: 'audio', task: 'tts', languages: '*', ready: false })
    expect(omni.missing).toEqual(['node:SaveAudio', 'node:SaveAudioAdvanced'])
    const moss = engines.find((e) => e.id === 'moss-soundeffect-v2')!
    expect(moss).toMatchObject({ task: 'sfx', languages: [], ready: false })
    expect(moss.missing).toEqual(expect.arrayContaining(['node:UnifiedSoundEffectsNode', 'node:MossSoundEffectV2EngineNode']))
    // a music engine has no suite nodes to need; a TTS engine reports the language codes it reads
    expect(engines.find((e) => e.id === 'ace-step-v1')).toMatchObject({ task: 'music', languages: [], ready: true })
    const chatterbox = engines.find((e) => e.id === 'chatterbox-23lang')!
    expect(chatterbox.languages).toContain('en')
    expect(chatterbox.languages).not.toContain('hr')
    // every registry node known: the TTS/SFX engines are ready
    const nodes = [...new Set(Object.values(ENGINES).flatMap((e) => e.requiresNodes ?? []))]
    const all = engineReports(parseComfyConfig({}), {}, nodes).engines
    expect(all.filter((e) => e.task === 'tts' || e.task === 'sfx').every((e) => e.ready)).toBe(true)
  })

  it('reads removal model names from both object_info shapes', () => {
    expect(removalModelsOf({ LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: [['a', 'b']] } } } })).toEqual(['a', 'b'])
    expect(removalModelsOf({})).toEqual([])
  })
})
