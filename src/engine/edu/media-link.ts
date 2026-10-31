import type { ArtTarget } from '../../shared/art'
import type { TextCatalog } from '../../shared/course'
import type { PackCue } from '../../shared/music'
import { isDerivedItem } from '../../shared/voice'
import type { VoiceMerge } from '../../shared/voice'

/**
 * The media merge of a course (EGS-15): how the assets of the manifest (`course/assets.json`) get into the pack. Pure: it works on the pack and
 * the source catalog as plain objects, so the assemble step (before the files are written) and the tools (on a pack read from disk) use the same
 * code, and the polish and re-assemble loop keeps the links.
 *
 *   pack.assets[]                    one entry per asset with a file: `{id, kind, file: 'assets/<id>/v<n>.webp', alt: 'asset.<id>.alt'}`
 *   catalog `asset.<id>.alt`         the alt text (a catalog key like every visible string)
 *   article.asset, item.asset        the picture of an article or an item (`backAsset` for a flashcard back; a hotspot keeps its own asset id)
 *   shells.config['quiz-arena'].art  `{slot: assetId}`: the backdrops of the quiz arena
 *   shells.config.rpg                (EGS-22) the RPG shell's own fields: `tileset` (tiles), `sprites.hero` (hero), `sprites.npc` (npc-1); the section schemas of
 *                                    the shells are strict, so the other shells' art cannot live in their section
 *   extensions.art[shell][slot]      (EGS-22) the art of every other slot: npc-2.., the rooms of the castle, the plates of the encyclopedia, a backdrop
 *   pack.cues                        (EGS-16) the music and sound-effect cues of the music plan: `music:<area>` loops and one-shot events. The cues this merge
 *                                    makes have ids `cue-music-*` and `cue-sfx-*`; other cues of the pack (a hand-made course's) are left alone
 *   pack.extensions.audio.loops      (EGS-16) `{assetId: {startSec, endSec}}`: the loop points of a track that Chiptune Studio made (the cue schema is strict, so they
 *                                    live in `extensions`; the player loops between them)
 *   voice (EGS-17)                   the spoken clips are audio assets like the others (`voice-<lang>-<key>`); `listening.asset` points at the clip of its transcript
 *                                    (a tone placeholder it had is dropped from the pack); the listening items derived from taught phrases (`<item>-listen`, marked
 *                                    `extensions.voice.derivedFrom`) are put after their source item, with the catalog strings they need; the narration clips are
 *                                    `pack.extensions.narration = {<text key>: <clip id>}` (the encyclopedia shell reads it)
 */

/** One asset that has a file (a selected version, a custom file or a placeholder). */
export interface MediaLink {
  id: string
  kind: 'image' | 'audio'
  /** The path relative to `course/`. */
  file: string
  /** The alt text (an image) or the description (audio), in the course's source language. */
  alt: string
  /** The file is a placeholder card: the lint warns until a real version replaces it. */
  placeholder?: boolean
}

export interface MediaMerge {
  assets: MediaLink[]
  /** What each asset illustrates, by asset id (the art plan's targets). */
  targets: Record<string, ArtTarget>
  /** The cues of the music plan (only for assets that have a file). Missing: the pack's cues are not touched. */
  cues?: PackCue[]
  /** The loop points of the audio assets (seconds), by asset id. */
  loops?: Record<string, { startSec: number; endSec: number }>
  /** The voice plan's links (EGS-17), for the clips that have a file. Missing: the voice links of the pack are not touched. */
  voice?: VoiceMerge
}

export const altKey = (id: string): string => `asset.${id}.alt`

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

export interface MediaApplied {
  /** Assets in the pack after the merge that came from the manifest. */
  assets: number
  /** Links set (article.asset, item.asset, backAsset, shell art). */
  links: number
  /** Cues of the music plan in the pack after the merge (only when the merge carried cues). */
  cues?: number
  /** The voice links in the pack after the merge (only when the merge carried voice): derived listening items, listening items linked to a clip, narration texts. */
  voice?: { derived: number; listening: number; narration: number }
}

/**
 * Merges `merge` into `pack` and `catalog` (both changed in place; `others` are the catalogs of the other languages, for the strings of a derived listening item). Assets that already are in the pack and are not in the merge stay as they are
 * (a hand-made course's own files). A link is set only when its asset has a file, so the pack never points at an image that is not there.
 */
