import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createComfyClient, parseComfyConfig } from '../src/engine/comfy/client'
import { ServiceStarter, autostartConfigSchema, canStart, loadAutostartConfig, loadRegistry, startPlan } from '../src/engine/studios/autostart'
import type { AutostartConfig, Registry, RegistryEntry, StarterDeps } from '../src/engine/studios/autostart'
import { McpHttpError, createMcpClient } from '../src/engine/studios/mcp-http'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

const REGISTRY = {
  services: [
    { id: 'scriptorium', repo: 'C:\\s', port: 7341, mcp: 'http://127.0.0.1:7341/mcp', managed: true, warning: 'resumes the factory', start: { kind: 'electron', args: ['.', '--headless'] } },
    { id: 'pixel-studio', repo: 'C:\\repos\\pixel', port: 7457, mcp: 'http://127.0.0.1:7457/mcp', managed: true, start: { kind: 'electron', args: ['.', '--mcp-only'] } },
    { id: 'chiptune-studio', repo: '~\\repos\\chip', port: 7458, mcp: 'http://127.0.0.1:7458/mcp', managed: true, start: { kind: 'electron', args: ['.', '--mcp-only'], env: { FOO: 'bar', ELECTRON_RUN_AS_NODE: '1' } } },
    { id: 'lmstudio', repo: 'C:\\lm', port: 1234, mcp: 'http://127.0.0.1:1234/mcp', managed: false, start: { kind: 'exe', path: 'C:\\lm\\LM Studio.exe' } },
    {
      id: 'comfyui',
      repo: null,
      port: 8188,
      http: 'http://127.0.0.1:8188/system_stats',
      managed: true,
      start: { kind: 'exe', path: '~\\Comfy\\python.exe', cwd: '~\\Comfy', args: ['-s', 'ComfyUI\\main.py', '--extra-model-paths-config', '~\\Comfy Desktop\\x.yaml'] },
      startTimeout: 240
    },
    { id: 'strata', repo: null, port: 8080, http: 'http://127.0.0.1:8080/health', managed: false, start: { kind: 'console', path: 'D:\\run.bat' } },
    { id: 'book-translator', repo: 'C:\\b', port: 47811, managed: true, start: { kind: 'node', args: ['x'] } }
  ]
}

let dir: string
let registryFile: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'edu-autostart-'))
  registryFile = path.join(dir, 'hub', 'services.json')
  await (await import('node:fs/promises')).mkdir(path.dirname(registryFile), { recursive: true })
  await writeFile(registryFile, JSON.stringify(REGISTRY))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const reg = (): Registry => loadRegistry(registryFile)
const entry = (id: string): RegistryEntry => reg().entries.find((e) => e.id === id)!
const cfg = (over: Partial<AutostartConfig> = {}): AutostartConfig => ({ ...autostartConfigSchema.parse({}), registry: registryFile, ...over })
const URLS: Record<string, string> = { 'pixel-studio': 'http://127.0.0.1:7457/mcp', 'chiptune-studio': 'http://127.0.0.1:7458/mcp', comfyui: 'http://127.0.0.1:8188' }

/** A child process: emits `spawn`, and `exit` on demand. */
class FakeChild extends EventEmitter {
  pid: number
  unrefCalled = false
  constructor(pid: number) {
    super()
    this.pid = pid
  }
  unref() {
    this.unrefCalled = true
  }
}

