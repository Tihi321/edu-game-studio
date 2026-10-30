import type { RpgArea } from '../../../shared/shells/rpg-layout'
import { DIRS, findPath, isAdjacent, isWalkable, pathNextTo, posKey, samePos, tileAt, type Dir, type Pos } from '../../../shared/shells/rpg-map'

/**
 * The world of one area (EGS-12), pure: who stands where, what a step does, which buttons walk the hero where, what the quest asks next.
 * The DOM and the canvas are elsewhere; the autoplay bot's helpers (`nextGoal`, `pathTo`) are computed here too.
 */

export type PersonKind = 'npc' | 'foe' | 'boss'

export interface Person {
  id: string
  kind: PersonKind
  at: Pos
  /** The quest giver. */
  giver: boolean
  /** The test id of the button that walks to this person (`goto-<id>`, `goto-boss`). */
  goto: string
}

/** What the learner has done in one area, in this page session. */
export interface AreaProgress {
  pos: Pos
  face: Dir
  /** The quest was taken from the giver. */
  accepted: boolean
  foesDown: string[]
  bossDown: boolean
  /** First-try scores (0..1) of the questions of the battles fought so far in this attempt. */
  scores: number[]
  /** Foes whose first battle already counted into `scores`. */
  counted: string[]
  /** The boss fell (the quest is done). */
  done: boolean
}

export const newAreaProgress = (area: Pick<RpgArea, 'start'>): AreaProgress => ({ pos: area.start, face: 'right', accepted: false, foesDown: [], bossDown: false, scores: [], counted: [], done: false })

/** A new attempt at the quest (`replay-quest`): the foes and the boss are back, the quest stays accepted. */
export const replayProgress = (area: Pick<RpgArea, 'start'>, p: AreaProgress): AreaProgress => ({ ...newAreaProgress(area), accepted: p.accepted })

export const bossGoto = 'goto-boss'

/** Everyone still standing in the area. */
export function peopleOf(area: RpgArea, p: AreaProgress): Person[] {
  const out: Person[] = area.npcs.map((n) => ({ id: n.id, kind: 'npc', at: n.at, giver: n.quest, goto: `goto-${n.id}` }))
  for (const f of area.foes) if (!p.foesDown.includes(f.id)) out.push({ id: f.id, kind: 'foe', at: f.at, giver: false, goto: `goto-${f.id}` })
  if (!p.bossDown) out.push({ id: area.boss.id, kind: 'boss', at: area.boss.at, giver: false, goto: bossGoto })
  return out
}

export const occupiedTiles = (area: RpgArea, p: AreaProgress): Set<string> => new Set(peopleOf(area, p).map((q) => posKey(q.at)))

export type Stage = 'talk' | 'foes' | 'boss' | 'done'

/** Where the quest stands: talk to the giver, beat the foes, face the boss, done. */
export function stageOf(area: RpgArea, p: AreaProgress): Stage {
  if (p.done) return 'done'
  if (!p.accepted) return 'talk'
  return area.foes.every((f) => p.foesDown.includes(f.id)) ? 'boss' : 'foes'
}

/** What a step of the hero does: walk, bump into someone (talk or fight), go through the open gate, or nothing. */
export type Step = { kind: 'move'; pos: Pos } | { kind: 'bump'; person: Person } | { kind: 'gate' } | { kind: 'blocked' }

export const stepFrom = (pos: Pos, dir: Dir): Pos => [pos[0] + DIRS[dir][0], pos[1] + DIRS[dir][1]]

export function tryStep(area: RpgArea, p: AreaProgress, dir: Dir, gateOpen: boolean): Step {
  const to = stepFrom(p.pos, dir)
  const who = peopleOf(area, p).find((q) => samePos(q.at, to))
  if (who) return { kind: 'bump', person: who }
  const ch = tileAt(area.rows, to)
  if (ch === 'G' && gateOpen) return { kind: 'gate' }
  return isWalkable(ch, gateOpen) ? { kind: 'move', pos: to } : { kind: 'blocked' }
}

