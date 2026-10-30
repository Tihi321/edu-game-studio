/**
 * The timeline's geometry, pure (no DOM): where events and ruler ticks sit on a track of a fixed pixel width. Ticks are true to scale;
 * the cards are spread out (alternately above and below the ruler) so that none overlaps, and a leader line joins a card to its tick.
 */

export interface TlInput {
  id: string
  year: number
}

export interface TlLayoutOptions {
  /** Card width in px. */
  card?: number
  /** Space between two cards of the same lane. */
  gap?: number
  /** The least track width. */
  minWidth?: number
}

export interface TlPlaced {
  id: string
  year: number
  /** The tick: true to scale, px from the left of the track. */
  tick: number
  /** The centre of the card, px. */
  x: number
  /** 0: above the ruler, 1: below. */
  lane: 0 | 1
}

export interface TlTick {
  year: number
  x: number
  major: boolean
}

export interface TlLayout {
  width: number
  /** Half a card plus a margin: the least distance of a card centre from the track's ends. */
  pad: number
  events: TlPlaced[]
  ticks: TlTick[]
  min: number
  max: number
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

/** Major tick spacing: the first "nice" step that gives at most `maxMajor` labels over `span` years. */
export function niceStep(span: number, maxMajor = 9): number {
  for (const s of STEPS) if (span / s <= maxMajor) return s
  return STEPS[STEPS.length - 1] as number
}

/** Years on the ruler between `from` and `to` (a major tick at every `step`, minor ticks in between). There is no year 0. */
export function rulerTicks(from: number, to: number): { year: number; major: boolean }[] {
  const span = Math.max(1, to - from)
  const step = niceStep(span)
  const minor = step >= 10 ? step / 5 : step >= 2 ? step / 2 : step
  const out: { year: number; major: boolean }[] = []
  const first = Math.ceil(from / minor) * minor
  for (let y = first; y <= to; y += minor) {
    if (y === 0) continue
    out.push({ year: y, major: y % step === 0 })
  }
  return out
}

/** The layout of `events` (any order) on a track. `n` events need `ceil(n / 2)` cards per lane, so the track grows with them. */
export function layoutTimeline(events: readonly TlInput[], opts: TlLayoutOptions = {}): TlLayout {
  const card = opts.card ?? 150
  const gap = opts.gap ?? 12
  const pad = Math.round(card / 2) + 14
  const sorted = [...events].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))
  const n = sorted.length
  const perLane = Math.ceil(n / 2)
  const width = Math.max(opts.minWidth ?? 760, perLane * (card + gap) + 2 * pad - gap)
  const min = n > 0 ? (sorted[0] as TlInput).year : 0
  const max = n > 0 ? (sorted[n - 1] as TlInput).year : 0
  const span = Math.max(1, max - min)
  const scale = (width - 2 * pad) / span
  const tickOf = (y: number): number => (n === 1 || max === min ? width / 2 : pad + (y - min) * scale)
  const placed: TlPlaced[] = sorted.map((e, i) => ({ id: e.id, year: e.year, tick: tickOf(e.year), x: tickOf(e.year), lane: (i % 2) as 0 | 1 }))
  const slot = card + gap
  for (const lane of [0, 1] as const) {
    const row = placed.filter((p) => p.lane === lane)
    // push right where two cards of a lane would overlap, then pull back what ran off the track's end
    for (let i = 0; i < row.length; i++) {
      const p = row[i] as TlPlaced
      p.x = Math.max(pad, p.x)
      if (i > 0) p.x = Math.max(p.x, (row[i - 1] as TlPlaced).x + slot)
    }
    for (let i = row.length - 1; i >= 0; i--) {
      const p = row[i] as TlPlaced
      p.x = Math.min(width - pad, p.x)
      if (i < row.length - 1) p.x = Math.min(p.x, (row[i + 1] as TlPlaced).x - slot)
    }
  }
  const yearAt = (x: number): number => min + (x - pad) / scale
  const ticks: TlTick[] = n === 0 || max === min ? [] : rulerTicks(Math.floor(yearAt(0)), Math.ceil(yearAt(width))).map((t) => ({ year: t.year, x: pad + (t.year - min) * scale, major: t.major }))
  return { width, pad, events: placed, ticks: ticks.filter((t) => t.x >= 0 && t.x <= width), min, max }
}

/** "1957", "432 BC" (the word for BC comes from the edition). */
export const formatYear = (year: number, bc: string): string => (year < 0 ? `${-year} ${bc}` : String(year))