/** A starter with a fake spawner, probe, clock and kill. `up` says which ids answer; `answerAfter` makes one answer after N probes once spawned. */
function setup(over: Partial<StarterDeps> & { config?: Partial<AutostartConfig>; up?: Set<string>; answerAfter?: number } = {}) {
  let t = 1_000_000
  const up = over.up ?? new Set<string>()
  const spawned: { file: string; args: string[]; options: Record<string, unknown>; child: FakeChild }[] = []
  const opened: { file: string; header: string; fd: number }[] = []
  const closed: number[] = []
  const killed: number[] = []
  const logs: string[] = []
  const probes = new Map<string, number>()
  const idOfFile = (f: string) => (/pixel/.test(f) ? 'pixel-studio' : /chip/.test(f) ? 'chiptune-studio' : /Comfy/.test(f) ? 'comfyui' : f)
  let pid = 100
  const deps: StarterDeps = {
    dataDir: dir,
    log: (m) => logs.push(m),
    spawner: ((file: string, args: string[], options: Record<string, unknown>) => {
      const child = new FakeChild(++pid)
      spawned.push({ file, args, options, child })
      probes.set(idOfFile(file), 0)
      return child
    }) as never,
    probe: async (e) => {
      if (up.has(e.id)) return true
      const n = probes.get(e.id)
      if (n !== undefined && over.answerAfter !== undefined && (probes.set(e.id, n + 1), n + 1 > over.answerAfter)) {
        up.add(e.id)
        return true
      }
      return false
    },
    openLog: (file, header) => {
      opened.push({ file, header, fd: 10 + opened.length })
      return 10 + opened.length - 1
    },
    closeFd: (fd) => closed.push(fd),
    kill: async (p) => void killed.push(p),
    now: () => t,
    sleep: async (ms) => void (t += ms),
    loadConfig: async () => cfg(over.config),
    loadStudios: async () => ({ pixelStudioExe: '', chiptuneStudioExe: '' }) as never,
    exists: () => true,
    tail: () => 'last err line',
    home: 'C:\\Users\\me',
    env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' },
    ...over
  }
  const extra = deps as unknown as Record<string, unknown>
  delete extra.config
  delete extra.up
  delete extra.answerAfter
  const starter = new ServiceStarter(deps)
  return { starter, spawned, opened, closed, killed, logs, up, advance: (ms: number) => (t += ms) }
}

describe('config and registry', () => {
  it('the seed file parses with the schema and turns auto-start on', async () => {
    const { readMd } = await import('../src/engine/store/atomic')
    const seed = await readMd(path.resolve(__dirname, '..', 'seed', 'config', 'autostart.md'))
    const c = autostartConfigSchema.parse(seed.data)
    expect(c).toMatchObject({ enabled: true, stopOnExit: false, startTimeoutS: 0, services: ['pixel-studio', 'chiptune-studio', 'comfyui'] })
  })

  it('loads config/autostart.md; a missing file gives the defaults; EDU_AUTOSTART=0 turns it off', async () => {
    expect(await loadAutostartConfig(dir, {})).toMatchObject({ enabled: true, stopOnExit: false })
    await (await import('node:fs/promises')).mkdir(path.join(dir, 'config'), { recursive: true })
    await writeFile(path.join(dir, 'config', 'autostart.md'), '---\nstopOnExit: true\nstartTimeoutS: 5\n---\n')
    expect(await loadAutostartConfig(dir, {})).toMatchObject({ enabled: true, stopOnExit: true, startTimeoutS: 5 })
    expect((await loadAutostartConfig(dir, { EDU_AUTOSTART: '0' })).enabled).toBe(false)
    await writeFile(path.join(dir, 'config', 'autostart.md'), '---\nenabled: maybe\n---\n')
    expect(await loadAutostartConfig(dir, {})).toMatchObject({ enabled: true })
  })

  it('reads the registry and says what is wrong with a missing or broken one', async () => {
    expect(reg().entries.map((e) => e.id)).toContain('comfyui')
    expect(() => loadRegistry(path.join(dir, 'nope.json'))).toThrow(/cannot be read/)
    await writeFile(registryFile, '{nope')
    expect(() => loadRegistry(registryFile)).toThrow(/not JSON/)
  })

  it('a missing registry means off, logged once, and nothing is spawned', async () => {
    const s = setup({ config: { registry: path.join(dir, 'missing.json') } })
    expect(await s.starter.ensure('pixel-studio', URLS['pixel-studio']!)).toMatch(/cannot be read/)
    expect(await s.starter.ensure('pixel-studio', URLS['pixel-studio']!)).toMatch(/cannot be read/)
    expect(s.logs.filter((l) => /autostart: off/.test(l))).toHaveLength(1)
    expect(s.spawned).toHaveLength(0)
  })
})

