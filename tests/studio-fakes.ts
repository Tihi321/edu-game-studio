import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { toneWav } from '../src/engine/assets/wav'
import type { ChiptuneClient, ComposeArgs, ComposeSfxArgs, RenderArgs } from '../src/engine/studios/chiptune'
import { StudioError } from '../src/engine/studios/chiptune'
import type { ImportArgs, ExportItem, PixelClient } from '../src/engine/studios/pixel'
import type { VibeItem, VibeResult, VibeTtsClient, VibeVoices } from '../src/engine/studios/vibetts'

/** What a tool of the fake MCP server answers: its text items (the last is usually the JSON object), or an error. */
export interface FakeTool {
  (args: Record<string, unknown>): { content?: { type: 'text'; text: string }[]; structured?: unknown; isError?: boolean; text?: string }
}

export interface Seen {
  method: string
  body: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
  headers: http.IncomingHttpHeaders
}

/** A tiny in-process MCP server over HTTP: JSON answers, or SSE when `sse` is set. */
export async function fakeMcpServer(opts: { sse?: boolean; tools?: Record<string, FakeTool>; delayMs?: number; status?: number }) {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Seen['body']
      seen.push({ method: req.method ?? '', body, headers: req.headers })
      const reply = () => {
        if (opts.status) {
          res.writeHead(opts.status).end('nope')
          return
        }
        if (body.id === undefined) {
          res.writeHead(202).end()
          return
        }
        let result: unknown
        if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }
        else if (body.method === 'tools/list') result = { tools: Object.keys(opts.tools ?? {}).map((name) => ({ name, description: name })) }
        else {
          const out = opts.tools?.[body.params?.name ?? '']?.(body.params?.arguments ?? {})
          if (!out) {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unknown tool' } }))
            return
          }
          result = { content: out.content ?? [{ type: 'text', text: out.text ?? JSON.stringify(out.structured ?? {}) }], ...(out.structured !== undefined ? { structuredContent: out.structured } : {}), isError: !!out.isError }
        }
        const msg = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
        if (opts.sse) res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`: hello\n\nevent: message\ndata: ${msg}\n\n`)
        else res.writeHead(200, { 'Content-Type': 'application/json' }).end(msg)
      }
      if (opts.delayMs) setTimeout(reply, opts.delayMs)
      else reply()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  return { url, seen, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** The text items of a studio tool: the human-readable part, then the JSON object (the contract's structured result). */
export const studioResult = (human: string, json: unknown) => ({ content: [{ type: 'text' as const, text: human }, { type: 'text' as const, text: JSON.stringify(json) }] })

const DOWN = 'Studio is not running at http://127.0.0.1:1/mcp. Start it headless: cd C:\\fake && yarn build && yarn mcp'

/** Chiptune Studio as a fake client: writes small files where the contract says and records the calls. */
export class FakeChiptune implements ChiptuneClient {
  url = 'http://fake/chiptune'
  down = false
  calls: { tool: string; args: unknown }[] = []
  /** What the render says about the loop. */
  loop: { loopStartSec: number | null; loopEndSec: number | null } = { loopStartSec: 2, loopEndSec: 41.5 }
  /** Pretend ffmpeg is missing: a warning is returned with the wav. (The fake always writes a real PCM wav, next to the asked path with a `.wav` extension: it has no ogg encoder.) */
  noFfmpeg = false
  failSave = false
  private n = 0
  private check() {
    if (this.down) throw new StudioError(DOWN, 'unreachable')
  }
  async composeTrack(args: ComposeArgs) {
    this.check()
    this.calls.push({ tool: 'compose_track', args })
    const id = `song-${++this.n}`
    return { songId: id, name: args.name ?? id, chip: args.chip ?? 'snes', bpm: args.bpm ?? 72, key: args.key ?? 'C', mood: args.mood, bars: args.bars ?? 16, seed: args.seed ?? 4242, durationSec: 41.5, loop: { startBar: 1, endBar: args.bars ?? 16 }, channels: ['a', 'b'] }
  }
  async composeSfx(args: ComposeSfxArgs) {
    this.check()
    this.calls.push({ tool: 'compose_sfx', args })
    const id = `song-${++this.n}`
    const actual = args.path.replace(/\.[^.]+$/, '.wav')
    await mkdir(path.dirname(actual), { recursive: true })
    await writeFile(actual, toneWav(args.kind === 'ambience' ? 1 : 0.3, 500 + args.sound.length * 40))
    const ambience = args.kind === 'ambience'
    return { songId: id, kind: args.kind, sound: args.sound, chip: args.chip ?? (ambience ? 'snes' : 'nes'), seed: args.seed ?? 777, durationSec: ambience ? (args.seconds ?? 16) : 0.4, loop: ambience ? { startBar: 1, endBar: 8 } : null, path: actual, loopStartSec: ambience ? 0 : null, loopEndSec: ambience ? (args.seconds ?? 16) : null, ...(this.noFfmpeg ? { warning: 'ffmpeg not found: wrote wav' } : {}) }
  }
  async renderAudio(args: RenderArgs) {
    this.check()
    this.calls.push({ tool: 'render_audio', args })
    const actual = args.path.replace(/\.[^.]+$/, '.wav')
    await mkdir(path.dirname(actual), { recursive: true })
    await writeFile(actual, toneWav(1, 330))
    return { path: actual, format: 'wav', sampleRate: 44100, durationSec: 41.5, ...this.loop, ...(this.noFfmpeg ? { warning: 'ffmpeg not found: wrote wav' } : {}) }
  }
  async saveSong(args: { song?: string; path: string }) {
    this.check()
    this.calls.push({ tool: 'save_song', args })
    if (this.failSave) throw new StudioError('disk full', 'tool')
    await mkdir(path.dirname(args.path), { recursive: true })
    await writeFile(args.path, JSON.stringify({ song: args.song }))
    return { songId: args.song ?? 'x', path: args.path }
  }
  async listSongs() {
    this.check()
    return []
  }
  async openSong(args: { path: string; exportTo?: string }) {
    this.check()
    this.calls.push({ tool: 'open_song', args })
    return { songId: 's', name: 's', path: args.path }
  }
  async deleteSong(song: string) {
    this.check()
    this.calls.push({ tool: 'delete_song', args: { song } })
    return { deleted: true }
  }
  async listTools() {
    this.check()
    return [{ name: 'compose_track' }]
  }
}

/**
 * Pixel Studio as a fake client: `import_image` downsamples with nearest-neighbour into an in-memory document, the exports write it at the asked
 * size, so the files have the exact sizes the contract promises. Records the calls.
 */
export class FakePixel implements PixelClient {
  url = 'http://fake/pixel'
  down = false
  calls: { tool: string; args: unknown }[] = []
  /** `draw_grid` and friends: how many calls were made. */
  drawCalls = 0
  private docs = new Map<string, Buffer>()
  private n = 0
  private check() {
    if (this.down) throw new StudioError(DOWN, 'unreachable')
  }
  async importImage(args: ImportArgs) {
    this.check()
    this.calls.push({ tool: 'import_image', args })
    const w = args.width ?? 32
    const h = args.height ?? 32
    const small = await sharp(args.path).resize(w, h, { kernel: 'nearest', fit: 'fill' }).ensureAlpha().png().toBuffer()
    const id = `doc-${++this.n}`
    this.docs.set(id, small)
    return { documentId: id, name: args.name ?? id, width: w, height: h, colors: 4, transparentPixels: 0 }
  }
  async exportPng(args: { document?: string; path: string; width?: number; height?: number }) {
    this.check()
    await this.exportMany([{ document: args.document, path: args.path, width: args.width, height: args.height }])
    return { paths: [args.path], width: args.width ?? 0, height: args.height ?? 0 }
  }
  async exportMany(items: ExportItem[]) {
    this.check()
    this.calls.push({ tool: 'export_many', args: items })
    const paths: string[] = []
    for (const it of items) {
      const doc = this.docs.get(it.document ?? `doc-${this.n}`)
      if (!doc) throw new StudioError(`no document ${it.document}`, 'tool')
      await mkdir(path.dirname(it.path), { recursive: true })
      const img = it.width && it.height ? await sharp(doc).resize(it.width, it.height, { kernel: 'nearest', fit: 'fill' }).png().toBuffer() : doc
      await writeFile(it.path, img)
      paths.push(it.path)
    }
    return { paths }
  }
  async drawSpriteFromReference(args: { reference: string; width: number; height: number; palette: string | string[]; expression?: string; name?: string }) {
    this.check()
    this.calls.push({ tool: 'draw_sprite_from_reference', args })
    const id = `doc-${++this.n}`
    // an empty document: draw_grid then paints it
    this.docs.set(id, await sharp({ create: { width: args.width, height: args.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer())
    return { documentId: id, name: args.name ?? id, width: args.width, height: args.height, palette: Array.isArray(args.palette) ? args.palette : [], referenceLayerId: 'ref', guidance: 'Draw with draw_grid.' }
  }
  async listDocuments() {
    this.check()
    return []
  }
  async openDocument(args: { path: string }) {
    this.check()
    this.calls.push({ tool: 'open_document', args })
    return { documentId: 'd', name: 'd', width: 1, height: 1, path: args.path }
  }
  async saveDocument(args: { path?: string }) {
    this.check()
    return { documentId: 'd', path: args.path ?? 'x' }
  }
  async callTool(name: string, args: object) {
    this.check()
    this.calls.push({ tool: name, args })
    if (name === 'draw_grid') {
      this.drawCalls++
      const id = `doc-${this.n}`
      const doc = this.docs.get(id)!
      const meta = await sharp(doc).metadata()
      // paint the whole sprite one colour, so the export has opaque pixels
      this.docs.set(id, await sharp({ create: { width: meta.width!, height: meta.height!, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer())
    }
    return { text: `${name} ok`, human: `${name} ok`, json: {} }
  }
  async listTools() {
    this.check()
    return [{ name: 'import_image' }, { name: 'draw_grid' }]
  }
}

/**
 * VibeTTS as a fake client (EGS-17): `list_voices` answers the voices of `voices` (Kokoro reads English, Supertonic English and Croatian), `synthesize_batch`
 * writes a real PCM wav (a tone) for every clip and records the calls. `down` makes every call fail as the real client does when the tray app is not running.
 */
export class FakeVibeTts implements VibeTtsClient {
  url = 'http://fake/vibetts'
  down = false
  calls: { tool: string; args: unknown }[] = []
  /** Texts whose clip fails on its own (the rest of the batch goes on). */
  failTexts = new Set<string>()
  voices: VibeVoices = {
    voices: [
      { id: 'am_michael', label: 'Michael', engine: 'kokoro', languages: ['en'] },
      { id: 'af_heart', label: 'Heart', engine: 'kokoro', languages: ['en'] },
      { id: 'supertonic:F1', label: 'Supertonic F1', engine: 'supertonic', languages: ['en', 'hr', 'de'] }
    ],
    languages: [
      { code: 'en', name: 'English' },
      { code: 'hr', name: 'Croatian' },
      { code: 'de', name: 'German' }
    ],
    languageVoices: { en: 'am_michael', hr: 'supertonic:F1' },
    readLanguage: 'auto',
    supertonicInstalled: true,
    higgsInstalled: false
  }
  private check(): void {
    if (this.down) throw new StudioError('VibeTTS is not running at http://fake/vibetts. Start the VibeTTS app (it sits in the tray) and turn its MCP server on; Edu Studio never starts it.', 'unreachable')
  }
  async listVoices(): Promise<VibeVoices> {
    this.check()
    this.calls.push({ tool: 'list_voices', args: {} })
    return this.voices
  }
  /** The clips this fake spoke, in order (the texts of every batch). */
  get spoken(): VibeItem[] {
    return this.calls.filter((c) => c.tool === 'synthesize_batch').flatMap((c) => (c.args as { items: VibeItem[] }).items)
  }
  async synthesizeBatch(items: VibeItem[], o: { overwrite?: boolean } = {}): Promise<VibeResult[]> {
    this.check()
    this.calls.push({ tool: 'synthesize_batch', args: { items, ...(o.overwrite !== undefined ? { overwrite: o.overwrite } : {}) } })
    const out: VibeResult[] = []
    for (const it of items) {
      if (this.failTexts.has(it.text)) {
        out.push({ output: it.output, ok: false, error: 'the engine failed on this text' })
        continue
      }
      await mkdir(path.dirname(it.output), { recursive: true })
      // real, decodable audio (the file is a wav whatever extension was asked for)
      await writeFile(it.output, toneWav(0.4, 300 + (it.text.length % 9) * 40))
      out.push({ output: it.output, ok: true, durationS: 0.4 })
    }
    return out
  }
  async synthesizeToFile(item: VibeItem & { format?: 'wav' | 'mp3'; overwrite?: boolean }): Promise<VibeResult> {
    this.check()
    this.calls.push({ tool: 'synthesize_to_file', args: item })
    await mkdir(path.dirname(item.output), { recursive: true })
    await writeFile(item.output, toneWav(0.4, 330))
    return { output: item.output, ok: true, durationS: 0.4 }
  }
  async listTools() {
    this.check()
    return [{ name: 'list_voices' }, { name: 'synthesize_batch' }]
  }
}
