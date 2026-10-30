/**
 * The map's geometry, pure (no DOM).
 */

export interface PinPoint {
  id: string
  x: number
  y: number
}

/** The smallest distance between two pins, in image pixels (Infinity for fewer than two). */
export function nearestPinDistance(pins: readonly PinPoint[]): number {
  let best = Infinity
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i] as PinPoint
      const b = pins[j] as PinPoint
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return best
}

/**
 * The narrowest width (px) the map may be drawn at so that its two nearest pins stay `tap` px apart, never wider than the image and never
 * narrower than `floor`. On a phone the map then scrolls sideways inside its own box instead of piling the pins on each other.
 */
export function minMapWidth(pins: readonly PinPoint[], imageWidth: number, tap = 34, floor = 300): number {
  const d = nearestPinDistance(pins)
  if (!Number.isFinite(d) || d <= 0) return Math.min(imageWidth, floor)
  return Math.round(Math.min(imageWidth, Math.max(floor, (imageWidth * tap) / d)))
}

/** The neighbour of a pin in an arrow direction: the next pin to the right or below / the previous to the left or above (by x, or by y), wrapping round. */
export function stepPin<T extends PinPoint>(pins: readonly T[], from: string, dir: 'left' | 'right' | 'up' | 'down'): T | undefined {
  const horizontal = dir === 'left' || dir === 'right'
  const sorted = [...pins].sort((a, b) => (horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x) || a.id.localeCompare(b.id))
  const i = sorted.findIndex((p) => p.id === from)
  if (sorted.length === 0) return undefined
  const step = dir === 'right' || dir === 'down' ? 1 : -1
  return sorted[(i + step + sorted.length) % sorted.length]
}

/** A position as CSS percentages of the image. */
export const pinPercent = (p: PinPoint, width: number, height: number): { left: string; top: string } => ({
  left: `${Math.round((p.x / width) * 10000) / 100}%`,
  top: `${Math.round((p.y / height) * 10000) / 100}%`
})