describe('policy', () => {
  const on = cfg()
  it('allows the three known services on their own loopback port', () => {
    for (const id of Object.keys(URLS)) expect(canStart(entry(id), URLS[id]!, on)).toBe(true)
    expect(canStart(entry('pixel-studio'), 'http://localhost:7457/mcp', on)).toBe(true)
  })

  it('refuses scriptorium and strata even when listed', () => {
    const listed = cfg({ services: ['scriptorium', 'strata', 'pixel-studio'] })
    expect(canStart(entry('scriptorium'), 'http://127.0.0.1:7341/mcp', listed)).toMatch(/never started/)
    expect(canStart(entry('strata'), 'http://127.0.0.1:8080/health', listed)).toMatch(/never started/)
  })

  it('refuses unmanaged, warned, console, node, unknown and unlisted services', () => {
    expect(canStart(entry('lmstudio'), 'http://127.0.0.1:1234/mcp', cfg({ services: ['lmstudio'] }))).toMatch(/not in the services/)
    expect(canStart({ ...entry('pixel-studio'), managed: false }, URLS['pixel-studio']!, on)).toMatch(/not managed/)
    expect(canStart({ ...entry('pixel-studio'), warning: 'careful' }, URLS['pixel-studio']!, on)).toMatch(/warning/)
    expect(canStart({ ...entry('pixel-studio'), start: { kind: 'console' } }, URLS['pixel-studio']!, on)).toMatch(/start kind "console"/)
    expect(canStart({ ...entry('pixel-studio'), start: { kind: 'node' } }, URLS['pixel-studio']!, on)).toMatch(/start kind "node"/)
    expect(canStart(entry('book-translator'), 'http://127.0.0.1:47811/mcp', cfg({ services: ['book-translator'] }))).toMatch(/not in the services/)
    expect(canStart(entry('comfyui'), URLS.comfyui!, cfg({ services: ['pixel-studio'] }))).toMatch(/not in the services/)
  })

  it('refuses a remote host, another port, and a switched-off config', () => {
    expect(canStart(entry('comfyui'), 'http://192.168.1.5:8188', on)).toMatch(/not on this machine/)
    expect(canStart(entry('comfyui'), 'http://127.0.0.1:8199', on)).toMatch(/not the registry's port 8188/)
    expect(canStart(entry('comfyui'), URLS.comfyui!, cfg({ enabled: false }))).toMatch(/off/)
  })
})

describe('start plan', () => {
  const base = { home: 'C:\\Users\\me', env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' }, platform: 'win32' as const }
  it('electron: electron.exe under the repo, the args, the repo as cwd; ~ is expanded; ELECTRON_RUN_AS_NODE is dropped; env is added', () => {
    const p = startPlan(entry('chiptune-studio'), { ...base, exists: () => true })
    if (typeof p === 'string') throw new Error(p)
    expect(p.file).toBe(path.join('C:\\Users\\me\\repos\\chip', 'node_modules', 'electron', 'dist', 'electron.exe'))
    expect(p.args).toEqual(['.', '--mcp-only'])
    expect(p.cwd).toBe('C:\\Users\\me\\repos\\chip')
    expect(p.env.FOO).toBe('bar')
    expect(p.env.PATH).toBe('x')
    expect('ELECTRON_RUN_AS_NODE' in p.env).toBe(false)
  })

  it('electron: refused when out is missing (nothing spawned)', () => {
    expect(startPlan(entry('pixel-studio'), { ...base, exists: (f) => !/[\\/]out$/.test(f) })).toMatch(/not built: run hub.ps1 build pixel-studio/)
  })

  it('exe (ComfyUI): path, cwd and args as they are, with ~ expanded and no added quotes; a missing file is refused', () => {
    const p = startPlan(entry('comfyui'), { ...base, exists: () => true })
    if (typeof p === 'string') throw new Error(p)
    expect(p.file).toBe('C:\\Users\\me\\Comfy\\python.exe')
    expect(p.cwd).toBe('C:\\Users\\me\\Comfy')
    expect(p.args).toEqual(['-s', 'ComfyUI\\main.py', '--extra-model-paths-config', 'C:\\Users\\me\\Comfy Desktop\\x.yaml'])
    expect(startPlan(entry('comfyui'), { ...base, exists: () => false })).toMatch(/does not exist/)
  })

  it('a packaged exe from config/studios.md runs as <exe> --mcp-only', () => {
    const p = startPlan(entry('pixel-studio'), { ...base, studios: { pixelStudioExe: 'D:\\Apps\\Pixel.exe', chiptuneStudioExe: '' }, exists: () => true })
    if (typeof p === 'string') throw new Error(p)
    expect(p).toMatchObject({ file: 'D:\\Apps\\Pixel.exe', args: ['--mcp-only'] })
  })
})

describe('ensure', () => {
  const ID = 'chiptune-studio'
  const URL_ = URLS[ID]!

  it('already up: nothing is spawned', async () => {
    const s = setup({ up: new Set([ID]) })
    expect(await s.starter.ensure(ID, URL_)).toBe(true)
    expect(s.spawned).toHaveLength(0)
  })

  it('starts the service, with the right spawn options and log files, waits, and logs', async () => {
    const jobLog: string[] = []
    const s = setup({ answerAfter: 3 })
    expect(await s.starter.ensure(ID, URL_, { log: (m) => jobLog.push(m) })).toBe(true)
    expect(s.spawned).toHaveLength(1)
    const sp = s.spawned[0]!
    expect(sp.options).toMatchObject({ detached: true, windowsHide: true, shell: false })
    const stdio = sp.options.stdio as unknown[]
    expect(stdio[0]).toBe('ignore')
    expect(typeof stdio[1]).toBe('number')
    expect(typeof stdio[2]).toBe('number')
    expect(stdio).not.toContain('inherit')
    expect(sp.child.unrefCalled).toBe(true)
    expect(s.closed.sort()).toEqual([10, 11])
    expect(s.opened.map((o) => path.basename(o.file))).toEqual(['chiptune-studio.out.log', 'chiptune-studio.err.log'])
    expect(path.basename(path.dirname(s.opened[0]!.file))).toBe('logs')
    expect(path.dirname(path.dirname(s.opened[0]!.file))).toBe(path.dirname(registryFile))
    expect(s.opened[0]!.header).toMatch(/^--- started by Edu Studio \d{4}-\d\d-\d\dT.*---\n$/)
    expect(s.logs.some((l) => /autostart chiptune-studio: down, starting .*\(pid 101\)/.test(l))).toBe(true)
    expect(s.logs.some((l) => /autostart chiptune-studio: up after \d+\.\d s/.test(l))).toBe(true)
    expect(jobLog.some((l) => /up after/.test(l))).toBe(true)
  })

  it('a child that exits early fails at once with its exit code and the err log tail', async () => {
    const s = setup({
      spawner: ((f: string, a: string[], o: unknown) => {
        const c = new FakeChild(7)
        queueMicrotask(() => c.emit('exit', 3, null))
        void [f, a, o]
        return c
      }) as never,
      probe: async () => false
    })
    const r = await s.starter.ensure(ID, URL_)
    expect(r).toMatch(/exited with code 3/)
    expect(r).toMatch(/last err line/)
  })

  it('times out with the timeout in the reason (the registry value for ComfyUI) and the signal stops the wait', async () => {
    const s = setup()
    expect(await s.starter.ensure(ID, URL_)).toMatch(/did not answer within 60 s/)
    const c = setup({ answerAfter: 10_000 })
    expect(await c.starter.ensure('comfyui', URLS.comfyui!)).toMatch(/did not answer within 240 s/)
    const t = setup({ config: { startTimeoutS: 7 } })
    expect(await t.starter.ensure(ID, URL_)).toMatch(/within 7 s/)

    const ac = new AbortController()
    const a = setup({ answerAfter: 10_000, sleep: async () => ac.abort() })
    expect(await a.starter.ensure(ID, URL_, { signal: ac.signal })).toBe('stopped')
    expect(a.spawned).toHaveLength(1) // the process keeps running
  })

  it('three concurrent calls share one spawn', async () => {
    const s = setup({ answerAfter: 2 })
    const r = await Promise.all([s.starter.ensure(ID, URL_), s.starter.ensure(ID, URL_), s.starter.ensure(ID, URL_)])
    expect(r).toEqual([true, true, true])
    expect(s.spawned).toHaveLength(1)
  })

  it('a failed start is not repeated for 5 minutes, then it is tried again', async () => {
    const s = setup()
    const first = await s.starter.ensure(ID, URL_)
    expect(first).toMatch(/did not answer/)
    expect(s.spawned).toHaveLength(1)
    expect(await s.starter.ensure(ID, URL_)).toBe(first)
    expect(s.spawned).toHaveLength(1)
    s.advance(5 * 60_000 + 1)
    await s.starter.ensure(ID, URL_)
    expect(s.spawned).toHaveLength(2)
  })

  it('does not start ComfyUI while Strata answers, and starts it when Strata is down', async () => {
    const s = setup({ up: new Set(['strata']) })
    expect(await s.starter.ensure('comfyui', URLS.comfyui!)).toMatch(/Strata is running/)
    expect(s.spawned).toHaveLength(0)
    const free = setup({ answerAfter: 1 })
    expect(await free.starter.ensure('comfyui', URLS.comfyui!)).toBe(true)
    expect(free.spawned).toHaveLength(1)
  })

  it('refused by policy: scriptorium, a remote URL, EDU_AUTOSTART=0 / enabled false spawn nothing', async () => {
    const s = setup({ config: { services: ['scriptorium', 'chiptune-studio'] } })
    expect(await s.starter.ensure('scriptorium', 'http://127.0.0.1:7341/mcp')).toMatch(/never started/)
    expect(await s.starter.ensure(ID, 'http://10.0.0.2:7458/mcp')).toMatch(/not on this machine/)
    const off = setup({ config: { enabled: false } })
    expect(await off.starter.ensure(ID, URL_)).toMatch(/off/)
    expect(s.spawned.length + off.spawned.length).toBe(0)
  })

  it('idForUrl maps a loopback URL to a known id by its port', async () => {
    const s = setup()
    expect(await s.starter.idForUrl('http://127.0.0.1:8188')).toBe('comfyui')
    expect(await s.starter.idForUrl('http://127.0.0.1:7457/mcp')).toBe('pixel-studio')
    expect(await s.starter.idForUrl('http://127.0.0.1:7341/mcp')).toBeNull()
    expect(await s.starter.idForUrl('http://example.com:8188')).toBeNull()
  })

  it('stopStarted kills only what this run started and still lives, and only with stopOnExit', async () => {
    const s = setup({ answerAfter: 1, config: { stopOnExit: true } })
    await s.starter.ensure('pixel-studio', URLS['pixel-studio']!)
    await s.starter.ensure(ID, URL_)
    s.spawned[0]!.child.emit('exit', 0, null) // the first one is gone already
    expect(await s.starter.stopStarted()).toEqual([ID])
    expect(s.killed).toEqual([s.spawned[1]!.child.pid])

    const keep = setup({ answerAfter: 1 })
    await keep.starter.ensure(ID, URL_)
    expect(await keep.starter.stopStarted()).toEqual([])
    expect(keep.killed).toEqual([])
  })
})

describe('hook in the MCP client', () => {
  const refuse = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  it('on unreachable it asks once, then retries and succeeds', async () => {
    let up = false
    const calls: string[] = []
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      if (!up) return refuse()
      const m = JSON.parse(String(init.body)) as { id?: number; method: string }
      calls.push(m.method)
      if (m.id === undefined) return answer({})
      return answer({ jsonrpc: '2.0', id: m.id, result: m.method === 'tools/list' ? { tools: [{ name: 'a' }] } : { protocolVersion: '2025-06-18' } })
    }) as never
    const ensureUp = vi.fn(async () => ((up = true), true as const))
    const c = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'start it', fetchImpl, ensureUp })
    expect((await c.listTools()).map((t) => t.name)).toEqual(['a'])
    expect(ensureUp).toHaveBeenCalledTimes(1)
    await c.listTools()
    expect(ensureUp).toHaveBeenCalledTimes(1)
  })

  it('a reason from ensureUp is added to the error, and it is asked once per call', async () => {
    const ensureUp = vi.fn(async () => 'pixel-studio exited with code 1')
    const c = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'start it', fetchImpl: refuse as never, ensureUp })
    await expect(c.listTools()).rejects.toThrow('start it (auto-start: pixel-studio exited with code 1)')
    expect(ensureUp).toHaveBeenCalledTimes(1)
    // ensureUp says up but nothing answers: one retry only
    const liar = vi.fn(async () => true as const)
    const c2 = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'start it', fetchImpl: refuse as never, ensureUp: liar })
    await expect(c2.listTools()).rejects.toMatchObject({ kind: 'unreachable' })
    expect(liar).toHaveBeenCalledTimes(1)
  })

  it('timeouts and HTTP errors never ask', async () => {
    const ensureUp = vi.fn(async () => true as const)
    const http500 = (async () => new Response('boom', { status: 500 })) as never
    const c = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'h', fetchImpl: http500, ensureUp })
    await expect(c.listTools()).rejects.toMatchObject({ kind: 'http' })
    const slow = (async (_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))))) as never
    const c2 = createMcpClient({ url: 'http://x/mcp', label: 'Fake', notRunningHint: 'h', fetchImpl: slow, timeoutMs: 30, ensureUp })
    await expect(c2.listTools()).rejects.toBeInstanceOf(McpHttpError)
    expect(ensureUp).not.toHaveBeenCalled()
  })
})

