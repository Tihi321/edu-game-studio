import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { FlowError } from '../src/engine/studios/flow'
import type { FlowClient, FlowImageArgs, FlowLoop, FlowSong, FlowStatus, FlowVoices, NarrateArgs, SongArgs } from '../src/engine/studios/flow'

/** A flat grey picture with a red figure in the middle (so the flat-colour key can cut it out), at the size Flow gives for an aspect and quality. */
async function picture(aspect: FlowImageArgs['aspect'], quality: FlowImageArgs['quality']): Promise<Buffer> {
  const k = quality === 'upscaled' ? 2 : 1
  const [w, h] = (aspect === '16:9' ? [1376, 768] : aspect === '9:16' ? [768, 1376] : [1024, 1024]).map((n) => n * k) as [number, number]
  const figure = await sharp({ create: { width: Math.round(w / 3), height: Math.round(h / 2), channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .composite([{ input: figure, left: Math.round(w / 3), top: Math.round(h / 4) }])
    .jpeg()
    .toBuffer()
}

const DOWN = 'flow-music-mcp is not running at http://fake/flow. Start it: hub.ps1 start flow-music-mcp'

export const GEMINI = [
  { name: 'Charon', description: 'informative', gender: 'male' as const },
  { name: 'Puck', description: 'upbeat', gender: 'male' as const },
  { name: 'Orus', description: 'firm', gender: 'male' as const },
  { name: 'Kore', description: 'firm', gender: 'female' as const },
  { name: 'Aoede', description: 'breezy', gender: 'female' as const },
  { name: 'Gacrux', description: 'mature', gender: 'female' as const }
]

/** flow-music-mcp as a fake client: writes real files where the tool would, and records the calls. */
export class FakeFlow implements FlowClient {
  url = 'http://fake/flow'
  calls: { tool: string; args: Record<string, unknown> }[] = []
  up = true
  signedIn: boolean | null = true
  /** Fail the next calls of `generateImage` with this. */
  imageError: FlowError | null = null
  /** A reference given as `asset:<id>` is "not found" (the sheet was edited in Flow). */
  staleAssetRefs = false
  /** The first N `narrate` calls fail with a rate limit. */
  rateLimited = 0
  /** Every narrate call fails (a persistent rate limit). */
  alwaysRateLimited = false
  /** The text of the rate-limit error. */
  rateLimitText = 'Gemini TTS rate limited (HTTP 429): wait about a minute'
  /** The Google AI Studio key is set up (the Gemini voices work). */
  geminiReady = true
  songError: FlowError | null = null
  loopError: Error | null = null
  loopScore = 0.9
  windowsVoices: { name: string; culture: string; gender?: 'female' | 'male' }[] = [
    { name: 'Microsoft Zira Desktop', culture: 'en-US', gender: 'female' },
    { name: 'Microsoft David Desktop', culture: 'en-US', gender: 'male' }
  ]
  private n = 0

  async status(): Promise<FlowStatus> {
    this.calls.push({ tool: 'flow_status', args: {} })
    if (!this.up) return { up: false, signedIn: null, uploadRights: false, hint: 'flow-music-mcp is not running at http://fake/flow. Start it: hub.ps1 start flow-music-mcp' }
    if (this.signedIn === false) return { up: true, signedIn: false, uploadRights: false, hint: 'Google Flow is not signed in: run yarn login in flow-music-mcp' }
    return { up: true, signedIn: this.signedIn, uploadRights: true }
  }

  async generateImage(a: FlowImageArgs): Promise<{ file: string; mediaId: string; project?: string }> {
    this.calls.push({ tool: 'flow_generate', args: { ...a, signal: undefined } })
    if (!this.up) throw new FlowError(DOWN, 'unreachable')
    if (this.imageError) throw this.imageError
    if (this.staleAssetRefs && a.references?.some((r) => r.startsWith('asset:'))) throw new FlowError('reference asset:... not found in the Flow project', 'tool')
    const file = path.join(a.out, `${a.name}-01.jpeg`)
    await mkdir(a.out, { recursive: true })
    await writeFile(file, await picture(a.aspect, a.quality))
    return { file, mediaId: `media-${++this.n}`, project: a.project }
  }

  async voices(): Promise<FlowVoices> {
    this.calls.push({ tool: 'flow_voices', args: {} })
    if (!this.up) throw new FlowError(DOWN, 'unreachable')
    return { gemini: GEMINI, geminiModel: 'gemini-3.8-flash-tts', geminiReady: this.geminiReady, windows: this.windowsVoices }
  }

  async narrate(a: NarrateArgs): Promise<{ file: string; durationSec?: number }> {
    this.calls.push({ tool: 'flow_narrate', args: { ...a, signal: undefined } })
    if (!this.up) throw new FlowError(DOWN, 'unreachable')
    if (this.alwaysRateLimited || this.rateLimited > 0) {
      this.rateLimited--
      throw new FlowError(this.rateLimitText, 'rateLimit')
    }
    if (a.text.length > 4000) throw new FlowError(`Text is ${a.text.length} characters; engine "${a.engine}" takes at most 4000.`, 'tool')
    await mkdir(a.out, { recursive: true })
    const file = path.join(a.out, `${a.name}.${a.format}`)
    await writeFile(file, `VOICE:${a.engine}:${a.voice}:${a.text}`)
    return { file, durationSec: 1.5 }
  }

  async song(a: SongArgs): Promise<FlowSong> {
    this.calls.push({ tool: 'music_generate', args: { ...a, signal: undefined } })
    if (!this.up) throw new FlowError(DOWN, 'unreachable')
    if (this.songError) throw this.songError
    await mkdir(a.out, { recursive: true })
    const file = path.join(a.out, `${a.name}.${a.format ?? 'mp3'}`)
    await writeFile(file, `SONG:${a.sound}`)
    return { id: `song-${++this.n}`, file, creditsSpent: 5 }
  }

  async loop(a: { input: string; out: string; name: string }): Promise<FlowLoop> {
    this.calls.push({ tool: 'music_loop', args: { ...a } })
    if (this.loopError) throw this.loopError
    await mkdir(a.out, { recursive: true })
    const file = path.join(a.out, `${a.name}.mp3`)
    await writeFile(file, 'LOOP')
    return { file, loopSeconds: 52, score: this.loopScore, seamClean: true }
  }
}
