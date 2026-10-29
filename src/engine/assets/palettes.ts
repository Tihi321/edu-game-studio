import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

/** An RGB colour, 0-255 per channel. */
export type Rgb = [number, number, number]

/** Parses a `.hex` palette: one `rrggbb` colour per line (a leading `#` and blank lines are tolerated). */
export function parseHexPalette(text: string): Rgb[] {
  const out: Rgb[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(line)) continue
    out.push([parseInt(line.slice(0, 2), 16), parseInt(line.slice(2, 4), 16), parseInt(line.slice(4, 6), 16)])
  }
  return out
}

/** Palette names (file names without `.hex`) in a folder, sorted. */
export async function listPalettes(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  return (await fs.readdir(dir))
    .filter((f) => f.endsWith('.hex'))
    .map((f) => f.slice(0, -4))
    .sort()
}

/** Loads one palette by name from a folder (`seed/palettes` or `<data>/palettes`). */
export async function loadPalette(dir: string, name: string): Promise<Rgb[]> {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`invalid palette name "${name}"`)
  const file = path.join(dir, `${name}.hex`)
  if (!existsSync(file)) throw new Error(`palette "${name}" not found in ${dir}`)
  const colours = parseHexPalette(await fs.readFile(file, 'utf8'))
  if (colours.length === 0) throw new Error(`palette "${name}" has no colours`)
  return colours
}
