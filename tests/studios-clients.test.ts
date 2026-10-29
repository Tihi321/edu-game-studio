import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioError, createChiptuneClient } from '../src/engine/studios/chiptune'
import { chiptuneClientFor, loadStudiosConfig, pixelClientFor, startHint, studioToken, studiosConfigSchema } from '../src/engine/studios/config'
import { McpHttpError, createMcpClient, parseResultJson, resolveToken } from '../src/engine/studios/mcp-http'
import { createPixelClient } from '../src/engine/studios/pixel'
import { fakeMcpServer, studioResult } from './studio-fakes'

let closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})
async function serve(opts: Parameters<typeof fakeMcpServer>[0]) {
  const s = await fakeMcpServer(opts)
  closers.push(s.close)
  return s
}
const mcp = (url: string) => createMcpClient({ url, label: 'Fake', notRunningHint: 'start the fake', timeoutMs: 2000 })

describe('generic MCP HTTP client', () => {
  it('initializes once, calls tools and parses the last JSON object text item (plain JSON answers)', async () => {
    const s = await serve({ tools: { tool_a: () => studioResult('Done. A human sentence.', { songId: 'x1', n: 3 }) } })
    const c = mcp(s.url)
    const a = await c.callTool('tool_a', { q: 1 })
    await c.callTool('tool_a', {})
    expect(a.json).toEqual({ songId: 'x1', n: 3 })
    expect(a.text).toContain('A human sentence.')
    expect(s.seen.map((x) => x.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
    expect(s.seen[2]!.body.params).toEqual({ name: 'tool_a', arguments: { q: 1 } })
    expect(s.seen[2]!.headers['mcp-protocol-version']).toBe('2025-06-18')
  })

  it('reads SSE answers too', async () => {
    const s = await serve({ sse: true, tools: { tool_a: () => studioResult('hi', { ok: true }) } })
    expect((await mcp(s.url).callTool('tool_a', {})).json).toEqual({ ok: true })
  })

  it('lists tools', async () => {
    const s = await serve({ tools: { a: () => ({}), b: () => ({}) } })
    expect((await mcp(s.url).listTools()).map((t) => t.name)).toEqual(['a', 'b'])
  })

  it('json is null for a text-only answer, structuredContent wins, and an isError result throws a tool error', async () => {
    const s = await serve({
      tools: {
        plain: () => ({ text: 'just words' }),
        both: () => ({ content: [{ type: 'text', text: '{"from":"text"}' }], structured: { from: 'structured' } }),
        bad: () => ({ isError: true, text: 'the song is missing' })
      }
    })
    const c = mcp(s.url)
    expect((await c.callTool('plain', {})).json).toBeNull()
    expect((await c.callTool('both', {})).json).toEqual({ from: 'structured' })
    await expect(c.callTool('bad', {})).rejects.toMatchObject({ name: 'McpHttpError', kind: 'tool', message: 'the song is missing' })
  })

  it('says how to start the app when nothing answers, and times out on a slow one', async () => {
    const c = mcp('http://127.0.0.1:1/mcp')
    await expect(c.callTool('x', {})).rejects.toMatchObject({ kind: 'unreachable', message: 'start the fake' })
    const slow = await serve({ delayMs: 300, tools: { x: () => ({}) } })
    await expect(createMcpClient({ url: slow.url, label: 'Fake', notRunningHint: 'h', timeoutMs: 80 }).callTool('x', {})).rejects.toBeInstanceOf(McpHttpError)
  })

  it('parseResultJson takes the last item that is an object, not an array or a number', () => {
    expect(parseResultJson([{ type: 'text', text: '{"a":1}' }, { type: 'text', text: '[1,2]' }, { type: 'text', text: '42' }])).toEqual({ a: 1 })
    expect(parseResultJson([{ type: 'text', text: '{"a":1}' }, { type: 'text', text: '{"b":2}' }])).toEqual({ b: 2 })
    expect(parseResultJson([{ type: 'image' }])).toBeNull()
  })
})

describe('Chiptune Studio client (against a fake MCP server)', () => {
  it('compose_track, render_audio, save_song, open_song, delete_song and list_songs follow the contract', async () => {
    const s = await serve({
      tools: {
        compose_track: (a) => studioResult('Composed.', { songId: 's1', name: 'n', chip: a.chip, bpm: a.bpm, key: a.key, mood: a.mood, bars: a.bars, seed: 99, durationSec: 40, loop: { startBar: 0, endBar: a.bars }, channels: [] }),
        render_audio: (a) => studioResult('Rendered.', { path: a.path, format: 'ogg', sampleRate: 44100, durationSec: 40, loopStartSec: 1.5, loopEndSec: 40 }),
        save_song: (a) => studioResult('Saved.', { songId: a.song, path: a.path }),
        open_song: (a) => studioResult('Opened.', { songId: 's1', name: 'n', path: a.path }),
        delete_song: () => studioResult('Deleted.', { deleted: true }),
        list_songs: () => studioResult('1 song', { songs: [{ songId: 's1', name: 'n', path: null, chip: 'snes', bpm: 70, current: true }] })
      }
    })
    const c = createChiptuneClient({ url: s.url, notRunningHint: 'hint', timeoutMs: 2000 })
    const composed = await c.composeTrack({ mood: 'peaceful', chip: 'snes', bpm: 72, key: 'C', bars: 16, seed: 5 })
    expect(composed).toMatchObject({ songId: 's1', seed: 99, bars: 16 })
    const call = s.seen.find((x) => x.body.params?.name === 'compose_track')!
    expect(call.body.params!.arguments).toMatchObject({ mood: 'peaceful', loop: true, seed: 5 })
    const r = await c.renderAudio({ song: 's1', path: 'C:\\x\\v1.ogg' })
    expect(r).toMatchObject({ path: 'C:\\x\\v1.ogg', loopStartSec: 1.5, loopEndSec: 40 })
    expect(s.seen.find((x) => x.body.params?.name === 'render_audio')!.body.params!.arguments).toMatchObject({ format: 'ogg' })
    expect(await c.saveSong({ song: 's1', path: 'C:\\x\\v1.song' })).toEqual({ songId: 's1', path: 'C:\\x\\v1.song' })
    expect(await c.openSong({ path: 'p', exportTo: 'e', exportFormat: 'ogg' })).toMatchObject({ songId: 's1' })
    expect(await c.deleteSong('s1')).toEqual({ deleted: true })
    expect((await c.listSongs())[0]).toMatchObject({ songId: 's1', current: true })
    expect((await c.listTools()).map((t) => t.name)).toContain('compose_track')
  })

  it('a result without the contract fields is a contract error, a down studio a StudioError with the hint', async () => {
    const s = await serve({ tools: { compose_track: () => ({ text: 'Composed (old studio, no JSON)' }) } })
    await expect(createChiptuneClient({ url: s.url, notRunningHint: 'h', timeoutMs: 2000 }).composeTrack({ mood: 'calm' })).rejects.toMatchObject({ name: 'StudioError', kind: 'contract' })
    const down = createChiptuneClient({ url: 'http://127.0.0.1:1/mcp', notRunningHint: 'Chiptune Studio is not running at x. Start it headless: cd C:\\midi && yarn build && yarn mcp', timeoutMs: 500 })
    const err = await down.composeTrack({ mood: 'calm' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StudioError)
    expect((err as StudioError).kind).toBe('unreachable')
    expect((err as StudioError).message).toContain('yarn build && yarn mcp')
  })
})

describe('Pixel Studio client (against a fake MCP server)', () => {
  it('import_image, export_png, export_many, draw_sprite_from_reference (guidance from the text), documents', async () => {
    const s = await serve({
      tools: {
        import_image: (a) => studioResult('Imported.', { documentId: 'd1', name: 'n', width: a.width, height: a.height, colors: 12, transparentPixels: 0 }),
        export_png: (a) => studioResult('Exported.', { paths: [a.path], width: a.width, height: a.height }),
        export_many: (a) => studioResult('Exported.', { paths: (a.items as { path: string }[]).map((i) => i.path) }),
        draw_sprite_from_reference: (a) => studioResult('Use draw_grid with these colours.', { documentId: 'd2', name: 'spr', width: a.width, height: a.height, palette: ['#000000'], referenceLayerId: 'l1' }),
        list_documents: () => studioResult('1', { documents: [{ documentId: 'd1', name: 'n', width: 1, height: 1, path: null, current: true, dirty: false }] }),
        open_document: (a) => studioResult('Opened.', { documentId: 'd3', name: 'n', width: 4, height: 4, path: a.path }),
        save_document: (a) => studioResult('Saved.', { documentId: 'd1', path: 'C:\\p.pxs', exported: a.path }),
        draw_grid: () => ({ text: 'drawn' })
      }
    })
    const c = createPixelClient({ url: s.url, notRunningHint: 'h', timeoutMs: 2000 })
    expect(await c.importImage({ path: 'C:\\in.png', width: 320, height: 180, dither: 'floyd', palette: ['#000000', '#ffffff'] })).toMatchObject({ documentId: 'd1', width: 320, height: 180 })
    expect(s.seen.find((x) => x.body.params?.name === 'import_image')!.body.params!.arguments).toMatchObject({ dither: 'floyd', palette: ['#000000', '#ffffff'] })
    expect(await c.exportPng({ path: 'C:\\o.png', width: 1920, height: 1080 })).toMatchObject({ paths: ['C:\\o.png'], width: 1920 })
    expect(await c.exportMany([{ path: 'a.png' }, { path: 'b.png', scale: 1 }])).toEqual({ paths: ['a.png', 'b.png'] })
    const d = await c.drawSpriteFromReference({ reference: 'C:\\r.png', width: 64, height: 96, palette: ['#000000'] })
    expect(d).toMatchObject({ documentId: 'd2', referenceLayerId: 'l1', guidance: 'Use draw_grid with these colours.' })
    expect((await c.listDocuments())[0]!.current).toBe(true)
    expect(await c.openDocument({ path: 'p.png', exportTo: 'e.png' })).toMatchObject({ documentId: 'd3' })
    expect(await c.saveDocument({})).toMatchObject({ path: 'C:\\p.pxs' })
    expect((await c.callTool('draw_grid', { x: 0 })).text).toBe('drawn')
  })
})

describe('studios config (config/studios.md)', () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('has the contract URLs and repos by default, and env variables override the URLs', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'edu-studios-'))
    const c = await loadStudiosConfig(dir, {})
    expect(c.pixelStudioUrl).toBe('http://127.0.0.1:7457/mcp')
    expect(c.chiptuneStudioUrl).toBe('http://127.0.0.1:7458/mcp')
    expect(c.pixelStudioRepo).toBe('../pixel-art-generator')
    expect(c.chiptuneStudioRepo).toBe('../midi-generator')
    const o = await loadStudiosConfig(dir, { EDU_PIXEL_STUDIO_URL: 'http://x:1/mcp', EDU_CHIPTUNE_STUDIO_URL: 'http://y:2/mcp' })
    expect([o.pixelStudioUrl, o.chiptuneStudioUrl]).toEqual(['http://x:1/mcp', 'http://y:2/mcp'])
  })

  it('reads the seeded file (backslash paths included) and the start hint is the contract text', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'edu-studios-'))
    await mkdir(path.join(dir, 'config'), { recursive: true })
    await writeFile(path.join(dir, 'config', 'studios.md'), await (await import('node:fs/promises')).readFile(path.resolve(__dirname, '..', 'seed', 'config', 'studios.md'), 'utf8'))
    const c = await loadStudiosConfig(dir, {})
    expect(c).toMatchObject({ pixelStudioRepo: '../pixel-art-generator', chiptuneStudioRepo: '../midi-generator', drawSteps: 12 })
    expect(startHint(c, 'pixel')).toBe('Pixel Studio is not running at http://127.0.0.1:7457/mcp. Start it headless: cd ../pixel-art-generator && yarn build && yarn mcp')
    expect(startHint({ ...c, chiptuneStudioExe: 'C:\\apps\\Chiptune.exe' }, 'chiptune')).toContain('C:\\apps\\Chiptune.exe --mcp-only')
    expect(pixelClientFor(c).url).toBe(c.pixelStudioUrl)
    expect(chiptuneClientFor(c).url).toBe(c.chiptuneStudioUrl)
  })

  it('a broken file gives the defaults', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'edu-studios-'))
    await mkdir(path.join(dir, 'config'), { recursive: true })
    await writeFile(path.join(dir, 'config', 'studios.md'), '---\ntimeoutS: -5\n---\n')
    expect(await loadStudiosConfig(dir, {})).toEqual(studiosConfigSchema.parse({}))
  })
})