describe('hook in the ComfyUI client', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  afterEach(() => vi.unstubAllGlobals())

  function stub(state: { up: boolean; busy?: boolean }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input))
        if (!state.up) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
        if (url.pathname === '/queue') return json({ queue_running: state.busy ? [1] : [], queue_pending: [] })
        if (url.pathname === '/object_info') return json({})
        throw new Error(`unexpected ${url.pathname}`)
      })
    )
  }
  const config = (over = {}) => parseComfyConfig({ lanes: ['http://127.0.0.1:8188'], queuePolicy: 'refuse', ...over })

  it('no lane answers: ensureLane is asked for the lane, and the job goes on after it', async () => {
    const state = { up: false }
    stub(state)
    const ensureLane = vi.fn(async () => ((state.up = true), true as const))
    const client = createComfyClient({ config: config(), ensureLane })
    // an unknown engine fails after the lane step is not reached; use a custom path that needs a lane through removeBackground instead
    expect(await client.removeBackground(Buffer.from('x'))).toBeNull() // object_info answers {}: no removal model
    expect(ensureLane).toHaveBeenCalledWith('http://127.0.0.1:8188', undefined)
  })

  it('a reachable but busy lane never asks', async () => {
    stub({ up: true, busy: true })
    const ensureLane = vi.fn(async () => true as const)
    const client = createComfyClient({ config: config(), ensureLane })
    await expect(client.generate({ engine: 'z-image-turbo', prompt: 'x' })).rejects.toThrow(/busy/)
    expect(ensureLane).not.toHaveBeenCalled()
  })

  it('a refused start keeps today error and adds the reason', async () => {
    stub({ up: false })
    const ensureLane = vi.fn(async () => 'ComfyUI not started: Strata is running')
    const client = createComfyClient({ config: config(), ensureLane })
    await expect(client.generate({ engine: 'z-image-turbo', prompt: 'x' })).rejects.toThrow(/busy or unreachable.*auto-start http:\/\/127\.0\.0\.1:8188: ComfyUI not started: Strata is running/)
    expect(ensureLane).toHaveBeenCalledTimes(1)
  })

  it('without ensureLane nothing changes', async () => {
    stub({ up: false })
    await expect(createComfyClient({ config: config() }).generate({ engine: 'z-image-turbo', prompt: 'x' })).rejects.toThrow(/busy or unreachable/)
  })
})

