import path from 'node:path'
import { z } from 'zod'
import { readMd } from '../store/atomic'
import type { StoredKeyGetter } from '../models/keys'
import { createFlowClient } from './flow'
import type { FlowClient } from './flow'
import { createChiptuneClient } from './chiptune'
import type { ChiptuneClient } from './chiptune'
import { resolveToken } from './mcp-http'
import { createScriptoriumClient, DEFAULT_SCRIPTORIUM_URL } from './scriptorium'
import type { ScriptoriumClient } from './scriptorium'
import { createPixelClient } from './pixel'
import type { PixelClient } from './pixel'
import { DEFAULT_VIBETTS_URL, createVibeTtsClient } from './vibetts'
import type { VibeTtsClient } from './vibetts'

export type StudioId = 'pixel' | 'chiptune'

export const DEFAULT_PIXEL_STUDIO_URL = 'http://127.0.0.1:7457/mcp'
export const DEFAULT_CHIPTUNE_STUDIO_URL = 'http://127.0.0.1:7458/mcp'
export const DEFAULT_FLOW_URL = 'http://127.0.0.1:7462/mcp'
export { DEFAULT_SCRIPTORIUM_URL } from './scriptorium'
export { DEFAULT_VIBETTS_URL } from './vibetts'

/** `config/studios.md`: where Pixel Studio and Chiptune Studio are, and where their code is (for the start hints and "Open in"). */
export const studiosConfigSchema = z.object({
  pixelStudioUrl: z.string().default(DEFAULT_PIXEL_STUDIO_URL),
  chiptuneStudioUrl: z.string().default(DEFAULT_CHIPTUNE_STUDIO_URL),
  pixelStudioRepo: z.string().default('../pixel-art-generator'),
  chiptuneStudioRepo: z.string().default('../midi-generator'),
  /** A packaged app to launch instead of `yarn electron .` from the repo. Empty: use the repo. */
  pixelStudioExe: z.string().default(''),
  chiptuneStudioExe: z.string().default(''),
  /** Bearer tokens of the apps' MCP servers. `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN` (environment or credential store) win over these. */
  pixelStudioToken: z.string().default(''),
  chiptuneStudioToken: z.string().default(''),
  /** flow-music-mcp (Google Flow images and voices, Flow Music songs). `EDU_FLOW_URL` overrides the URL. */
  flowUrl: z.string().default(DEFAULT_FLOW_URL),
  flowRepo: z.string().default('../flow-music-mcp'),
  /** The bearer token of flow-music-mcp. `FLOW_MUSIC_MCP_TOKEN` (environment or credential store) wins over this. */
  flowToken: z.string().default(''),
  /** Scriptorium (the book factory), for a course whose story is written there. `EDU_SCRIPTORIUM_URL` overrides the URL. Edu Studio never starts it. */
  scriptoriumUrl: z.string().default(DEFAULT_SCRIPTORIUM_URL),
  /** The bearer token of its MCP server, only when it has one. `SCRIPTORIUM_MCP_TOKEN` (environment or credential store) wins over this. */
  scriptoriumToken: z.string().default(''),
  /** VibeTTS (local text-to-speech: Kokoro, Supertonic, Higgs). `EDU_VIBETTS_URL` overrides the URL. Edu Studio never starts it (a tray app). */
  vibettsUrl: z.string().default(DEFAULT_VIBETTS_URL),
  /** The bearer token of its MCP server, only when it has one. `VIBETTS_MCP_TOKEN` (environment or credential store) wins over this. */
  vibettsToken: z.string().default(''),
  /** Seconds per `flow_wait` / `music_wait` call (the server allows at most 50). */
  flowPollS: z.number().min(1).max(50).default(40),
  /** Give up on one Flow image job / one Flow Music song after this many seconds. */
  flowJobTimeoutS: z.number().positive().default(900),
  flowMusicTimeoutS: z.number().positive().default(600),
  /** Download size per image kind: `upscaled` is the 2K image, `original` 1K (1376x768 at 16:9, below 1920x1080). */
  flowImageQuality: z
    .object({
      background: z.enum(['original', 'upscaled']).default('upscaled'),
      cover: z.enum(['original', 'upscaled']).default('upscaled'),
      cg: z.enum(['original', 'upscaled']).default('upscaled'),
      sheet: z.enum(['original', 'upscaled']).default('original'),
      sprite: z.enum(['original', 'upscaled']).default('original'),
      insert: z.enum(['original', 'upscaled']).default('original')
    })
    .default({ background: 'upscaled', cover: 'upscaled', cg: 'upscaled', sheet: 'original', sprite: 'original', insert: 'original' }),
  /** Pause between two `flow_narrate` calls (ms), and how often a clip is retried on a rate limit (backoff 10 s, 30 s, 90 s). */
  flowVoicePauseMs: z.number().int().min(0).default(1500),
  flowVoiceRetries: z.number().int().min(0).max(6).default(3),
  /** The most songs one project may make through Flow Music (counted from its asset versions): Flow Music spends credits. */
  flowMusicMaxSongs: z.number().int().min(0).default(4),
  /** Timeouts in seconds: short calls, an image import and export, a track render. */
  timeoutS: z.number().positive().default(15),
  importTimeoutS: z.number().positive().default(120),
  renderTimeoutS: z.number().positive().default(300),
  /** The pixel-studio-draw agent: at most this many model steps and seconds per sprite (0 seconds: no time limit). */
  drawSteps: z.number().int().min(1).max(60).default(12),
  drawTimeoutS: z.number().min(0).default(240),
  /**
   * How the sprite is drawn. `loop`: the model calls Pixel Studio's drawing tools turn by turn. `grid`: one request for the whole sprite as rows of
   * text, painted from here (made for a model that takes minutes per answer). `auto` (default): `grid` when the job's model is a client model, else `loop`.
   */
  drawMode: z.enum(['auto', 'loop', 'grid']).default('auto')
})
export type StudiosConfig = z.infer<typeof studiosConfigSchema>

