import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceStarter, autostartConfigSchema, canStart, loadRegistry, startPlan } from '../src/engine/studios/autostart'
import type { AutostartConfig, Registry, RegistryEntry, StarterDeps } from '../src/engine/studios/autostart'
import { createMcpClient } from '../src/engine/studios/mcp-http'

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

describe('policy', () => {

  it('refuses scriptorium and strata even when listed', () => {
    const listed = cfg({ services: ['scriptorium', 'strata', 'pixel-studio'] })
    expect(canStart(entry('scriptorium'), 'http://127.0.0.1:7341/mcp', listed)).toMatch(/never started/)
    expect(canStart(entry('strata'), 'http://127.0.0.1:8080/health', listed)).toMatch(/never started/)
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
})

describe('ensure', () => {
  const ID = 'chiptune-studio'
  const URL_ = URLS[ID]!

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
})
