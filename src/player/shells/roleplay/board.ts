import type { CoursePack } from '../../../shared/course'
import { unitOrder } from '../../../shared/course'
import { scenesOfUnit, type RoleplaySection, type RpScene } from '../../../shared/shells/roleplay'
import { turnCount } from './dialogue'

/**
 * The scene board of the role-play shell (EGS-13): which scenes the learner can open and how many stars each has. Pure (no DOM), so it is
 * unit-tested in node.
 *
 *  - a scene is open when every unit its unit requires is mastered (2+ stars); a required unit WITHOUT a scene is looked through (what
 *    it requires is needed instead), so a course whose units do not all have a scene still plays (the lint reports RP_UNIT_NO_SCENE);
 *  - the finale (the boss) is open when every unit that has a scene is mastered;
 *  - the stars of a scene are the stars of its unit (the finale: the boss stars).
 */

export interface SceneEntry {
  scene: RpScene
  unit: string | undefined
  finale: boolean
  locked: boolean
  stars: number
  /** The unit ids (that have a scene) still to master before this scene opens. */
  needs: string[]
  /** The learner's turns on the scene's path. */
  turns: number
}

export interface BoardInput {
  section: Pick<RoleplaySection, 'scenes' | 'finale'>
  pack: Pick<CoursePack, 'units'>
  mastered(unitId: string): boolean
  unitStars(unitId: string): number
  bossStars: number
}

export function sceneBoard(input: BoardInput): SceneEntry[] {
  const { section, pack } = input
  const withScene = new Set(pack.units.filter((u) => scenesOfUnit(section, u.id).length > 0).map((u) => u.id))
  const out: SceneEntry[] = []
  const order = unitOrder(pack.units)
  // a required unit WITHOUT a scene is looked through: what it requires is needed instead
  const needsOf = (requires: readonly string[], seen = new Set<string>()): string[] =>
    requires.flatMap((r) => {
      if (seen.has(r)) return []
      seen.add(r)
      if (withScene.has(r)) return input.mastered(r) ? [] : [r]
      return needsOf(pack.units.find((u) => u.id === r)?.requires ?? [], seen)
    })
  for (const id of order) {
    const unit = pack.units.find((u) => u.id === id)
    if (!unit) continue
    const needs = needsOf(unit.requires)
    for (const scene of scenesOfUnit(section, id)) {
      out.push({ scene, unit: id, finale: false, locked: needs.length > 0, stars: input.unitStars(id), needs, turns: turnCount(scene) })
    }
  }
  // scenes of no known unit (a lint error) stay playable but come after the units
  const known = new Set(pack.units.map((u) => u.id))
  for (const scene of section.scenes) {
    if (scene.id === section.finale || (scene.unit && known.has(scene.unit))) continue
    out.push({ scene, unit: scene.unit, finale: false, locked: false, stars: 0, needs: [], turns: turnCount(scene) })
  }
  const finale = section.scenes.find((s) => s.id === section.finale)
  if (finale) {
    const needs = [...withScene].filter((u) => !input.mastered(u))
    out.push({ scene: finale, unit: undefined, finale: true, locked: needs.length > 0, stars: input.bossStars, needs, turns: turnCount(finale) })
  }
  return out
}

/** The ids of the scenes that are open in `after` and were locked in `before` (what a finished scene has just opened). */
export function newlyOpen(before: readonly SceneEntry[], after: readonly SceneEntry[]): string[] {
  const was = new Set(before.filter((e) => e.locked).map((e) => e.scene.id))
  return after.filter((e) => !e.locked && was.has(e.scene.id)).map((e) => e.scene.id)
}

/** The first open scene whose unit has fewer than `target` stars (what a player who just plays on opens next), or null. */
export function nextScene(board: readonly SceneEntry[], target = 2): SceneEntry | null {
  return board.find((e) => !e.locked && e.stars < target) ?? null
}
