import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { ComfyClient, ComfyRequest, ComfyResult } from '../src/engine/comfy/client'
import { ENGINES } from '../src/engine/comfy/graphs'
import type { EngineOptions } from '../src/engine/engine'
import type { MockProvider } from '../src/engine/models/mock'
import { collect } from '../src/engine/models/types'
import type { ChatRequest } from '../src/engine/models/types'
import { ROLES } from '../src/shared/schemas'
import { FakeFlow } from './flow-fakes'
import { makeEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'
import { FakeChiptune, FakePixel } from './studio-fakes'

/** A red ellipse on a transparent background: a figure that is not a rectangle, so a trim leaves transparent corners. */
const ellipse = (w: number, h: number): Promise<Buffer> => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#c81e1e"/></svg>`)).png().toBuffer()

/** A ComfyUI client that makes small images and fake audio, and records every request. */
export class FakeComfy implements ComfyClient {
  requests: ComfyRequest[] = []
  /** ComfyUI is not running: every call fails as the real client does when no lane answers. */
  down = false
  /** Prompts (or `text`) that make the request fail. */
  fail = new Set<string>()
  async generate(req: ComfyRequest): Promise<ComfyResult> {
    this.requests.push(req)
    if (this.down) throw new Error('every ComfyUI lane is busy or unreachable: http://127.0.0.1:8188 is unreachable (ComfyUI unreachable at http://127.0.0.1:8188 (connection refused)). Free a lane, set the queue policy to wait in config/comfy.md, or add another endpoint.')
    const key = req.prompt ?? req.text ?? ''
    if (this.fail.has(key)) throw new Error('ComfyUI exploded')
    // every audio engine (the music ones, the TTS Audio Suite models and MOSS) answers with sound; everything else with a picture
    const isAudio = req.engine.startsWith('custom:') || ENGINES[req.engine]?.kind === 'audio'
    if (isAudio) {
      // a custom workflow writes what its own save node writes (flac in the seed workflow); a built-in engine follows the requested format
      const ext = req.engine.startsWith('custom:') ? 'flac' : (req.format ?? 'mp3')
      return { bytes: Buffer.from(`AUDIO:${key}`), ext, kind: 'audio', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
    }
    const w = 128
    const h = 128
    // a sprite (the prompt asks for one figure on a plain flat grey background): a red figure on grey, so the cut-out has something to keep
    if ((req.prompt ?? '').includes('plain flat light grey background')) {
      const sw = req.width ?? 232
      const sh = req.height ?? 416
      const bytes = await sharp({ create: { width: sw, height: sh, channels: 3, background: { r: 200, g: 200, b: 200 } } }).composite([{ input: await ellipse(Math.round(sw / 3), Math.round(sh / 2)), left: Math.round(sw / 3), top: Math.round(sh / 4) }]).png().toBuffer()
      return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
    }
    const bytes = req.references?.length
      ? await sharp({ create: { width: w, height: h * 2, channels: 3, background: '#ffffff' } })
          .composite([{ input: await sharp({ create: { width: 40, height: 120, channels: 3, background: '#2a5db0' } }).png().toBuffer(), gravity: 'center' }])
          .png()
          .toBuffer()
      : await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 40 + (key.length % 100), g: 100, b: 160 } } }).png().toBuffer()
    return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
  }
  /** What the background-removal model does: `none` = no model is installed (the flat-colour key is used), `ok` cuts the figure out, `throws` fails. */
  removal: 'none' | 'ok' | 'throws' = 'none'
  removalCalls = 0
  async removeBackground(image?: Buffer): Promise<Buffer | null> {
    this.removalCalls++
    if (this.down) throw new Error('ComfyUI unreachable at http://127.0.0.1:8188 (connection refused)')
    if (this.removal === 'throws') throw new Error('rmbg failed')
    if (this.removal === 'none' || !image) return null // the flat-colour key is used
    // pretend the model cut the figure out: a transparent canvas of the same size with the red block where the figure is
    const m = await sharp(image).metadata()
    const w = m.width ?? 1
    const h = m.height ?? 1
    const block = await ellipse(Math.max(2, Math.round(w / 3)), Math.max(2, Math.round(h / 2)))
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: block, left: Math.round(w / 3), top: Math.round(h / 4) }]).png().toBuffer()
  }
}

/** Points the ComfyUI lanes at a closed port, so a status check (`comfyStatus`, `voiceStatus`) never touches a real ComfyUI. */
export async function deadComfyLane(env: { dir: string }): Promise<string> {
  const lane = 'http://127.0.0.1:9'
  await mkdir(path.join(env.dir, 'config'), { recursive: true })
  await writeFile(path.join(env.dir, 'config', 'comfy.md'), `---\nkind: comfy\nlanes:\n  - ${lane}\n---\n`)
  return lane
}

