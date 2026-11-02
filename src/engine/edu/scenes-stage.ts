import { normalizeText } from '../../shared/edu'
import { mergeAccepted } from './authoring'
import type { AcceptedOutput, AuthoredItem } from './authoring'
import { isSceneReply, isSceneSay } from './scenes'
import type { SceneDraft, SceneItemInfo, SceneSpeaker } from './scenes'

/**
 * The pure parts of the pipeline stage `scenes` (EGS-55, HUB-23) that need no model and no file: which items a reply may reuse, the late items
 * the scene-writer adds, the speakers of all calls as one list, and the vocabulary garden derived from the scope and the scenes. The handlers
 * (`pipeline-handlers.ts`) read and write the files; `assemble.ts` turns the result into the course section.
 */

/** What `pipeline/scenes/<unit>.json` (and `finale.json`) holds: the scene-writer's last answer for the call, and the coach's widened answers of its new typed items. */
export interface StoredScenes {
  speakers: SceneSpeaker[]
  scenes: SceneDraft[]
  newItems: AuthoredItem[]
  /** `scenes_accepted`: the language-coach's alternatives for the new typed items. */
  accepted?: AcceptedOutput
  round: number
}

/** The tag of an item the scene-writer added. */
export const SCENE_TAG = 'scene'
/** The file of the finale call, next to the unit files (a unit id never starts with an underscore: `ident` forbids it, so no unit can collide). */
export const FINALE_FILE = '_finale'

const fold = (s: string): string => normalizeText(s, { fold: true })

/** The item kinds a reply may point at: the learner chooses or types a sentence. */
const REPLY_KINDS = new Set(['mcq', 'typed', 'cloze'])
/** Items about a text, true / false / not given, self-checks and harvested cards have no answer that fits a conversation. */
const NOT_A_REPLY = new Set(['tfng', 'reading', 'self-check', 'gloss'])

/** The answers of an item as text: the accepted answers of a typed item, the right option of an mcq, the gaps of a cloze. Empty for other kinds. */
export function answerTexts(it: AuthoredItem): string[] {
  switch (it.kind) {
    case 'typed':
      return it.accepted
    case 'mcq':
      return it.options.filter((o) => o.id === it.answer).map((o) => o.text)
    case 'cloze':
      return it.gaps.flatMap((g) => g.accepted)
    default:
      return []
  }
}

/** Items a reply may reuse: German (`taught`) choice, typed and cloze items that are not about a reading. */
export const replyCandidates = (items: readonly AuthoredItem[]): AuthoredItem[] => items.filter((it) => it.taught === true && REPLY_KINDS.has(it.kind) && !(it.tags ?? []).some((t) => NOT_A_REPLY.has(t)))

/** An item as `checkScenes` knows it. */
export function itemInfo(it: AuthoredItem): SceneItemInfo {
  return {
    id: it.id,
    kind: it.kind,
    taught: it.taught === true,
    typed: it.kind === 'typed' || (it.kind === 'cloze' && it.gaps.some((g) => !g.bank)),
    answers: answerTexts(it)
  }
}

/** An item as a line of the prompt: `- id (kind): the question -> the answer the learner gives`. */
export const itemLine = (it: AuthoredItem): string => `- ${it.id} (${it.kind}${itemInfo(it).typed ? ', typed' : ''}): ${it.kind === 'cloze' ? it.text : it.prompt} -> ${answerTexts(it)[0] ?? ''}`

/** The new items of a stored answer, with the coach's alternatives merged in and the `scene` tag. */
export function lateItems(stored: Pick<StoredScenes, 'newItems' | 'accepted'>): AuthoredItem[] {
  const merged = stored.accepted ? mergeAccepted(stored.newItems, stored.accepted) : stored.newItems
  return merged.map((it) => ({ ...it, tags: [...new Set([...(it.tags ?? []), SCENE_TAG])] }))
}

/**
 * The speakers of all calls as one list: the first one wins for an id, and there is one learner. A second learner is kept (as no learner)
 * only when a line is said by it, otherwise dropped (a reply line has no speaker).
 */
