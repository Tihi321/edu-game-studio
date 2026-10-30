/**
 * Battle maths of the RPG shell (EGS-12), pure: the hero's moves ARE answers.
 *
 *  - a right answer strikes: damage = BASE_DAMAGE x the answer's score (partial credit counts) x the streak multiplier
 *    (1 + 0.25 per answer right in a row, up to x2);
 *  - a wrong answer breaks the streak and the foe strikes back: STRIKE x (1 - score), at least 1 (a half-right answer still hits the foe
 *    for half and costs half);
 *  - the foe falls at 0 HP; the hero at 0 HP faints (the shell wakes them at the inn with full HP: never a dead end).
 */

export const HERO_MAX_HP = 100
export const BASE_DAMAGE = 100
export const FOE_STRIKE = 25
export const BOSS_STRIKE = 30
export const STREAK_STEP = 0.25
export const STREAK_CAP = 2

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** The streak multiplier: 1 + 0.25 x the answers right in a row before this one, at most 2. */
export const streakMultiplier = (streak: number): number => Math.min(STREAK_CAP, 1 + STREAK_STEP * Math.max(0, streak))

/** The damage of a strike for an answer of this score, after `streak` right answers in a row. */
export const heroDamage = (score: number, streak: number, base = BASE_DAMAGE): number => Math.round(base * clamp01(score) * streakMultiplier(streak))

/** The damage the foe deals back for an answer that was not right (0 for a right one). */
export const foeDamage = (correct: boolean, score: number, strike = FOE_STRIKE): number => (correct ? 0 : Math.max(1, Math.round(strike * (1 - clamp01(score)))))

export interface Battle {
  foeHp: number
  foeMax: number
  hp: number
  maxHp: number
  /** Answers right in a row. */
  streak: number
  /** Answers given. */
  turns: number
  /** The damage of the foe's strike back. */
  strike: number
}

export const newBattle = (foeMax: number, strike = FOE_STRIKE, hp = HERO_MAX_HP, maxHp = HERO_MAX_HP): Battle => ({ foeHp: foeMax, foeMax, hp, maxHp, streak: 0, turns: 0, strike })

export interface Turn {
  battle: Battle
  /** Damage the hero dealt. */
  dealt: number
  /** Damage the hero took. */
  taken: number
  /** The streak multiplier of the strike. */
  multiplier: number
  won: boolean
  fainted: boolean
}

/** One turn: what an answer (`correct`, `score` 0..1) does. The hero strikes first: a blow that fells the foe spares the hero the strike back. */
export function resolveTurn(b: Battle, r: { correct: boolean; score: number }): Turn {
  const multiplier = streakMultiplier(b.streak)
  const dealt = heroDamage(r.score, b.streak)
  const foeHp = Math.max(0, b.foeHp - dealt)
  const won = foeHp === 0
  const taken = won ? 0 : foeDamage(r.correct, r.score, b.strike)
  const hp = Math.max(0, b.hp - taken)
  return {
    battle: { ...b, foeHp, hp, streak: r.correct ? b.streak + 1 : 0, turns: b.turns + 1 },
    dealt,
    taken,
    multiplier,
    won,
    fainted: !won && hp === 0
  }
}

/** The share of the bar that is left, 0..100 (a whole number, so a bar never shows a half pixel of a pixel-art life). */
export const barPercent = (hp: number, max: number): number => (max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((hp / max) * 100))))
