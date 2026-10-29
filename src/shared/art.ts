/**
 * The art plan of a course (EGS-15): what the art-director asked for, as data (`courses/<slug>/pipeline/art.json`), and the rules that turn
 * "what does this picture illustrate" into a stable asset id, a kind and a size. Pure (no DOM, no node), so the engine, the tools and the tests
 * share it.
 *
 * Asset ids come from WHAT THEY ILLUSTRATE, never from a counter, so a rerun of the plan finds the same ids and keeps the versions it made:
 *   img-article-<articleId>              the picture of an encyclopedia article
 *   img-item-<itemId>                    the picture of an item (a flashcard front, a question); `-back` for the back of a flashcard
 *   <the item's own asset id>            a hotspot item keeps the asset id it names
 *   img-<shell>-<slot>                   the art of a shell: img-quiz-arena-bg-u1, img-quiz-arena-bg-boss, img-mindmaze-room-u2,
 *                                        img-encyclopedia-plate-<articleId>, img-rpg-tiles, img-rpg-hero, img-rpg-npc-1
 */

export const ART_KINDS = ['background', 'illustration', 'sprite', 'tileset'] as const
export type ArtKind = (typeof ART_KINDS)[number]
export type ArtStyle = 'illustrated' | 'pixel'
export type ArtRatio = '4:3' | '16:9' | '1:1'
export const ART_RATIOS: readonly ArtRatio[] = ['4:3', '16:9', '1:1']

/** What a picture illustrates. */
export type ArtTarget =
  | { type: 'article'; article: string }
  /** `front`: `item.asset` (a flashcard front or the picture beside a question); `back`: a flashcard's `backAsset`. */
  | { type: 'item'; item: string; side?: 'front' | 'back' }
  /** A hotspot item: its own image, fitted to its width and height, with its regions drawn faintly over it by code. */
  | { type: 'hotspot'; item: string }
  /** The art of a shell: `shells.config[shell].art[slot]`. */
  | { type: 'shell'; shell: string; slot: string }

/** One picture of the plan. */
export interface ArtPlanEntry {
  /** The asset id (see the rules above). */
  id: string
  kind: ArtKind
  target: ArtTarget
  /** The full prompt: the style words, what to draw and the framing. A person can change it with `edu_asset_set` (the plan then keeps it). */
  prompt: string
  /** What the picture shows, in a sentence, in the language of the course: the alt text. */
  alt: string
  style: ArtStyle
  /** Who makes it, as the course settings said at the time of the plan: `comfy` (ComfyUI), `flow` (Google Flow) or `hand`. */
  provider: 'comfy' | 'flow' | 'hand'
  /** The size the image is generated at. */
  size: { w: number; h: number }
  /** The size it is fitted to. */
  fit: { w: number; h: number }
  /** Who wrote the line: the art-director model, or the deterministic fallback. */
  by: 'model' | 'fallback'
}

export interface ArtPlanFile {
  version: 1
  /** `model`: the art-director's plan; `fallback`: made from the course text (the model gave no usable answer, or none was asked). */
  source: 'model' | 'fallback'
  /** Why the fallback was used. */
  note?: string
  style: ArtStyle
  at: string
  entries: ArtPlanEntry[]
}

// ---- ids ----

const idPart = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

/** The asset id of what a picture illustrates. A hotspot item keeps the id of the asset it already names (`own`). */
export function artAssetId(t: ArtTarget, own?: string): string {
  switch (t.type) {
    case 'article':
      return `img-article-${idPart(t.article)}`
    case 'item':
      return `img-item-${idPart(t.item)}${t.side === 'back' ? '-back' : ''}`
    case 'hotspot':
      return own ?? `img-item-${idPart(t.item)}`
    case 'shell':
      return `img-${idPart(t.shell)}-${idPart(t.slot)}`
  }
}

// ---- sizes ----

export interface ArtSizes {
  size: { w: number; h: number }
  fit: { w: number; h: number }
}

/** The generation size and the final size of a picture by kind (and, for an illustration, its ratio). A hotspot's final size is its item's. */
export function artSizes(kind: ArtKind, ratio: ArtRatio = '4:3'): ArtSizes {
  switch (kind) {
    case 'background':
      return { size: { w: 1664, h: 928 }, fit: { w: 1280, h: 720 } }
    case 'sprite':
      return { size: { w: 928, h: 1664 }, fit: { w: 384, h: 384 } } // fit.h is the sprite height; the width follows the figure
    case 'tileset':
      return { size: { w: 1024, h: 1024 }, fit: { w: 512, h: 512 } }
    case 'illustration':
      return ratio === '16:9' ? { size: { w: 1664, h: 928 }, fit: { w: 1280, h: 720 } } : ratio === '1:1' ? { size: { w: 1024, h: 1024 }, fit: { w: 768, h: 768 } } : { size: { w: 1152, h: 864 }, fit: { w: 960, h: 720 } }
  }
}