/** `config/studios.md`; a missing or broken file gives the defaults. `EDU_PIXEL_STUDIO_URL` and `EDU_CHIPTUNE_STUDIO_URL` override the URLs. */
export async function loadStudiosConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<StudiosConfig> {
  let data: Record<string, unknown> = {}
  try {
    data = (await readMd(path.join(dataDir, 'config', 'studios.md'))).data
  } catch {
    /* defaults */
  }
  const parsed = studiosConfigSchema.safeParse(data)
  const c = parsed.success ? parsed.data : studiosConfigSchema.parse({})
  return {
    ...c,
    ...(env.EDU_PIXEL_STUDIO_URL ? { pixelStudioUrl: env.EDU_PIXEL_STUDIO_URL } : {}),
    ...(env.EDU_CHIPTUNE_STUDIO_URL ? { chiptuneStudioUrl: env.EDU_CHIPTUNE_STUDIO_URL } : {}),
    ...(env.EDU_FLOW_URL ? { flowUrl: env.EDU_FLOW_URL } : {}),
    ...(env.EDU_SCRIPTORIUM_URL ? { scriptoriumUrl: env.EDU_SCRIPTORIUM_URL } : {}),
    ...(env.EDU_VIBETTS_URL ? { vibettsUrl: env.EDU_VIBETTS_URL } : {})
  }
}

/**
 * How a sprite is drawn and how long the model may take. `drawMode: auto` draws from a grid (one request) when the job's model is a client model
 * and with the loop otherwise. A client model can take minutes per answer, so the loop has no time limit then (`drawSteps` still bounds it),
 * and `drawTimeoutS: 0` means no limit either. `ms` is Infinity for no limit.
 */
export function resolveDrawMode(c: Pick<StudiosConfig, 'drawMode' | 'drawTimeoutS'>, clientModel: boolean): { mode: 'loop' | 'grid'; ms: number } {
  const mode = c.drawMode === 'auto' ? (clientModel ? 'grid' : 'loop') : c.drawMode
  return { mode, ms: c.drawTimeoutS === 0 || (mode === 'loop' && clientModel) ? Infinity : c.drawTimeoutS * 1000 }
}

export const STUDIO_NAMES: Record<StudioId, string> = { pixel: 'Pixel Studio', chiptune: 'Chiptune Studio' }

export const studioUrl = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioUrl : c.chiptuneStudioUrl)
export const studioRepo = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioRepo : c.chiptuneStudioRepo)
export const studioExe = (c: StudiosConfig, id: StudioId): string => (id === 'pixel' ? c.pixelStudioExe : c.chiptuneStudioExe)

