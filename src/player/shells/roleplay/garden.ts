import { DAY_MS, mastery, type Card } from '../../../shared/edu/srs'
import { normalizeText } from '../../../shared/edu/match'
import { isReply, isSay, lineById, unitOfWord, walkScene, type RoleplaySection, type RpWord } from '../../../shared/shells/roleplay'
import type { CoursePack } from '../../../shared/course'

/**
 * The vocabulary garden of the role-play shell (EGS-13): pure (no DOM, no clock: `now` is passed). One plant per word or phrase; its
 * stage comes from the SM-2 card of the item that waters it (`srs.ts`):
 *
 *   seed    planted, never answered
 *   sprout  learning (fewer than 3 right answers in a row)
 *   bud     young (3 in a row, next review within 21 days)
 *   bloom   mature (next review in 21 days or more)
 *   wilted  the item is in the review queue, or its last answer was a miss
 *
 * A word is PLANTED when its item has been answered anywhere (any shell shares the cards) or when a scene of its unit has been finished.
 * `water` practises the planted words that are seeds, due, or wilted.
 */

export type Stage = 'seed' | 'sprout' | 'bud' | 'bloom' | 'wilted'
export const STAGES: readonly Stage[] = ['seed', 'sprout', 'bud', 'bloom', 'wilted']
/** The growing order (wilted is not a step of it). */
const GROWTH: readonly Stage[] = ['seed', 'sprout', 'bud', 'bloom']

/** The stage of a plant from its item's card and whether the item is in the review queue. A planted word without a card is a seed. */
export function stageOf(card: Card | undefined, queued: boolean): Stage {
  if (queued) return 'wilted'
  if (!card || card.last === null) return 'seed'
  if (card.reps === 0) return 'wilted' // the last answer was a miss: the card started over
  switch (mastery(card)) {
    case 'mature':
      return 'bloom'
    case 'young':
      return 'bud'
    case 'learning':
      return 'sprout'
    default:
      return 'seed'
  }
}

export interface Plant {
  word: RpWord
  /** The unit of the word's item. */
  unit: string | undefined
  stage: Stage
  /** Shown in the garden (answered once, or a scene of its unit was finished). */
  planted: boolean
  /** Ready to be watered: never answered, or its card is due. */
  due: boolean
  /** Epoch ms of the next review, or null for a seed. */
  dueAt: number | null
}

export interface GardenInput {
  section: Pick<RoleplaySection, 'garden'>
  pack: Pick<CoursePack, 'items' | 'objectives'>
  cards: Readonly<Record<string, Card>>
  queue: readonly string[]
  /** The units a scene of which has been finished. */
  doneUnits: readonly string[]
  now: number
}

export function plantsOf(input: GardenInput): Plant[] {
  const queued = new Set(input.queue)
  const done = new Set(input.doneUnits)
  const have = new Set(input.pack.items.map((i) => i.id))
  return input.section.garden
    .filter((w) => have.has(w.item))
    .map((word) => {
      const card = input.cards[word.item]
      const unit = unitOfWord(input.pack, word)
      const planted = card !== undefined || (unit !== undefined && done.has(unit))
      return {
        word,
        unit,
        planted,
        stage: stageOf(card, queued.has(word.item)),
        due: planted && (card === undefined || card.last === null || card.due <= input.now),
        dueAt: card && card.last !== null ? card.due : null
      }
    })
}

/** The item ids a watering run practises: planted words that are seeds, due or wilted (each item once, in garden order). */
export function waterPool(plants: readonly Plant[]): string[] {
  return [...new Set(plants.filter((p) => p.planted && (p.due || p.stage === 'wilted' || p.stage === 'seed')).map((p) => p.word.item))]
}

export function stageCounts(plants: readonly Plant[]): Record<Stage, number> {
  const out: Record<Stage, number> = { seed: 0, sprout: 0, bud: 0, bloom: 0, wilted: 0 }
  for (const p of plants) if (p.planted) out[p.stage] += 1
  return out
}

/** What a watering did to a plant. */
export function growth(before: Stage, after: Stage): 'grew' | 'wilted' | 'same' {
  if (after === 'wilted') return before === 'wilted' ? 'same' : 'wilted'
  const b = before === 'wilted' ? -1 : GROWTH.indexOf(before)
  return GROWTH.indexOf(after) > b ? 'grew' : 'same'
}

/** Whole days until the next watering (0 when due now), or null for a plant that has not been answered. */
export function daysUntil(plant: Pick<Plant, 'dueAt'>, now: number): number | null {
  if (plant.dueAt === null) return null
  return plant.dueAt <= now ? 0 : Math.ceil((plant.dueAt - now) / DAY_MS)
}

export interface Met {
  sceneId: string
  lineId: string
  speaker: string
  /** The text key of the line. */
  text: string
  /** `heard`: the word is in the line; `used`: the learner needed it to answer after this line. */
  how: 'heard' | 'used'
}

const hasWords = (haystack: string, needle: string): boolean => needle !== '' && ` ${haystack} `.includes(` ${needle} `)

/**
 * The line a word was met in (vocabulary in context, not in a list): the first spoken line that contains it (the scenes the learner has
 * finished first), else the line said just before the turn that asks the word's item.
 */
export function metIn(section: Pick<RoleplaySection, 'scenes'>, word: Pick<RpWord, 'text' | 'item'>, resolve: (key: string) => string, finished: ReadonlySet<string> = new Set()): Met | null {
  const target = normalizeText(resolve(word.text))
  const order = [...section.scenes.filter((s) => finished.has(s.id)), ...section.scenes.filter((s) => !finished.has(s.id))]
  for (const sc of order) {
    for (const id of walkScene(sc).path) {
      const l = lineById(sc, id)
      if (l && isSay(l) && hasWords(normalizeText(resolve(l.text)), target)) return { sceneId: sc.id, lineId: l.id, speaker: l.say, text: l.text, how: 'heard' }
    }
  }
  for (const sc of order) {
    const path = walkScene(sc).path
    for (const [i, id] of path.entries()) {
      const l = lineById(sc, id)
      if (!l || !isReply(l) || l.reply !== word.item) continue
      for (let j = i - 1; j >= 0; j--) {
        const prev = lineById(sc, path[j] as string)
        if (prev && isSay(prev)) return { sceneId: sc.id, lineId: prev.id, speaker: prev.say, text: prev.text, how: 'used' }
      }
    }
  }
  return null
}
