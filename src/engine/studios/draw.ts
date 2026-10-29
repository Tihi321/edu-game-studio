import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { Rgb } from '../assets/palettes'
import type { ChatMessage } from '../models/types'
import { extractJson } from '../pipeline/llm'
import { StudioError } from './chiptune'
import type { PixelClient } from './pixel'

/** The Pixel Studio tools the drawing agent may call (never the file tools: the loop owns the export). */
export const DRAW_TOOLS = /^(draw_(?!sprite_from_reference)[a-z_]+|fill[a-z_]*|erase[a-z_]*|set_pixels?|remap_to_palette)$/

/** Asks the model and returns its reply (`schema`: the JSON schema of the answer, which a client queue checks on submit). Throws when no model answers. */
export type ModelReply = (messages: ChatMessage[], schema?: Record<string, unknown>) => Promise<string>

export interface DrawSpriteOptions {
  client: PixelClient
  /** Asks the model and returns its reply. Throws when no model answers. */
  ask(messages: ChatMessage[]): Promise<string>
  /** Absolute path of the reference image (the cut-out sprite as a PNG). */
  reference: string
  grid: { w: number; h: number }
  palette: Rgb[]
  expression?: string
  name?: string
  /** The size of the result: the drawing scaled up with nearest-neighbour. */
  out: { w: number; h: number }
  tmpRoot: string
  /** At most this many model steps and milliseconds. */
  maxSteps: number
  maxMs: number
  signal?: AbortSignal
  now?: () => number
  log?: (m: string) => void
}

export interface DrawnSprite {
  png: Buffer
  native: Buffer
  steps: number
  calls: number
}

const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

interface Step {
  calls?: { tool?: string; arguments?: Record<string, unknown> }[]
  done?: boolean
}

const SYSTEM = `You draw a small pixel-art sprite in Pixel Studio by calling its tools. Reply with ONE JSON object and nothing else:
{"calls": [{"tool": "draw_grid", "arguments": { ... }}], "done": false}
Set "done": true when the sprite is finished (you may send the last calls and "done": true together). Allowed tools: draw_grid and the other drawing tools named in the guidance. Draw in a few big steps (the body, then the face and the details), keep to the palette, leave the background transparent, and keep the drawing readable at this small size. A hidden reference layer holds the picture to copy.`

/**
 * An agent loop that draws a sprite in Pixel Studio: `draw_sprite_from_reference` makes the document (palette, size, hidden reference
 * layer) and returns the guidance, then the model calls `draw_grid` and friends (one JSON step per turn) until it says it is done, or
 * the steps or time run out. The drawing is exported at the grid size and scaled up. Throws when the model never answers or draws
 * nothing, so the caller can fall back to the import path.
 */
