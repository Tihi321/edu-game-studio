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
import { makeEnv, waitFor } from './helpers'
import type { TestEnv } from './helpers'

/** A ComfyUI client that makes small images and fake audio, and records every request. */
export class FakeComfy implements ComfyClient {
  requests: ComfyRequest[] = []
  /** Prompts (or `text`) that make the request fail. */
  fail = new Set<string>()
  async generate(req: ComfyRequest): Promise<ComfyResult> {
    this.requests.push(req)
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
    const bytes = req.references?.length
      ? await sharp({ create: { width: w, height: h * 2, channels: 3, background: '#ffffff' } })
          .composite([{ input: await sharp({ create: { width: 40, height: 120, channels: 3, background: '#2a5db0' } }).png().toBuffer(), gravity: 'center' }])
          .png()
          .toBuffer()
      : await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 40 + (key.length % 100), g: 100, b: 160 } } }).png().toBuffer()
    return { bytes, ext: 'png', kind: 'image', seed: req.seed ?? 1, engine: req.engine, lane: 'fake', promptId: 'p' }
  }
  async removeBackground(): Promise<Buffer | null> {
    return null // the flat-colour key is used
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
}

/** A mock-model engine with one agent per role and a fake ComfyUI. */
export async function makeEduEnv(o: { engine?: Partial<EngineOptions>; client?: boolean; mixed?: boolean } = {}): Promise<EduEnv> {
  const comfy = new FakeComfy()
  const env = await makeEnv(
    {
      ...(o.mixed ? { providers: [{ id: 'loc', local: true, concurrency: 4, models: ['m1'] }, { id: 'client', kind: 'client' as const, local: true, concurrency: 8, models: ['claude-code'], vision: true }] } : {}),
      ...(o.client ? { providers: [{ id: 'client', kind: 'client' as const, local: true, concurrency: 8, models: ['claude-code'], vision: true }] } : {}),
      roles: Object.fromEntries(ROLES.map((r) => [r, [o.client ? 'client/claude-code' : 'loc/m1']])),
      agents: ROLES.map((r) => ({ role: r, name: 'Test', ...(o.mixed ? { maxParallel: 4 } : {}) }))
    },
    { comfy, ...(o.engine ?? {}) }
  )
  return Object.assign(env, { comfy })
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