describe('wiring in the service', () => {
  let env: EduEnv
  const saved = process.env.EDU_CHIPTUNE_STUDIO_URL
  beforeEach(() => {
    process.env.EDU_CHIPTUNE_STUDIO_URL = 'http://127.0.0.1:1/mcp'
  })
  afterEach(async () => {
    if (saved === undefined) delete process.env.EDU_CHIPTUNE_STUDIO_URL
    else process.env.EDU_CHIPTUNE_STUDIO_URL = saved
    await env?.cleanup?.()
  })

  it('status checks never ask the starter; a job path asks for chiptune-studio and the reason lands in the error', async () => {
    const ensure = vi.fn(async () => 'nobody home')
    const starter = { ensure, idForUrl: vi.fn(async () => null), stopStarted: vi.fn(async () => []) }
    env = await makeEduEnv({ engine: { starter: starter as never } })
    await env.engine.edu.studiosStatus()
    expect(ensure).not.toHaveBeenCalled()
    const { chiptune } = await env.engine.edu.studios({ autoStart: true })
    await expect(chiptune.listTools()).rejects.toThrow(/auto-start: nobody home/)
    expect(ensure).toHaveBeenCalledWith('chiptune-studio', 'http://127.0.0.1:1/mcp', expect.anything())
    const plain = await env.engine.edu.studios()
    await expect(plain.chiptune.listTools()).rejects.not.toThrow(/auto-start/)
    expect(ensure).toHaveBeenCalledTimes(1)
  })
})

it('tests run with auto-start off', () => {
  expect(process.env.EDU_AUTOSTART).toBe('0')
  void readFile
})