export async function drawSpriteWithStudio(o: DrawSpriteOptions): Promise<DrawnSprite> {
  const now = o.now ?? Date.now
  const end = now() + o.maxMs
  const doc = await o.client.drawSpriteFromReference({ reference: o.reference, width: o.grid.w, height: o.grid.h, palette: o.palette.map(hex), expression: o.expression, name: o.name }, o.signal)
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\n${doc.guidance}` },
    { role: 'user', content: `Document ${doc.documentId} is open: ${doc.width}x${doc.height} pixels, palette ${doc.palette.join(' ')}.${o.expression ? ` Expression: ${o.expression}.` : ''} Start drawing.` }
  ]
  let steps = 0
  let calls = 0
  while (steps < o.maxSteps && now() < end) {
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const reply = await o.ask(messages)
    steps++
    let step: Step
    try {
      step = extractJson(reply) as Step
    } catch (e) {
      messages.push({ role: 'assistant', content: reply.slice(0, 2000) }, { role: 'user', content: `That was not one JSON object (${(e as Error).message}). Reply with only the JSON object.` })
      continue
    }
    const results: string[] = []
    for (const c of step.calls ?? []) {
      const tool = String(c.tool ?? '')
      if (!DRAW_TOOLS.test(tool)) {
        results.push(`${tool || '(no tool)'}: not allowed`)
        continue
      }
      try {
        const r = await o.client.callTool(tool, c.arguments ?? {}, o.signal)
        calls++
        results.push(`${tool}: ok ${r.text.slice(0, 200)}`)
      } catch (e) {
        if (o.signal?.aborted) throw e
        results.push(`${tool}: error ${(e as Error).message.slice(0, 300)}`)
      }
    }
    o.log?.(`draw step ${steps}: ${results.join(' | ').slice(0, 300)}`)
    if (step.done) break
    messages.push({ role: 'assistant', content: JSON.stringify(step).slice(0, 4000) }, { role: 'user', content: `Results:\n${results.join('\n') || '(no calls)'}\nContinue, or set "done": true.` })
  }
  if (calls === 0) throw new Error('the agent drew nothing in Pixel Studio')

  const dir = path.resolve(o.tmpRoot, `draw-${randomBytes(4).toString('hex')}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    const big = path.join(dir, 'out.png')
    const small = path.join(dir, 'native.png')
    await o.client.exportMany(
      [
        { document: doc.documentId, path: big, width: o.out.w, height: o.out.h },
        { document: doc.documentId, path: small, scale: 1 }
      ],
      o.signal
    )
    let png = await fs.readFile(big)
    const meta = await sharp(png).metadata()
    if (meta.width !== o.out.w || meta.height !== o.out.h) png = await sharp(png).resize(o.out.w, o.out.h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer()
    return { png, native: await fs.readFile(small), steps, calls }
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

// ---- grid mode: one model request, no time limit ----

/** The characters of a palette index, as Pixel Studio's `draw_grid` reads them without a legend (0-9, a-z, A-Z). `.` is transparent. */
export const GRID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** The side of the biggest `draw_grid` call. A bigger sprite is painted in tiles. */
export const GRID_TILE = 64

export interface DrawGridOptions {
  /** Pixel Studio. Without it, or when it is not running, the PNG is built here from the rows (with a warning). */
  client?: PixelClient | null
  ask(messages: ChatMessage[], schema?: Record<string, unknown>): Promise<string>
  /** Absolute path of the reference image (the cut-out sprite as a PNG). */
  reference: string
  grid: { w: number; h: number }
  palette: Rgb[]
  expression?: string
  name?: string
  /** The size of the result: the drawing scaled up with nearest-neighbour. */
  out: { w: number; h: number }
  tmpRoot: string
  signal?: AbortSignal
  log?: (m: string) => void
}

export interface DrawnGrid extends DrawnSprite {
  /** The PNG was built here: Pixel Studio was not running. */
  local: boolean
}

/** The reference quantized to the palette at the grid size: rows of characters, and the palette those characters index. */
export async function quantizeToGrid(reference: Buffer | string, grid: { w: number; h: number }, palette: Rgb[]): Promise<{ rows: string[]; palette: Rgb[] }> {
  const raw = await sharp(reference).resize(grid.w, grid.h, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer()
  const nearest = (pal: Rgb[], r: number, g: number, b: number): number => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < pal.length; i++) {
      const c = pal[i]!
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }
  let pal = palette
  if (palette.length > GRID_ALPHABET.length) {
    // more colours than characters: keep the ones the picture uses most
    const counts = new Array<number>(palette.length).fill(0)
    for (let i = 0; i < raw.length; i += 4) if (raw[i + 3]! >= 128) counts[nearest(palette, raw[i]!, raw[i + 1]!, raw[i + 2]!)]!++
    pal = counts
      .map((n, i) => ({ n, i }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, GRID_ALPHABET.length)
      .map((x) => palette[x.i]!)
  }
  const rows: string[] = []
  for (let y = 0; y < grid.h; y++) {
    let row = ''
    for (let x = 0; x < grid.w; x++) {
      const i = (y * grid.w + x) * 4
      row += raw[i + 3]! < 128 ? '.' : GRID_ALPHABET[nearest(pal, raw[i]!, raw[i + 1]!, raw[i + 2]!)]!
    }
    rows.push(row)
  }
  return { rows, palette: pal }
}

/** What is wrong with an answer's rows: the wrong number of rows, a row of the wrong length, a character that is not in the alphabet. */
export function checkRows(rows: unknown, grid: { w: number; h: number }, colours: number): string[] {
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'string')) return ['"rows" must be an array of strings']
  const problems: string[] = []
  const allowed = `.${GRID_ALPHABET.slice(0, colours)}`
  if (rows.length !== grid.h) problems.push(`there must be exactly ${grid.h} rows, there are ${rows.length}`)
  rows.forEach((r: string, i) => {
    if ([...r].length !== grid.w) problems.push(`row ${i + 1} has ${[...r].length} characters, it must have exactly ${grid.w}`)
    const bad = [...new Set([...r].filter((c) => !allowed.includes(c)))]
    if (bad.length) problems.push(`row ${i + 1} uses ${bad.map((c) => JSON.stringify(c)).join(', ')}, which is not in the alphabet`)
  })
  return problems.slice(0, 8)
}

const gridSchema = (grid: { w: number; h: number }, colours: number): Record<string, unknown> => ({
  type: 'object',
  properties: { rows: { type: 'array', minItems: grid.h, maxItems: grid.h, items: { type: 'string', minLength: grid.w, maxLength: grid.w, pattern: `^[.${GRID_ALPHABET.slice(0, colours)}]*$` } } },
  required: ['rows']
})

const GRID_SYSTEM = (grid: { w: number; h: number }, legend: string): string =>
  `You clean up a small pixel-art sprite that is written as text. The grid is ${grid.w} pixels wide and ${grid.h} high: one character per pixel, rows from top to bottom. "." is a transparent pixel; every other character is a palette colour: ${legend}. You get the reference picture already reduced to this palette and size; make it a clean sprite: remove stray pixels, make outlines continuous and one pixel wide, keep the figure's proportions, colours and pose, and keep the background transparent. Reply with ONE JSON object and nothing else: {"rows": ["...", "..."]} with exactly ${grid.h} rows of exactly ${grid.w} characters each.`

const hexOf = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** The sprite as a PNG built from the rows (the palette colours, transparent for ".") at the grid size. */
async function pngFromRows(rows: string[], grid: { w: number; h: number }, palette: Rgb[]): Promise<Buffer> {
  const raw = Buffer.alloc(grid.w * grid.h * 4)
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      const at = GRID_ALPHABET.indexOf(ch)
      const c = at >= 0 ? palette[at] : undefined
      if (c) raw.set([c[0], c[1], c[2], 255], (y * grid.w + x) * 4)
    })
  })
  return sharp(raw, { raw: { width: grid.w, height: grid.h, channels: 4 } }).png().toBuffer()
}

