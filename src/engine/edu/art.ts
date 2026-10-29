import { z } from 'zod'
import { ART_RATIOS, artAssetId, artSizes, composePrompt, hotspotSizes, shellSlots, styleWords } from '../../shared/art'
import type { ArtKind, ArtPlanEntry, ArtRatio, ArtStyle, ArtTarget, ShellSlot } from '../../shared/art'
import type { RegionShape } from '../../shared/course'
import { resolveArtProvider } from '../../shared/media'
import type { CourseMedia } from '../../shared/media'
import { dropNulls } from './authoring'
import type { Problem } from './authoring'

/**
 * The art-director's work as code (EGS-15): what the role is shown (`ArtSource`: the units, the articles, the items and the shells of a course), the
 * output contract of its answer (`artPlanSchema` and `checkArtPlan`, with one repair round in `askRole`), the deterministic fallback plan used when
 * the model gives no usable answer, and the step that turns the answer into plan entries with stable asset ids, kinds and sizes.
 */

/** The most pictures the art-director may add beside the required ones (an item picture costs one image). */
export const MAX_ITEM_IMAGES = 12

/** The item kinds a picture can go with (a listening item's asset is audio; crosswords and word searches are grids). */
export const PICTURE_KINDS = new Set(['mcq', 'true-false', 'multi-select', 'cloze', 'typed', 'match-pairs', 'order', 'sort-groups', 'flashcard'])

export interface ArtItem {
  id: string
  kind: string
  unit?: string
  /** The question, as text. */
  prompt: string
  /** The item has a picture already (a real file, not a placeholder): it is not planned again. */
  hasPicture: boolean
  /** A hotspot item: the asset it names, its size and its regions. */
  asset?: string
  width?: number
  height?: number
  regions?: { id: string; shape: RegionShape }[]
}

/** What the art-director is told about a course. Built from the pipeline files (before the assemble step) or from the pack of a finished course. */
export interface ArtSource {
  title: string
  subject: string
  audience: string
  age?: string
  /** The name of the language the alt texts are written in. */
  language: string
  units: { id: string; title: string; summary?: string }[]
  articles: { id: string; unit?: string; title: string; body: string; /** The article has a real picture already (not a placeholder): it is not planned again. */ hasPicture?: boolean }[]
  items: ArtItem[]
  /** The shells that get art: the brief's, the game designer's and the pack's. */
  shells: string[]
  characters: { name: string; role: string; description: string }[]
}

