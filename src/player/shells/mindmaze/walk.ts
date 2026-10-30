import type { SeededRandom } from '../../../shared/edu'
import { doorKey, type MazeWing } from '../../../shared/shells/mindmaze'
import type { NextQuestion, RoundState } from '../../round'

/**
 * The walk through one wing, pure (no DOM): where you stand, which doors are open, how many torches are left, and which question a door
 * asks. The shell (`index.ts`) draws it; the bot's `route()` helper and the unit tests read it.
 *
 *  - A WALK starts when you enter a wing and ends at the key room (`take-key`). It keeps one RUN of the shared round logic over the
 *    pool of the whole wing (adaptive difficulty, a missed question coming back after 2 to 4 others, due cards first, no two kinds in a
 *    row), so the stars come from the first-try accuracy of the doors' questions.
 *  - A DOOR asks the next question of the run from ITS pool (`pickForDoor`); a right answer opens it for the rest of the walk, a wrong
 *    one puts a torch out and the door stays shut.
 *  - With no torch left the castle ghost leads you back to the entrance and relights the torches; the doors you opened stay open.
 */

export type Mood = 'none' | 'cheer' | 'groan'

export interface Walk {
  wingId: string
  run: RoundState
  /** The room you stand in. */
  room: string
  /** The rooms you came through, the latest last (what `back` goes along). */
  trail: string[]
  /** The doors opened in this walk (`doorKey(from, to)`). */
  open: string[]
  torches: number
  maxTorches: number
  /** How the character of the room reacts to the last answer. */
  mood: Mood
  /** The last thing that happened was the ghost leading you back to the entrance. */
  ghosted: boolean
}

export function newWalk(wing: Pick<MazeWing, 'id' | 'entry'>, run: RoundState, torches: number): Walk {
  return { wingId: wing.id, run, room: wing.entry, trail: [], open: [], torches, maxTorches: torches, mood: 'none', ghosted: false }
}

export const isOpen = (w: Pick<Walk, 'open'>, from: string, to: string): boolean => w.open.includes(doorKey(from, to))

export const openDoor = (w: Walk, from: string, to: string): Walk => (isOpen(w, from, to) ? w : { ...w, open: [...w.open, doorKey(from, to)] })

/** Walks through a door into the next room. */
export const walkThrough = (w: Walk, to: string): Walk => ({ ...w, trail: [...w.trail, w.room], room: to, ghosted: false })

/** Goes back the way you came (free: you only retrace open doors). Does nothing at the start of the trail. */
export function goBack(w: Walk): Walk {
  const prev = w.trail.at(-1)
  return prev === undefined ? w : { ...w, room: prev, trail: w.trail.slice(0, -1), ghosted: false }
}

/** A torch goes out. `dark` is true when it was the last one. */
export function loseTorch(w: Walk): { walk: Walk; dark: boolean } {
  const torches = Math.max(0, w.torches - 1)
  return { walk: { ...w, torches }, dark: torches === 0 }
}

/** The castle ghost leads you back to the entrance and relights the torches. The doors you opened stay open. */
export const ghostLeads = (w: Walk, entry: string): Walk => ({ ...w, room: entry, trail: [], torches: w.maxTorches, ghosted: true, mood: 'groan' })

/** The relit torches without leaving the room (the throne room). */
export const relight = (w: Walk): Walk => ({ ...w, torches: w.maxTorches })

/** How a character reacts: a right answer cheers (on a streak of 2 or more, or the first answer of the walk), a miss makes them groan. */
export function moodAfter(correct: boolean, combo: number): Mood {
  return correct ? (combo >= 2 ? 'cheer' : 'none') : 'groan'
}

/**
 * The next question for a door: its own pool first (a missed question whose gap has passed comes first, as in every run), else any
 * question of the wing that is left, else a practice question from the door's pool (asked as a retry: it earns no stars and half
 * points). A door never has nothing to ask, so a learner is never locked out.
 *
 * `pick` is the shared picker (`pickNext` with the pack, rng, cards and the clock); `last` is the item answered just before.
 */
export function pickForDoor(
  run: RoundState,
  doorItems: readonly string[],
  pick: (rs: RoundState) => NextQuestion | null,
  rng: Pick<SeededRandom, 'choice'>
): NextQuestion | null {
  const own = run.pool.filter((id) => doorItems.includes(id))
  const fromDoor = pick({ ...run, pool: own, size: run.asked.length + own.length })
  if (fromDoor) return fromDoor
  const fromWing = pick({ ...run, size: run.asked.length + run.pool.length })
  if (fromWing) return fromWing
  const last = run.results.at(-1)?.id
  const choices = doorItems.filter((id) => id !== last)
  const from = choices.length > 0 ? choices : [...doorItems]
  return from.length > 0 ? { id: rng.choice(from), retry: true } : null
}

/** The torches as a view for the snapshot. */
export const torchView = (w: Pick<Walk, 'torches' | 'maxTorches'>): { torches: number; maxTorches: number } => ({ torches: w.torches, maxTorches: w.maxTorches })