/**
 * Draws a sprite with ONE model request and no time limit, for a model that takes minutes per answer (a client model): the reference is
 * reduced to the palette at the grid size and sent as rows of characters; the model answers `{rows}` (the same grid, cleaned up), which
 * is checked (one repair round) and painted into a Pixel Studio document with `draw_grid` calls of at most 64x64 pixels, then exported
 * like the loop does. When Pixel Studio is not running the PNG is built here from the rows. Throws when the rows do not fit after the repair.
 */
export async function drawSpriteFromGrid(o: DrawGridOptions): Promise<DrawnGrid> {
  const reference = await fs.readFile(o.reference)
  const q = await quantizeToGrid(reference, o.grid, o.palette)
  const legend = q.palette.map((c, i) => `${GRID_ALPHABET[i]} = ${hexOf(c)}`).join(', ')
  const messages: ChatMessage[] = [
    { role: 'system', content: GRID_SYSTEM(o.grid, legend) },
    { role: 'user', content: `${o.expression ? `Expression: ${o.expression}.\n` : ''}Reference, ${o.grid.w}x${o.grid.h}:\n${q.rows.join('\n')}` }
  ]
  const schema = gridSchema(o.grid, q.palette.length)
  let rows: string[] | undefined
  let steps = 0
  for (let attempt = 0; attempt < 2 && !rows; attempt++) {
    if (o.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const reply = await o.ask(messages, schema)
    steps++
    let problems: string[]
    let answer: unknown
    try {
      answer = (extractJson(reply) as { rows?: unknown }).rows
      problems = checkRows(answer, o.grid, q.palette.length)
    } catch (e) {
      problems = [`that was not one JSON object (${(e as Error).message})`]
    }
    if (!problems.length) rows = answer as string[]
    else {
      o.log?.(`draw grid answer ${steps} refused: ${problems.join('; ')}`)
      if (attempt === 1) throw new Error(`the model's rows do not fit the ${o.grid.w}x${o.grid.h} grid: ${problems.join('; ')}`)
      messages.push({ role: 'assistant', content: reply.slice(0, 6000) }, { role: 'user', content: `Problems: ${problems.join('; ')}. Fix them and reply with the corrected JSON object only.` })
    }
  }
  const final = rows!
  const finish = async (native: Buffer, local: boolean, calls: number): Promise<DrawnGrid> => ({
    png: await sharp(native).resize(o.out.w, o.out.h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer(),
    native,
    steps,
    calls,
    local
  })
  if (o.client) {
    try {
      const doc = await o.client.drawSpriteFromReference({ reference: o.reference, width: o.grid.w, height: o.grid.h, palette: q.palette.map(hexOf), expression: o.expression, name: o.name }, o.signal)
      let calls = 0
      for (let y = 0; y < o.grid.h; y += GRID_TILE) {
        for (let x = 0; x < o.grid.w; x += GRID_TILE) {
          const tile = final.slice(y, y + GRID_TILE).map((r) => [...r].slice(x, x + GRID_TILE).join(''))
          if (tile.every((r) => /^\.*$/.test(r))) continue // nothing to paint in this tile
          await o.client.callTool('draw_grid', { rows: tile, x, y, transparent: 'clear' }, o.signal)
          calls++
        }
      }
      if (calls === 0) throw new Error('the model drew nothing: every row is transparent')
      const dir = path.resolve(o.tmpRoot, `draw-${randomBytes(4).toString('hex')}`)
      await fs.mkdir(dir, { recursive: true })
      try {
        const big = path.join(dir, 'out.png')
        const small = path.join(dir, 'native.png')
        await o.client.exportMany(
          [
            { document: doc.documentId, path: big, width: o.out.w, height: o.out.h },
            { document: doc.documentId, path: small, scale: 1 }
          ],
          o.signal
        )
        let png = await fs.readFile(big)
        const meta = await sharp(png).metadata()
        if (meta.width !== o.out.w || meta.height !== o.out.h) png = await sharp(png).resize(o.out.w, o.out.h, { kernel: 'nearest', fit: 'fill' }).png().toBuffer()
        return { png, native: await fs.readFile(small), steps, calls, local: false }
      } finally {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      }
    } catch (e) {
      if (o.signal?.aborted || !(e instanceof StudioError && e.kind === 'unreachable')) throw e
      o.log?.('Pixel Studio is not running: the sprite is built from the rows here')
    }
  }
  return finish(await pngFromRows(final, o.grid, q.palette), true, 0)
}
