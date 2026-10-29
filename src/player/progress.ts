import type { CoursePack } from '../shared/course'
import { newCard, type Card } from '../shared/edu'

/**
 * Progress of one learner in one course: stars per unit, the boss, the SM-2 cards, the review queue, the score and the settings.
 * Pure functions here; the only browser-touching part is `ProgressStore` (localStorage under a key namespaced by `pack.id`), and a
 * storage that throws (private mode, quota, disabled) never makes the game throw: it falls back to memory and says so.
 */

export const PROGRESS_VERSION = 1
export const EXPORT_FORMAT = 'edu-progress'
/** A unit counts as mastered (and unlocks its dependants) from this many stars. */
export const MASTERED_STARS = 2

export interface UnitProgress {
  stars: number
  /** Best first-try accuracy of a round, 0..1. */
  best: number
  rounds: number
}

export interface Progress {
  version: typeof PROGRESS_VERSION
  /** `pack.id`. */
  pack: string
  units: Record<string, UnitProgress>
  boss: UnitProgress
  cards: Record<string, Card>
  /** Items missed and not answered right since, oldest first. */
  queue: string[]
  score: number
  bestCombo: number
  /** Answers given and answers right the first time, over all sessions (for the end screen). */
  answered: number
  right: number
  settings: { lang?: string; timer: boolean; sound: boolean }
  /** Epoch ms of the last save. */
  updatedAt: number
}

export const emptyUnit = (): UnitProgress => ({ stars: 0, best: 0, rounds: 0 })

export function newProgress(packId: string): Progress {
  return {
    version: PROGRESS_VERSION,
    pack: packId,
    units: {},
    boss: emptyUnit(),
    cards: {},
    queue: [],
    score: 0,
    bestCombo: 0,
    answered: 0,
    right: 0,
    settings: { timer: false, sound: true },
    updatedAt: 0
  }
}

/** Stars from the first-try accuracy of a round (0..1): 1 star from 50 %, 2 from 70 %, 3 from 90 %. */
export function starsFor(accuracy: number): number {
  return accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : accuracy >= 0.5 ? 1 : 0
}

export const isMastered = (p: Progress, unitId: string): boolean => (p.units[unitId]?.stars ?? 0) >= MASTERED_STARS

/** A unit is open when every unit it requires is mastered. */
export function isUnlocked(pack: Pick<CoursePack, 'units'>, p: Progress, unitId: string): boolean {
  const unit = pack.units.find((u) => u.id === unitId)
  if (!unit) return false
  return unit.requires.every((r) => isMastered(p, r))
}

export const allMastered = (pack: Pick<CoursePack, 'units'>, p: Progress): boolean => pack.units.every((u) => isMastered(p, u.id))

/** The units a round has just opened: open now, were not open before. */
export function newlyUnlocked(pack: Pick<CoursePack, 'units'>, before: Progress, after: Progress): string[] {
  return pack.units.filter((u) => !isUnlocked(pack, before, u.id) && isUnlocked(pack, after, u.id)).map((u) => u.id)
}

/** Stars per unit, 0..3, for every unit of the pack (what `getState().mastery` shows). */
export const masteryMap = (pack: Pick<CoursePack, 'units'>, p: Progress): Record<string, number> => Object.fromEntries(pack.units.map((u) => [u.id, p.units[u.id]?.stars ?? 0]))

export const totalStars = (pack: Pick<CoursePack, 'units'>, p: Progress): number => pack.units.reduce((n, u) => n + (p.units[u.id]?.stars ?? 0), 0)

/** Records a finished round: stars never go down, the best accuracy is kept. Returns a new Progress. */
export function recordRound(p: Progress, target: { unitId?: string; boss?: boolean }, accuracy: number): Progress {
  const stars = starsFor(accuracy)
  const upd = (u: UnitProgress | undefined): UnitProgress => {
    const cur = u ?? emptyUnit()
    return { stars: Math.max(cur.stars, stars), best: Math.max(cur.best, accuracy), rounds: cur.rounds + 1 }
  }
  if (target.boss) return { ...p, boss: upd(p.boss) }
  if (!target.unitId) return p
  return { ...p, units: { ...p.units, [target.unitId]: upd(p.units[target.unitId]) } }
}

/** Adds an item to the review queue (once), or takes it out. */
export const enqueueMiss = (queue: readonly string[], id: string): string[] => (queue.includes(id) ? [...queue] : [...queue, id])
export const dequeue = (queue: readonly string[], id: string): string[] => queue.filter((q) => q !== id)

/** The card of an item, or a new one. */
export const cardOf = (p: Progress, id: string, now: number): Card => p.cards[id] ?? newCard(id, now)

// ---- export / import ----

export interface ProgressExport {
  format: typeof EXPORT_FORMAT
  version: typeof PROGRESS_VERSION
  pack: string
  progress: Progress
}

export const exportProgress = (p: Progress): string => JSON.stringify({ format: EXPORT_FORMAT, version: PROGRESS_VERSION, pack: p.pack, progress: p } satisfies ProgressExport, null, 2)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
const int = (v: unknown, min: number, max: number, fallback: number): number => Math.round(num(v, min, max, fallback))