export function applyMedia(pack: Json, catalog: Pick<TextCatalog, 'strings'>, merge: MediaMerge, others: Record<string, Pick<TextCatalog, 'strings'> | undefined> = {}): MediaApplied {
  const assets = Array.isArray(pack.assets) ? (pack.assets as Json[]) : []
  const byId = new Map(merge.assets.map((a) => [a.id, a]))
  const next: Json[] = assets.filter((a) => !byId.has(String(a.id)))
  for (const a of merge.assets) {
    catalog.strings[altKey(a.id)] = a.alt.trim() || a.id
    next.push({ id: a.id, kind: a.kind, file: a.file, alt: altKey(a.id) })
  }
  // keep the order stable: the pack's own assets first, then the merged ones in manifest order
  pack.assets = next
  let links = 0
  const articles = isObj(pack.encyclopedia) && Array.isArray(pack.encyclopedia.articles) ? (pack.encyclopedia.articles as Json[]) : []
  const items = Array.isArray(pack.items) ? (pack.items as Json[]) : []
  const shells = isObj(pack.shells) ? pack.shells : undefined
  for (const [id, t] of Object.entries(merge.targets)) {
    if (!byId.has(id)) continue
    if (t.type === 'article') {
      const a = articles.find((x) => x.id === t.article)
      if (a && a.asset !== id) {
        a.asset = id
        links++
      } else if (a) links++
    } else if (t.type === 'item' || t.type === 'hotspot') {
      const it = items.find((x) => x.id === t.item)
      if (!it) continue
      if (t.type === 'hotspot' || it.kind === 'hotspot') {
        // a hotspot item names its picture already: the merge only has to make sure the asset is the one it names
        if (it.asset === id) links++
        continue
      }
      if (it.kind === 'listening') continue // its asset is audio
      if (t.type === 'item' && t.side === 'back') {
        if (it.kind !== 'flashcard') continue
        it.backAsset = id
      } else it.asset = id
      links++
    } else if (shells) {
      linkShellArt(pack, shells, t.shell, t.slot, id)
      links++
    }
  }
  if (merge.cues) {
    const ours = (id: unknown): boolean => typeof id === 'string' && /^cue-(?:music|sfx)-/.test(id)
    const mine = new Set(merge.cues.map((c) => c.id))
    const old = Array.isArray(pack.cues) ? (pack.cues as Json[]) : []
    pack.cues = [...old.filter((c) => !mine.has(String(c.id)) && !ours(c.id)), ...merge.cues]
  }
  if (merge.loops) {
    const ext: Json = isObj(pack.extensions) ? pack.extensions : (pack.extensions = {})
    const audio: Json = isObj(ext.audio) ? (ext.audio as Json) : (ext.audio = {})
    const loops: Json = isObj(audio.loops) ? { ...(audio.loops as Json) } : {}
    for (const a of merge.assets) if (a.kind === 'audio') delete loops[a.id]
    Object.assign(loops, merge.loops)
    if (Object.keys(loops).length) audio.loops = loops
    else delete audio.loops
    if (Object.keys(audio).length === 0) delete ext.audio
  }
  let voiceApplied: MediaApplied['voice']
  if (merge.voice) voiceApplied = applyVoice(pack, catalog, merge, others)
  return { assets: merge.assets.length, links, ...(merge.cues ? { cues: merge.cues.length } : {}), ...(voiceApplied ? { voice: voiceApplied } : {}) }
}

/** A parenthetical that says a sound is a placeholder ("(In this test course the sound is a placeholder tone, not speech ...)"): it is stale once the clip is real. */
const PLACEHOLDER_NOTE = /\s*\([^()]*placeholder[^()]*\)/gi