/** The size of a hotspot picture: the item's width and height, scaled so the generator gets a size it can make (long side about 1152). */
export function hotspotSizes(width: number, height: number): ArtSizes {
  const k = 1152 / Math.max(width, height)
  const snap = (n: number): number => Math.max(256, Math.round((n * k) / 32) * 32)
  return { size: { w: snap(width), h: snap(height) }, fit: { w: Math.round(width), h: Math.round(height) } }
}

// ---- the slots of a shell ----

export interface ShellSlot {
  slot: string
  kind: ArtKind
  /** What the slot is for, in words for the art-director and the fallback. */
  describe: string
  /** The art plan must have it (the plan is checked for every required slot). */
  required: boolean
  ratio?: ArtRatio
}

export interface SlotContext {
  units: { id: string; title: string }[]
  articles: { id: string; title: string }[]
}

/** How many NPC sprites the RPG shell gets: one per unit, at least 2 and at most 4. */
export const rpgNpcCount = (units: number): number => Math.min(4, Math.max(2, units))

/**
 * The slots of a shell, a table in code. Any shell id is accepted: a shell this table does not know gets one backdrop. The shells that
 * the player does not have yet (mindmaze, rpg, encyclopedia ... EGS-10..14) get their art all the same: the pack records it in
 * `shells.config[<shell>].art`.
 */
export function shellSlots(shell: string, ctx: SlotContext): ShellSlot[] {
  switch (shell) {
    case 'quiz-arena':
      return [
        ...ctx.units.map((u) => ({ slot: `bg-${u.id}`, kind: 'background' as const, required: true, describe: `the backdrop of the quiz arena in the unit "${u.title}": an empty scene that fits the topic, nothing in the middle` })),
        { slot: 'bg-boss', kind: 'background' as const, required: true, describe: 'the backdrop of the boss round that mixes every unit: a dramatic empty scene that fits the topic' }
      ]
    case 'mindmaze':
      return ctx.units.map((u) => ({ slot: `room-${u.id}`, kind: 'background' as const, required: true, describe: `a castle room for the unit "${u.title}": an empty stone room with a door, in the mood of the topic` }))
    case 'encyclopedia':
      return ctx.articles.map((a) => ({ slot: `plate-${a.id}`, kind: 'illustration' as const, required: true, ratio: '4:3' as const, describe: `a collector's plate (a framed museum-style picture) for the article "${a.title}"` }))
    case 'rpg':
      return [
        { slot: 'tiles', kind: 'tileset' as const, required: true, describe: 'a pixel-art tile set for the overworld: grass, path, water, wall, tree, door, floor, in a 4 by 4 grid of square tiles' },
        { slot: 'hero', kind: 'sprite' as const, required: true, describe: 'the hero: a learner on a quest, one standing figure facing the viewer' },
        ...Array.from({ length: rpgNpcCount(ctx.units.length) }, (_, i) => ({ slot: `npc-${i + 1}`, kind: 'sprite' as const, required: true, describe: `the non-player character ${i + 1}: a guide or a keeper of knowledge for the topic, one standing figure` }))
      ]
    default:
      return [{ slot: 'backdrop', kind: 'background' as const, required: true, describe: `the backdrop of the shell "${shell}": an empty scene that fits the topic` }]
  }
}

// ---- the pieces of a prompt ----

/** The default style words of an art style (a course's `art.stylePrompt` replaces them). */
export function styleWords(style: ArtStyle, stylePrompt?: string): string {
  if (stylePrompt?.trim()) return stylePrompt.trim()
  return style === 'pixel' ? 'pixel art, limited colour palette, crisp square pixels, clean readable shapes, no text' : 'clean flat educational illustration, soft colours, clear simple shapes, readable at a small size, no text'
}

/** What every picture must not have: text and letters (a model cannot spell, and the course text is the only text). */
export const ART_NEGATIVE = 'text, letters, words, numbers, captions, labels, watermark, signature, logo, blurry, low quality, distorted, deformed, extra limbs, cropped'

/** The framing words of a kind. */
export function framingWords(kind: ArtKind): string {
  switch (kind) {
    case 'background':
      return 'wide landscape composition, full-bleed artwork filling the whole frame, no border, no people in the middle'
    case 'illustration':
      return 'one clear subject, centred, full-bleed artwork filling the whole frame, no border'
    case 'sprite':
      return 'one character, full body, standing, facing the viewer, centred, plain flat light grey background, nothing else in the picture'
    case 'tileset':
      return 'a tile sheet: a 4 by 4 grid of equal square game tiles that tile seamlessly, flat top-down view, no gaps between tiles'
  }
}

/** The whole prompt of a picture: the style, the subject and the framing. */
export function composePrompt(kind: ArtKind, subject: string, style: ArtStyle, stylePrompt?: string): string {
  return [styleWords(style, stylePrompt), subject.trim().replace(/[.\s]+$/, ''), framingWords(kind)].join(', ')
}
