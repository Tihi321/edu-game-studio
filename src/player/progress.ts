import type { CoursePack } from '../shared/course'
import { cleanName } from '../shared/classroom'
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
/** The play-time counter stops here (100 hours). */
export const MAX_PLAY_SECONDS = 360_000

export interface UnitProgress {
  stars: number
  /** Best first-try accuracy of a round, 0..1. */
  best: number
  rounds: number
}

/**
 * The progress of one game shell other than the quiz arena (EGS-10+), in `Progress.shells[<shellId>]`: its own unit stars and boss (a
 * castle wing cleared is not a quiz round won), whether it was finished, and its own data (rooms opened, clues found, plants ...), which
 * the shell validates itself when it reads it. The SM-2 cards, the review queue, the score and the settings are shared by every shell.
 */
export interface ShellProgress {
  units: Record<string, UnitProgress>
  boss: UnitProgress
  finished: boolean
  /** The shell's own JSON data (at most MAX_SHELL_DATA characters as JSON). */
  data?: unknown
}

/** The largest shell data kept (JSON characters): a broken or hostile file cannot fill the storage. */
export const MAX_SHELL_DATA = 200_000

export const emptyShellProgress = (): ShellProgress => ({ units: {}, boss: emptyUnit(), finished: false })

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
  /** `sound`: sounds on (false: nothing plays). `reduceAudio` (EGS-16): no music and quieter sound effects; missing in an older save means false. `speak` (EGS-18): the mic button of text answers; missing in an older save means true. */
  settings: { lang?: string; timer: boolean; sound: boolean; reduceAudio?: boolean; speak?: boolean; name?: string; studentId?: string }
  /** Seconds of play with activity (EGS-20, the time on task a result file reports); missing in an older save means 0. */
  playSeconds?: number
  /** Epoch ms of the last save. */
  updatedAt: number
  /** Progress of the other game shells, by shell id (the quiz arena's stars are `units` and `boss` above). */
  shells: Record<string, ShellProgress>
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
    settings: { timer: false, sound: true, reduceAudio: false, speak: true },
    updatedAt: 0,
    shells: {}
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
      reduceAudio: src.settings.reduceAudio === true,
      speak: src.settings.speak !== false,
      ...(typeof src.settings.lang === 'string' ? { lang: src.settings.lang } : {}),
      ...(cleanName(src.settings.name) ? { name: cleanName(src.settings.name) } : {}),
      ...(typeof src.settings.studentId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(src.settings.studentId) ? { studentId: src.settings.studentId } : {})
    }
  }
  if (src.playSeconds !== undefined) p.playSeconds = int(src.playSeconds, 0, MAX_PLAY_SECONDS, 0)
  p.updatedAt = num(src.updatedAt, 0, 8.64e15, 0)
  if (isObj(src.shells)) {
    for (const [id, raw] of Object.entries(src.shells)) {
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || !isObj(raw)) continue
      const sp = emptyShellProgress()
      if (isObj(raw.units)) for (const [uid, u] of Object.entries(raw.units)) if (unitIds.has(uid)) sp.units[uid] = cleanUnit(u)
      sp.boss = cleanUnit(raw.boss)
      sp.finished = raw.finished === true
      if (raw.data !== undefined) {
        try {
          const json = JSON.stringify(raw.data)
          if (json !== undefined && json.length <= MAX_SHELL_DATA) sp.data = JSON.parse(json) as unknown
        } catch {
          /* unserialisable data is dropped */
        }
      }
      p.shells[id] = sp
    }
  }
  return { ok: true, progress: p }
}

/** True when the pack has progress worth continuing (any stars, cards or score). */
export const hasProgress = (p: Progress): boolean => p.answered > 0 || Object.keys(p.units).length > 0 || p.boss.rounds > 0

/** True when a shell has progress worth continuing (its stars, its data or a finish). */
export const hasShellProgress = (p: Progress, shellId: string): boolean => {
  const sp = p.shells[shellId]
  return !!sp && (Object.keys(sp.units).length > 0 || sp.boss.rounds > 0 || sp.finished || sp.data !== undefined)
}

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
