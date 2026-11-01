import { afterEach, describe, expect, it } from 'vitest'
import { StudioError, createChiptuneClient } from '../src/engine/studios/chiptune'
import { createMcpClient } from '../src/engine/studios/mcp-http'
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