function cleanUnit(v: unknown): UnitProgress {
  if (!isObj(v)) return emptyUnit()
  return { stars: int(v.stars, 0, 3, 0), best: num(v.best, 0, 1, 0), rounds: int(v.rounds, 0, 1_000_000, 0) }
}

function cleanCard(id: string, v: unknown): Card | null {
  if (!isObj(v)) return null
  const fresh = newCard(id, 0)
  return {
    id,
    ease: num(v.ease, 1.3, 5, fresh.ease),
    interval: num(v.interval, 0, 36_500, 0),
    reps: int(v.reps, 0, 10_000, 0),
    lapses: int(v.lapses, 0, 10_000, 0),
    due: num(v.due, 0, 8.64e15, 0),
    last: typeof v.last === 'number' && Number.isFinite(v.last) ? v.last : null
  }
}

export type ParseResult = { ok: true; progress: Progress } | { ok: false; error: string }

/**
 * Reads a progress JSON (a stored value or an imported file) for this pack. Unknown units and items are dropped, numbers are clamped,
 * so a hand-edited or old file can never put the game in a state it cannot play. `raw` may be the export wrapper or a bare Progress.
 */
export function parseProgress(text: string, pack: Pick<CoursePack, 'id' | 'units' | 'items' | 'objectives'>): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not JSON' }
  }
  if (!isObj(data)) return { ok: false, error: 'not an object' }
  if ('format' in data && data.format !== EXPORT_FORMAT) return { ok: false, error: 'wrong file format' }
  const src = isObj(data.progress) ? data.progress : data
  if (src.version !== PROGRESS_VERSION) return { ok: false, error: `unknown version ${String(src.version)}` }
  if (src.pack !== pack.id) return { ok: false, error: `it is for the course "${String(src.pack)}"` }
  const p = newProgress(pack.id)
  const unitIds = new Set(pack.units.map((u) => u.id))
  if (isObj(src.units)) for (const [id, u] of Object.entries(src.units)) if (unitIds.has(id)) p.units[id] = cleanUnit(u)
  p.boss = cleanUnit(src.boss)
  const itemIds = new Set(pack.items.map((i) => i.id))
  if (isObj(src.cards)) {
    for (const [id, c] of Object.entries(src.cards)) {
      if (!itemIds.has(id)) continue
      const card = cleanCard(id, c)
      if (card) p.cards[id] = card
    }
  }
  if (Array.isArray(src.queue)) p.queue = [...new Set(src.queue.filter((q): q is string => typeof q === 'string' && itemIds.has(q)))]
  p.score = int(src.score, 0, 1e9, 0)
  p.bestCombo = int(src.bestCombo, 0, 100_000, 0)
  p.answered = int(src.answered, 0, 1e9, 0)
  p.right = Math.min(p.answered, int(src.right, 0, 1e9, 0))
  if (isObj(src.settings)) {
    p.settings = {
      timer: src.settings.timer === true,
      sound: src.settings.sound !== false,
      ...(typeof src.settings.lang === 'string' ? { lang: src.settings.lang } : {})
    }
  }
  p.updatedAt = num(src.updatedAt, 0, 8.64e15, 0)
  return { ok: true, progress: p }
}

/** True when the pack has progress worth continuing (any stars, cards or score). */
export const hasProgress = (p: Progress): boolean => p.answered > 0 || Object.keys(p.units).length > 0 || p.boss.rounds > 0

// ---- storage ----

export const storageKey = (packId: string): string => `edu-studio:progress:${packId}`

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Progress in `localStorage` (or any StorageLike) with a memory fallback. Never throws. */
export class ProgressStore {
  /** false when the storage could not be used (reads or writes failed): the game still plays, the page says so. */
  persistent = true
  private memory: string | null = null

  constructor(
    private readonly pack: Pick<CoursePack, 'id' | 'units' | 'items' | 'objectives'>,
    private readonly storage: StorageLike | null
  ) {
    if (!storage) this.persistent = false
  }

  load(): Progress {
    let raw: string | null = this.memory
    if (this.storage) {
      try {
        raw = this.storage.getItem(storageKey(this.pack.id))
      } catch {
        this.persistent = false
      }
    }
    if (!raw) return newProgress(this.pack.id)
    const res = parseProgress(raw, this.pack)
    return res.ok ? res.progress : newProgress(this.pack.id)
  }

  save(p: Progress): void {
    const text = JSON.stringify({ ...p, updatedAt: Date.now() })
    this.memory = text
    if (!this.storage) return
    try {
      this.storage.setItem(storageKey(this.pack.id), text)
    } catch {
      this.persistent = false
    }
  }

  clear(): void {
    this.memory = null
    if (!this.storage) return
    try {
      this.storage.removeItem(storageKey(this.pack.id))
    } catch {
      this.persistent = false
    }
  }
}

/** `window.localStorage`, or null when even touching it throws (a sandboxed frame, a blocked cookie setting). */
export function browserStorage(): StorageLike | null {
  try {
    const s = window.localStorage
    const probe = '__edu_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}