export interface EduEnv extends TestEnv {
  comfy: FakeComfy
  pixel: FakePixel
  chiptune: FakeChiptune
  /** Google Flow: a course only reaches it when it asks (`art.provider: flow`): its calls are recorded to prove that. */
  flow: FakeFlow
}

/**
 * A mock-model engine with one agent per role and fakes for ComfyUI, Pixel Studio, Chiptune Studio and Google Flow (no test touches a real one).
 * `studios` hands the fakes of Pixel Studio, Chiptune Studio and Google Flow to the engine (otherwise it makes the real clients, which the autostart tests need).
 * `vision` adds a vision model that the art-critic uses (without it the critic is skipped: the mock model has no vision).
 */
export async function makeEduEnv(o: { engine?: Partial<EngineOptions>; client?: boolean; mixed?: boolean; vision?: boolean; studios?: boolean } = {}): Promise<EduEnv> {
  const comfy = new FakeComfy()
  const pixel = new FakePixel()
  const chiptune = new FakeChiptune()
  const flow = new FakeFlow()
  const env = await makeEnv(
    {
      ...(o.mixed ? { providers: [{ id: 'loc', local: true, concurrency: 4, models: ['m1'] }, { id: 'client', kind: 'client' as const, local: true, concurrency: 8, models: ['claude-code'], vision: true }] } : {}),
      ...(o.vision ? { providers: [{ id: 'loc', local: true, concurrency: 4, models: ['m1'] }, { id: 'vis', local: true, concurrency: 4, models: ['v1'], vision: true }] } : {}),
      ...(o.client ? { providers: [{ id: 'client', kind: 'client' as const, local: true, concurrency: 8, models: ['claude-code'], vision: true }] } : {}),
      roles: Object.fromEntries(ROLES.map((r) => [r, [o.client ? 'client/claude-code' : o.vision && r === 'art-critic' ? 'vis/v1' : 'loc/m1']])),
      agents: ROLES.map((r) => ({ role: r, name: 'Test', ...(o.mixed ? { maxParallel: 4 } : {}) }))
    },
    { comfy, ...(o.studios ? { pixel, chiptune, flow } : {}), ...(o.engine ?? {}) }
  )
  return Object.assign(env, { comfy, pixel, chiptune, flow })
}

/** The JSON array that follows a label line in a rendered prompt (`Items to settle...:` then the JSON). */
export function jsonAfter(req: ChatRequest, label: RegExp): unknown {
  const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
  const lines = text.split('\n')
  const i = lines.findIndex((l) => label.test(l))
  if (i < 0) throw new Error(`no line matching ${label}`)
  return JSON.parse(lines[i + 1]!)
}

export async function waitIdle(env: EduEnv, slug: string, ms = 60_000): Promise<{ failed: string[] }> {
  const r = await waitFor(async () => {
    const x = await env.engine.edu.waitIdle(slug, { timeoutMs: 1 })
    return x.timedOut || x.clientTasks > 0 ? null : x
  }, ms, `course ${slug} to be idle`)
  return { failed: r.failed }
}

/** The failure text of every failed job (for a useful assertion message). */
export async function failures(env: EduEnv): Promise<string[]> {
  const jobs = await env.engine.jobs.list('failed')
  return jobs.map((j) => `${j.id}: ${String((j.data as Record<string, unknown>).failure ?? '')}`)
}

/**
 * Plays the MCP client: takes every task from the engine's client queue and answers it with `answerer` (a scripted mock), until the
 * course is idle. Uses `waitIdle`, which must return while jobs are parked in the queue. Returns the failed job ids and the tasks seen.
 */
export async function answerClientTasks(
  env: EduEnv,
  slug: string,
  answerer: MockProvider,
  ms = 120_000
): Promise<{ failed: string[]; answered: { id: string; role: string; task: string }[]; waitCalls: number }> {
  const end = Date.now() + ms
  const answered: { id: string; role: string; task: string }[] = []
  let waitCalls = 0
  for (;;) {
    const r = await env.engine.edu.waitIdle(slug, { timeoutMs: Math.max(1, end - Date.now()) })
    waitCalls++
    if (r.timedOut) throw new Error(`timed out; ${env.engine.clientQueue.list().length} task(s) left`)
    if (r.clientTasks === 0) return { failed: r.failed, answered, waitCalls }
    for (let t = env.engine.clientQueue.lease(); t; t = env.engine.clientQueue.lease()) {
      const meta = { job: t.job, role: t.role, task: t.task, book: t.book, agent: t.agent, unit: t.unit }
      const { text } = await collect(answerer.chat({ model: 'claude-code', messages: t.messages, schema: t.schema, meta }))
      const res = env.engine.clientQueue.submit(t.id, text)
      if (!res.accepted) throw new Error(`task ${t.id} refused: ${res.problems.join('; ')}`)
      answered.push({ id: t.id, role: t.role, task: t.task })
    }
  }
}