export function mergeSpeakers(lists: readonly (readonly SceneSpeaker[])[], scenes: readonly SceneDraft[] = []): SceneSpeaker[] {
  const used = new Set(scenes.flatMap((sc) => sc.lines.filter(isSceneSay).map((l) => l.say)))
  const out = new Map<string, SceneSpeaker>()
  let learner = false
  for (const s of lists.flat()) {
    if (out.has(s.id)) continue
    if (s.learner) {
      if (learner) {
        if (used.has(s.id)) out.set(s.id, { ...s, learner: false })
        continue
      }
      learner = true
    }
    out.set(s.id, s)
  }
  return [...out.values()]
}

// ---- the garden ----

/** A word of the vocabulary garden; assemble makes the catalog keys `rp.w.<slug>` (+ `.gloss`) and the id `w-<slug>`. */
export interface GardenWord {
  slug: string
  /** The German word or phrase. */
  text: string
  /** Its meaning in the language of the course. */
  gloss: string
  /** The item that waters the plant. */
  item: string
}

const ARTICLE = /^(der|die|das|ein|eine) /i
const slugOf = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export interface GardenUnit {
  vocabulary: readonly { term: string; gloss: string }[]
  /** The scenes of the unit, as written. */
  scenes: readonly SceneDraft[]
  /** All the items of the unit: the writer's and the late ones. */
  items: readonly AuthoredItem[]
}

/** The words per unit the garden takes at most. */
export const GARDEN_PER_UNIT = 6

/** The words per unit and per course the plan wants at least (the garden is derived, so a short one is a warning, not an error). */
export const GARDEN_MIN_PER_UNIT = 4
export const GARDEN_MIN_PER_COURSE = 13

/** The places where the garden is under the minimums: units with fewer than 4 words, and a course with fewer than 13. `unitOf` gives the unit of a garden word. */
export function gardenWarnings(garden: readonly GardenWord[], unitIds: readonly string[], unitOf: (w: GardenWord) => string | undefined): string[] {
  const out: string[] = []
  const short = unitIds.filter((u) => garden.filter((w) => unitOf(w) === u).length < GARDEN_MIN_PER_UNIT)
  if (short.length) out.push(`the garden has fewer than ${GARDEN_MIN_PER_UNIT} words for ${short.join(', ')}`)
  if (garden.length < GARDEN_MIN_PER_COURSE) out.push(`the garden has ${garden.length} word(s), fewer than ${GARDEN_MIN_PER_COURSE}`)
  return out
}

/**
 * The garden, in code: of each unit's scope vocabulary the words that really occur in its scenes (a say line, or an answer of a reply), up to six,
 * each watered by an item whose answer is the word (or, failing that, a reply item whose answer contains it). A word without such an item, or twice,
 * is left out. The text is the form that occurs (with or without the article), so the lint's vocabulary check finds it. Deterministic order.
 */
export function deriveGarden(units: readonly GardenUnit[], perUnit = GARDEN_PER_UNIT): GardenWord[] {
  const out: GardenWord[] = []
  const seen = new Set<string>()
  for (const u of units) {
    const byId = new Map(u.items.map((it) => [it.id, it]))
    const replied = [...new Set(u.scenes.flatMap((sc) => sc.lines.filter(isSceneReply).map((l) => l.reply)))].map((id) => byId.get(id)).filter((it): it is AuthoredItem => !!it)
    const said = u.scenes.flatMap((sc) => sc.lines.flatMap((l) => (isSceneSay(l) ? [l.text] : l.youSay ? [l.youSay] : [])))
    const corpus = ` ${[...said, ...replied.flatMap(answerTexts)].map(fold).join(' ')} `
    let n = 0
    for (const v of u.vocabulary) {
      if (n >= perUnit) break
      const first = (v.term.split(/[,;(]/)[0] ?? v.term).trim()
      const forms = [...new Set([first, first.replace(ARTICLE, '')])].filter((f) => fold(f))
      const text = forms.find((f) => corpus.includes(` ${fold(f)} `))
      if (!text) continue
      const key = fold(text)
      const answers = (it: AuthoredItem) => answerTexts(it).map(fold)
      const item =
        u.items.find((it) => answers(it).includes(key)) ??
        replied.find((it) => answers(it).some((a) => ` ${a} `.includes(` ${key} `))) ??
        u.items.find((it) => answers(it).some((a) => ` ${a} `.includes(` ${key} `)))
      const slug = slugOf(text)
      if (!item || !slug || seen.has(slug)) continue
      seen.add(slug)
      out.push({ slug, text, gloss: v.gloss, item: item.id })
      n++
    }
  }
  return out
}