const cut = (s: string, n: number): string => {
  const t = s.replace(/\[f\d+(?:\s*,\s*f\d+)*\]/g, '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}...`
}
const firstSentence = (s: string): string => cut(/^[^.!?]*[.!?]?/.exec(cut(s, 400))?.[0] ?? s, 160)

// ---- the output contract ----

const text = (what: string) => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`)
const ident = z.string({ error: 'an id must be a string' }).trim().min(1)
const lenient = <S extends z.ZodType>(s: S) => z.preprocess(dropNulls, s) as unknown as S

export const artPlanSchema = lenient(
  z.object({
    images: z
      .array(
        z.object({
          for: z.enum(['article', 'item', 'shell'], { error: 'for is article, item or shell' }),
          /** An article id (`for: article`) or an item id (`for: item`). */
          id: ident.optional(),
          shell: text('the shell id').optional(),
          slot: text('the slot').optional(),
          side: z.enum(['front', 'back'], { error: 'side is front or back' }).optional(),
          ratio: z.enum(ART_RATIOS as unknown as [ArtRatio, ...ArtRatio[]], { error: 'ratio is 4:3, 16:9 or 1:1' }).optional(),
          prompt: text('what to draw'),
          alt: text('the alt text')
        }),
        { error: 'images must be a list of {for, id | shell + slot, prompt, alt}' }
      )
      .min(1, 'give at least one image'),
    notes: z.string().default('')
  })
)
export type ArtPlanOutput = z.output<typeof artPlanSchema>
export type ArtLine = ArtPlanOutput['images'][number]

const problem = (ref: string, issue: string, fix?: string): Problem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })

/** The slots of every shell the course has, with the context the table needs. */
export function slotsOf(src: ArtSource): { shell: string; slot: ShellSlot }[] {
  return src.shells.flatMap((shell) => shellSlots(shell, { units: src.units, articles: src.articles }).map((slot) => ({ shell, slot })))
}

/** The line a hotspot item needs: it names the asset the pack already has. */
const hotspotsToDraw = (src: ArtSource): ArtItem[] => src.items.filter((i) => i.kind === 'hotspot' && !i.hasPicture)

/** What an answer must cover: a picture for every article, every required slot of every shell, and every hotspot item that has no picture yet. */
export function checkArtPlan(plan: ArtPlanOutput, src: ArtSource): Problem[] {
  const out: Problem[] = []
  const articles = new Set(src.articles.filter((a) => !a.hasPicture).map((a) => a.id))
  const items = new Map(src.items.map((i) => [i.id, i]))
  const slots = new Map(slotsOf(src).map((s) => [`${s.shell}/${s.slot.slot}`, s.slot]))
  const seen = new Set<string>()
  const covered = new Set<string>()
  let itemPictures = 0
  plan.images.forEach((l, n) => {
    const where = `image ${n + 1}`
    let key: string
    if (l.for === 'article') {
      if (!l.id || !articles.has(l.id)) return void out.push(problem(l.id ?? where, `no article with this id`, `use one of: ${[...articles].join(', ') || '(the course has no article)'}`))
      key = `article/${l.id}`
    } else if (l.for === 'item') {
      const it = l.id ? items.get(l.id) : undefined
      if (!it) return void out.push(problem(l.id ?? where, 'no item with this id', 'use the id of one of the items listed'))
      if (it.kind === 'listening') return void out.push(problem(it.id, 'a listening item has sound, not a picture'))
      if (it.kind !== 'hotspot' && !PICTURE_KINDS.has(it.kind)) return void out.push(problem(it.id, `a ${it.kind} item has no place for a picture`))
      if (it.kind !== 'hotspot' && it.hasPicture) return void out.push(problem(it.id, 'this item has a picture already', 'leave it out'))
      if (l.side === 'back' && it.kind !== 'flashcard') return void out.push(problem(it.id, 'only a flashcard has a back picture (side: back)'))
      key = `item/${it.id}${l.side === 'back' ? '/back' : ''}`
      if (it.kind !== 'hotspot') itemPictures++
    } else {
      if (!l.shell || !l.slot) return void out.push(problem(where, 'a shell image names its shell and its slot'))
      if (!slots.has(`${l.shell}/${l.slot}`)) return void out.push(problem(`${l.shell}/${l.slot}`, 'no such slot', `the slots of ${l.shell}: ${[...slots.keys()].filter((k) => k.startsWith(`${l.shell}/`)).map((k) => k.split('/')[1]).join(', ') || '(this shell is not in the course)'}`))
      key = `shell/${l.shell}/${l.slot}`
    }
    if (seen.has(key)) out.push(problem(key, 'this picture is planned twice', 'one line for each'))
    seen.add(key)
    covered.add(key)
    if (l.prompt.length < 12) out.push(problem(key, 'the prompt is too short to draw from', 'say what the picture shows'))
  })
  if (itemPictures > MAX_ITEM_IMAGES) out.push(problem('', `${itemPictures} item pictures, at most ${MAX_ITEM_IMAGES}`, 'keep the ones that help most'))
  const missing: string[] = []
  for (const a of src.articles) if (!a.hasPicture && !covered.has(`article/${a.id}`)) missing.push(`an article picture for ${a.id}`)
  for (const [k, slot] of slots) if (slot.required && !covered.has(`shell/${k}`)) missing.push(`the shell image ${k.replace('/', ' / ')}`)
  for (const h of hotspotsToDraw(src)) if (!covered.has(`item/${h.id}`)) missing.push(`the picture of the hotspot item ${h.id}`)
  if (missing.length) out.push(problem('', `missing: ${missing.slice(0, 20).join('; ')}${missing.length > 20 ? `; and ${missing.length - 20} more` : ''}`, 'add a line for each'))
  return out
}

// ---- the deterministic fallback ----

/** The plan made from the course text alone: an article picture for each article, the required slots of each shell, the hotspot pictures. */
export function fallbackArtLines(src: ArtSource): ArtLine[] {
  const lines: ArtLine[] = []
  for (const a of src.articles.filter((x) => !x.hasPicture)) {
    lines.push({ for: 'article', id: a.id, ratio: '4:3', prompt: `a picture that shows ${a.title}: ${firstSentence(a.body)}`, alt: `A picture for the article "${a.title}"` })
  }
  for (const h of hotspotsToDraw(src)) lines.push({ for: 'item', id: h.id, prompt: `an illustration for the question "${cut(h.prompt, 120)}", with clear separate places to point at`, alt: `A picture for the question "${cut(h.prompt, 80)}"` })
  const hero = src.characters[0]
  for (const { shell, slot } of slotsOf(src)) {
    const who = /^npc-(\d+)$/.exec(slot.slot) ? src.characters[Number(/^npc-(\d+)$/.exec(slot.slot)![1]) % Math.max(1, src.characters.length)] : slot.slot === 'hero' ? hero : undefined
    const subject = `${slot.describe}, about ${src.subject}${who ? `; ${who.name}, ${who.description}` : ''}`
    lines.push({ for: 'shell', shell, slot: slot.slot, ratio: slot.ratio, prompt: subject, alt: cut(`${slot.describe}`.replace(/: .*$/, ''), 120) || `The art of ${shell}` })
  }
  return lines
}

// ---- from lines to entries ----

export interface ResolveOptions {
  media: Pick<CourseMedia, 'art'>
  by: 'model' | 'fallback'
}

/** A line of the plan as the entry it makes: the asset id, kind, style, prompt, provider and sizes. Lines the course cannot place are dropped. */
export function resolveArtEntries(lines: readonly ArtLine[], src: ArtSource, o: ResolveOptions): ArtPlanEntry[] {
  const art = o.media.art
  const items = new Map(src.items.map((i) => [i.id, i]))
  const slots = new Map(slotsOf(src).map((s) => [`${s.shell}/${s.slot.slot}`, s.slot]))
  const provider = ((p) => (p === 'flow' || p === 'hand' ? p : 'comfy'))(resolveArtProvider(art))
  const out = new Map<string, ArtPlanEntry>()
  for (const l of lines) {
    let target: ArtTarget
    let kind: ArtKind
    let own: string | undefined
    let sizes = artSizes('illustration', l.ratio ?? '4:3')
    if (l.for === 'article' && l.id) {
      const article = src.articles.find((a) => a.id === l.id)
      if (!article || article.hasPicture) continue
      target = { type: 'article', article: l.id }
      kind = 'illustration'
    } else if (l.for === 'item' && l.id) {
      const it = items.get(l.id)
      if (!it || (it.kind !== 'hotspot' && !PICTURE_KINDS.has(it.kind))) continue // a listening item has sound, a crossword is a grid
      if (it.kind === 'hotspot') {
        target = { type: 'hotspot', item: it.id }
        own = it.asset
        sizes = it.width && it.height ? hotspotSizes(it.width, it.height) : sizes
      } else target = { type: 'item', item: it.id, ...(l.side === 'back' ? { side: 'back' as const } : {}) }
      kind = 'illustration'
    } else if (l.for === 'shell' && l.shell && l.slot) {
      const slot = slots.get(`${l.shell}/${l.slot}`)
      if (!slot) continue
      target = { type: 'shell', shell: l.shell, slot: l.slot }
      kind = slot.kind
      sizes = artSizes(kind, l.ratio ?? slot.ratio ?? '4:3')
    } else continue
    const style: ArtStyle = kind === 'sprite' || kind === 'tileset' ? 'pixel' : art.style
    const id = artAssetId(target, own)
    if (out.has(id)) continue
    out.set(id, { id, kind, target, prompt: composePrompt(kind, l.prompt, style, art.stylePrompt), alt: l.alt.trim(), style, provider, size: sizes.size, fit: sizes.fit, by: o.by })
  }
  return [...out.values()]
}

// ---- what the prompt shows ----

/** The variables of `prompts/art-director/plan.md`. */
export function artPromptVars(src: ArtSource, media: Pick<CourseMedia, 'art'>): Record<string, string | number> {
  const slots = slotsOf(src)
  const itemLines = src.items.filter((i) => (PICTURE_KINDS.has(i.kind) && !i.hasPicture) || (i.kind === 'hotspot' && !i.hasPicture)).slice(0, 60)
  return {
    title: src.title,
    subject: src.subject,
    audience: src.audience,
    age: src.age ?? 'not given',
    language: src.language,
    style: media.art.style,
    style_words: styleWords(media.art.style, media.art.stylePrompt),
    units: src.units.map((u) => `- ${u.id}: ${u.title}`).join('\n') || '(none)',
    articles: src.articles.map((a) => `- ${a.id} (unit ${a.unit ?? '-'}): ${a.title}. ${cut(a.body, 220)}`).join('\n') || '(the course has no article)',
    items: itemLines.map((i) => `- ${i.id} (${i.kind}${i.unit ? `, unit ${i.unit}` : ''}${i.kind === 'hotspot' ? `, REQUIRED: a picture ${i.width ?? '?'} by ${i.height ?? '?'} with its regions drawn over it by code` : ''}): ${cut(i.prompt, 130)}`).join('\n') || '(none)',
    slots: slots.map(({ shell, slot }) => `- shell ${shell}, slot ${slot.slot} (${slot.kind}${slot.ratio ? `, ratio ${slot.ratio}` : ''}${slot.required ? ', REQUIRED' : ''}): ${slot.describe}`).join('\n') || '(none)',
    max_item_images: MAX_ITEM_IMAGES,
    characters: src.characters.map((c) => `- ${c.name} (${c.role}): ${c.description}`).join('\n') || '(none)',
    shells: src.shells.join(', ')
  }
}