describe('studio tokens (V5)', () => {
  const tools = { tool_a: () => studioResult('ok', { n: 1 }) }

  it('sends Authorization: Bearer on every request when a token is set, and nothing when not', async () => {
    const s = await serve({ tools })
    const withToken = createMcpClient({ url: s.url, label: 'Fake', notRunningHint: 'x', timeoutMs: 2000, token: 'abc123' })
    await withToken.callTool('tool_a', {})
    expect(s.seen).toHaveLength(3)
    expect(s.seen.every((x) => x.headers.authorization === 'Bearer abc123')).toBe(true)
    const before = s.seen.length
    await mcp(s.url).callTool('tool_a', {})
    expect(s.seen.slice(before).every((x) => x.headers.authorization === undefined)).toBe(true)
  })

  it('a 401 says which variable to set', async () => {
    const s = await serve({ tools, status: 401 })
    const pixel = createPixelClient({ url: s.url, notRunningHint: 'x', timeoutMs: 2000, token: 'wrong' })
    await expect(pixel.listDocuments()).rejects.toThrow('Pixel Studio rejected the token: set PIXEL_STUDIO_MCP_TOKEN to the token shown in its Settings -> MCP')
    const chip = createChiptuneClient({ url: s.url, notRunningHint: 'x', timeoutMs: 2000 })
    await expect(chip.listSongs()).rejects.toMatchObject({ name: 'StudioError', kind: 'http', message: expect.stringContaining('CHIPTUNE_STUDIO_MCP_TOKEN') })
  })

  it('the environment wins over the credential store, which wins over config/studios.md', () => {
    const c = studiosConfigSchema.parse({ pixelStudioToken: 'from-config', chiptuneStudioToken: 'chip-config' })
    const store = (account: string) => (account === 'PIXEL_STUDIO_MCP_TOKEN' ? 'from-store' : undefined)
    expect(studioToken(c, 'pixel', { PIXEL_STUDIO_MCP_TOKEN: 'from-env' }, store)).toBe('from-env')
    expect(studioToken(c, 'pixel', {}, store)).toBe('from-store')
    expect(studioToken(c, 'pixel', {}, () => undefined)).toBe('from-config')
    expect(studioToken(c, 'chiptune', {}, store)).toBe('chip-config')
    expect(studioToken(studiosConfigSchema.parse({}), 'chiptune', {}, () => undefined)).toBeNull()
    expect(resolveToken('SOME_MCP_TOKEN', '  spaced  ', {}, () => undefined)).toBe('spaced')
  })
})