export function dirBetween(from: Pos, to: Pos): Dir {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

/** Who stands next to the hero; the person the hero faces comes first, then the giver, foes, the boss, the others. */
export function nearby(area: RpgArea, p: AreaProgress): Person[] {
  const ahead = stepFrom(p.pos, p.face)
  const rank = (q: Person): number => (samePos(q.at, ahead) ? 0 : q.giver ? 1 : q.kind === 'foe' ? 2 : q.kind === 'boss' ? 3 : 4)
  return peopleOf(area, p)
    .filter((q) => isAdjacent(q.at, p.pos))
    .sort((a, b) => rank(a) - rank(b))
}

export type TargetKind = 'giver' | 'npc' | 'foe' | 'boss' | 'gate'

export interface Target {
  /** The test id of the button (`goto-<id>`, `goto-boss`, `goto-gate`). */
  testid: string
  id: string
  kind: TargetKind
  at: Pos
}

/** The places the `goto-` buttons walk to: everyone standing, and the gate. */
export function targetsOf(area: RpgArea, p: AreaProgress): Target[] {
  const out: Target[] = peopleOf(area, p).map((q) => ({ testid: q.goto, id: q.id, kind: q.giver ? 'giver' : q.kind, at: q.at }))
  if (area.gate) out.push({ testid: 'goto-gate', id: 'gate', kind: 'gate', at: area.gate })
  return out
}

/** The path (without the tile the hero stands on) that the button `testid` walks, or null when there is none. For a person it ends next to them. */
export function pathToTarget(area: RpgArea, p: AreaProgress, testid: string, gateOpen: boolean): Pos[] | null {
  const t = targetsOf(area, p).find((x) => x.testid === testid || x.id === testid)
  if (!t) return null
  const blocked = occupiedTiles(area, p)
  if (t.kind === 'gate') {
    // the open gate is walked onto; a shut one is walked up to
    return gateOpen ? findPath(area.rows, p.pos, (q) => samePos(q, t.at), { blocked, gateOpen }) : pathNextTo(area.rows, p.pos, t.at, { blocked })
  }
  return pathNextTo(area.rows, p.pos, t.at, { blocked, gateOpen })
}

export type GoalKind = 'giver' | 'foe' | 'boss' | 'gate' | 'leave'

export interface Goal {
  kind: GoalKind
  /** The id of the person (or `gate`). */
  id: string
  /** The test id of the `goto-` button (none for `leave`). */
  testid?: string
  /** The hero already stands next to the goal: press `talk`. */
  adjacent: boolean
  /** Steps to walk. */
  steps: number
}

/** What the quest asks next: the giver, the first foe still standing, the boss, then the gate (or the way out of an area without one). */
export function nextGoal(area: RpgArea, p: AreaProgress, gateOpen: boolean): Goal {
  const stage = stageOf(area, p)
  const people = peopleOf(area, p)
  const make = (kind: GoalKind, id: string, testid: string): Goal => {
    const path = pathToTarget(area, p, testid, gateOpen)
    const person = people.find((q) => q.goto === testid)
    return { kind, id, testid, adjacent: !!person && isAdjacent(person.at, p.pos), steps: path?.length ?? -1 }
  }
  if (stage === 'talk') {
    const giver = people.find((q) => q.giver) ?? people.find((q) => q.kind === 'npc')
    if (giver) return make('giver', giver.id, giver.goto)
  }
  if (stage === 'foes') {
    const foe = area.foes.map((f) => people.find((q) => q.id === f.id)).find((q) => q !== undefined)
    if (foe) return make('foe', foe.id, foe.goto)
  }
  if (stage === 'boss' || (stage === 'talk' && !people.some((q) => q.kind === 'npc'))) {
    const boss = people.find((q) => q.kind === 'boss')
    if (boss) return make('boss', boss.id, boss.goto)
  }
  if (area.gate) return make('gate', 'gate', 'goto-gate')
  return { kind: 'leave', id: 'areas', adjacent: false, steps: 0 }
}

/** The first first-try accuracy of a quest attempt: the mean of the scores of its questions (0 when none was answered). */
export const questAccuracy = (scores: readonly number[]): number => (scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length)