/** The voice part of `applyMedia` (see the header): derived items, strings, `listening.asset`, narration, and the placeholder assets the clips replaced. */
function applyVoice(pack: Json, catalog: Pick<TextCatalog, 'strings'>, merge: MediaMerge, others: Record<string, Pick<TextCatalog, 'strings'> | undefined>): NonNullable<MediaApplied['voice']> {
  const v = merge.voice!
  const sourceLang = String(pack.sourceLang)
  // a string that is there is kept: the transcript of a derived item may have been corrected by hand since (the clip speaks the catalog's text)
  for (const [lang, strings] of Object.entries(v.strings)) {
    const into = (lang === sourceLang ? catalog : (others[lang] ?? catalog)).strings
    for (const [key, text] of Object.entries(strings)) if (!(key in into)) into[key] = text
  }

  // derived listening items: replace the ones of an earlier merge (an item the plan dropped goes), put new ones after their source
  const keep = new Set(v.items.map((i) => String(i.id)))
  let items = (Array.isArray(pack.items) ? (pack.items as Json[]) : []).filter((i) => !(isDerivedItem(i) && !keep.has(String(i.id))))
  for (const d of v.items) {
    const id = String(d.id)
    const at = items.findIndex((i) => i.id === id)
    if (at >= 0) items[at] = d
    else {
      const from = (d.extensions as { voice?: { derivedFrom?: string } } | undefined)?.voice?.derivedFrom
      const src = items.findIndex((i) => i.id === from)
      items = src >= 0 ? [...items.slice(0, src + 1), d, ...items.slice(src + 1)] : [...items, d]
    }
  }
  pack.items = items

  // listening items point at their clip; the words that said the sound it had was a placeholder tone go with it
  const placeholderFile = new Set((Array.isArray(pack.assets) ? (pack.assets as Json[]) : []).filter((a) => a.kind === 'audio' && /placeholder/i.test(String(a.file))).map((a) => String(a.id)))
  let listening = 0
  const swapped = new Map<string, string>() // a placeholder tone -> the spoken clip that replaces it
  for (const it of items) {
    const asset = v.listening[String(it.id)]
    if (it.kind === 'listening' && asset) {
      if (typeof it.asset === 'string' && it.asset !== asset && placeholderFile.has(it.asset)) {
        if (!swapped.has(it.asset)) swapped.set(it.asset, asset)
        for (const f of ['explanation', 'hint', 'prompt']) {
          const key = it[f]
          if (typeof key === 'string' && typeof catalog.strings[key] === 'string') catalog.strings[key] = catalog.strings[key].replace(PLACEHOLDER_NOTE, '').trim()
        }
      }
      it.asset = asset
      listening++
    }
  }

  // a shell section that named the tone (a role-play line's clip) points at the spoken clip too
  if (swapped.size && isObj(pack.shells)) {
    const relink = (v: unknown): unknown => (typeof v === 'string' ? (swapped.get(v) ?? v) : Array.isArray(v) ? v.map(relink) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x)])) : v)
    pack.shells.config = relink(pack.shells.config)
  }

  // a placeholder sound of the pack that nothing uses any more (the tone a fixture listening item had) goes: the lint would warn about it
  const inMerge = new Set(merge.assets.map((a) => a.id))
  const used = new Set<string>()
  for (const it of items) for (const f of ['asset', 'backAsset']) if (typeof it[f] === 'string') used.add(it[f] as string)
  for (const a of isObj(pack.encyclopedia) && Array.isArray(pack.encyclopedia.articles) ? (pack.encyclopedia.articles as Json[]) : []) if (typeof a.asset === 'string') used.add(a.asset)
  for (const c of Array.isArray(pack.cues) ? (pack.cues as Json[]) : []) if (typeof c.asset === 'string') used.add(c.asset)
  // every asset a shell section names (the quiz arena's art, the RPG's skin, a role-play line's clip ...): any string of a section that is an asset id of the pack
  const known = new Set((Array.isArray(pack.assets) ? (pack.assets as Json[]) : []).map((a) => String(a.id)))
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (known.has(v)) used.add(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (isObj(v)) Object.values(v).forEach(walk)
  }
  if (isObj(pack.shells)) walk(pack.shells.config)
  if (isObj(pack.extensions) && isObj(pack.extensions.art)) for (const slots of Object.values(pack.extensions.art)) if (isObj(slots)) for (const id of Object.values(slots)) if (typeof id === 'string') used.add(id)
  const gone = (a: Json): boolean => a.kind === 'audio' && /placeholder/i.test(String(a.file)) && !inMerge.has(String(a.id)) && !used.has(String(a.id))
  const all = Array.isArray(pack.assets) ? (pack.assets as Json[]) : []
  pack.assets = all.filter((a) => !gone(a))
  for (const a of all.filter(gone)) if (typeof a.alt === 'string' && !(pack.assets as Json[]).some((o) => o.alt === a.alt)) delete catalog.strings[a.alt] // its alt text said "placeholder tone"

  // narration: the encyclopedia shell reads it from the pack's extensions
  const ext: Json = isObj(pack.extensions) ? pack.extensions : (pack.extensions = {})
  if (Object.keys(v.narration).length) ext.narration = { ...v.narration }
  else delete ext.narration
  return { derived: v.items.length, listening, narration: Object.keys(v.narration).length }
}

/** Where a shell's art goes in the pack (see the header): the quiz arena and the RPG in their sections, the rest in `extensions.art`. */
function linkShellArt(pack: Json, shells: Json, shell: string, slot: string, id: string): void {
  const config: Json = isObj(shells.config) ? (shells.config as Json) : (shells.config = {})
  const section = (): Json => (isObj(config[shell]) ? (config[shell] as Json) : (config[shell] = {}))
  if (shell === 'quiz-arena') {
    const entry = section()
    const art: Json = isObj(entry.art) ? (entry.art as Json) : (entry.art = {})
    art[slot] = id
    return
  }
  if (shell === 'rpg' && (slot === 'tiles' || slot === 'hero' || slot === 'npc-1')) {
    const entry = section()
    if (slot === 'tiles') entry.tileset = id
    else {
      const sprites: Json = isObj(entry.sprites) ? (entry.sprites as Json) : (entry.sprites = {})
      sprites[slot === 'hero' ? 'hero' : 'npc'] = id
    }
    return
  }
  const ext: Json = isObj(pack.extensions) ? (pack.extensions as Json) : (pack.extensions = {})
  const art: Json = isObj(ext.art) ? (ext.art as Json) : (ext.art = {})
  const mine: Json = isObj(art[shell]) ? (art[shell] as Json) : (art[shell] = {})
  mine[slot] = id
}
