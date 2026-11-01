import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectOutputs,
  createComfyClient,
  firstReachableLane,
  parseComfyConfig,
  pickLane,
  waitForOutputs
} from '../src/engine/comfy/client'
import { ENGINES, mergeFiles, type BuildOpts, type Graph } from '../src/engine/comfy/graphs'

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
})

describe('lanes', () => {

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
})
