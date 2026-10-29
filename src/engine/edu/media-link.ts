import type { ArtTarget } from '../../shared/art'
import type { TextCatalog } from '../../shared/course'
import type { PackCue } from '../../shared/music'

/**
 * The media merge of a course (EGS-15): how the assets of the manifest (`course/assets.json`) get into the pack. Pure: it works on the pack and
 * the source catalog as plain objects, so the assemble step (before the files are written) and the tools (on a pack read from disk) use the same
 * code, and the polish and re-assemble loop keeps the links.
 *
 *   pack.assets[]                    one entry per asset with a file: `{id, kind, file: 'assets/<id>/v<n>.webp', alt: 'asset.<id>.alt'}`
 *   catalog `asset.<id>.alt`         the alt text (a catalog key like every visible string)
 *   article.asset, item.asset        the picture of an article or an item (`backAsset` for a flashcard back; a hotspot keeps its own asset id)
 *   shells.config[shell].art         `{slot: assetId}`: the art of a shell, also of the shells the player does not have yet
 *   pack.cues                        (EGS-16) the music and sound-effect cues of the music plan: `music:<area>` loops and one-shot events. The cues this merge
 *                                    makes have ids `cue-music-*` and `cue-sfx-*`; other cues of the pack (a hand-made course's) are left alone
 *   pack.extensions.audio.loops      (EGS-16) `{assetId: {startSec, endSec}}`: the loop points of a track that Chiptune Studio made (the cue schema is strict, so they
 *                                    live in `extensions`; the player loops between them)
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
}

/**
 * Merges `merge` into `pack` and `catalog` (both changed in place). Assets that already are in the pack and are not in the merge stay as they are
 * (a hand-made course's own files). A link is set only when its asset has a file, so the pack never points at an image that is not there.
 */
export function applyMedia(pack: Json, catalog: Pick<TextCatalog, 'strings'>, merge: MediaMerge): MediaApplied {
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
      const config = isObj(shells.config) ? shells.config : (shells.config = {})
      const entry: Json = isObj(config[t.shell]) ? (config[t.shell] as Json) : (config[t.shell] = {})
      const art: Json = isObj(entry.art) ? (entry.art as Json) : (entry.art = {})
      art[t.slot] = id
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
  return { assets: merge.assets.length, links, ...(merge.cues ? { cues: merge.cues.length } : {}) }
}