/** How to start the studio headless (the text of the "not running" error). */
export function startHint(c: StudiosConfig, id: StudioId): string {
  const exe = studioExe(c, id)
  const how = exe ? `${exe} --mcp-only` : `cd ${studioRepo(c, id)} && yarn build && yarn mcp`
  return `${STUDIO_NAMES[id]} is not running at ${studioUrl(c, id)}. Start it headless: ${how}`
}

/** The bearer token of a studio: its environment variable, the credential store, then the field in config/studios.md. Null when none is set. */
export function studioToken(c: StudiosConfig, id: StudioId, env: NodeJS.ProcessEnv = process.env, getKey?: StoredKeyGetter): string | null {
  return id === 'pixel' ? resolveToken('PIXEL_STUDIO_MCP_TOKEN', c.pixelStudioToken, env, getKey) : resolveToken('CHIPTUNE_STUDIO_MCP_TOKEN', c.chiptuneStudioToken, env, getKey)
}

export interface ClientHooks {
  /** Starts the studio when a call finds nothing at its URL (`ServiceStarter.ensure`). Only job paths pass it. */
  ensureUp?: (signal?: AbortSignal) => Promise<true | string>
}

export function pixelClientFor(c: StudiosConfig, o: ClientHooks = {}): PixelClient {
  return createPixelClient({ url: c.pixelStudioUrl, token: studioToken(c, 'pixel'), notRunningHint: startHint(c, 'pixel'), ensureUp: o.ensureUp, timeoutMs: c.timeoutS * 1000, importTimeoutMs: c.importTimeoutS * 1000 })
}

export function chiptuneClientFor(c: StudiosConfig, o: ClientHooks = {}): ChiptuneClient {
  return createChiptuneClient({ url: c.chiptuneStudioUrl, token: studioToken(c, 'chiptune'), notRunningHint: startHint(c, 'chiptune'), ensureUp: o.ensureUp, timeoutMs: c.timeoutS * 1000, renderTimeoutMs: c.renderTimeoutS * 1000 })
}

/** How to start flow-music-mcp (the text of the "not running" and "not signed in" errors). */
export function flowStartHint(c: StudiosConfig): string {
  return `flow-music-mcp is not running at ${c.flowUrl}. Start it: hub.ps1 start flow-music-mcp (or cd ${c.flowRepo} && yarn build && yarn mcp). Google Flow must be signed in: yarn login in ${c.flowRepo}.`
}

export const flowToken = (c: StudiosConfig, env: NodeJS.ProcessEnv = process.env, getKey?: StoredKeyGetter): string | null => resolveToken('FLOW_MUSIC_MCP_TOKEN', c.flowToken, env, getKey)

/** The Scriptorium client. No `ensureUp`: Edu Studio never starts Scriptorium. */
export function scriptoriumClientFor(c: StudiosConfig): ScriptoriumClient {
  return createScriptoriumClient({ url: c.scriptoriumUrl, token: resolveToken('SCRIPTORIUM_MCP_TOKEN', c.scriptoriumToken), timeoutMs: c.timeoutS * 1000 })
}

/** How to start VibeTTS (the text of its "not running" error): it is a tray app, started by hand. */
export function vibettsStartHint(c: StudiosConfig): string {
  return `VibeTTS is not running at ${c.vibettsUrl}. Start the VibeTTS app (it sits in the tray) and turn its MCP server on; Edu Studio never starts it.`
}

/** The VibeTTS client. No `ensureUp`: Edu Studio never starts VibeTTS. */
export function vibettsClientFor(c: StudiosConfig): VibeTtsClient {
  return createVibeTtsClient({ url: c.vibettsUrl, token: resolveToken('VIBETTS_MCP_TOKEN', c.vibettsToken), notRunningHint: vibettsStartHint(c), timeoutMs: c.timeoutS * 1000 })
}

export function flowClientFor(c: StudiosConfig, o: ClientHooks = {}): FlowClient {
  return createFlowClient({
    url: c.flowUrl,
    token: flowToken(c),
    notRunningHint: flowStartHint(c),
    ensureUp: o.ensureUp,
    timeoutMs: c.timeoutS * 1000,
    pollS: c.flowPollS,
    repo: c.flowRepo
  })
}
