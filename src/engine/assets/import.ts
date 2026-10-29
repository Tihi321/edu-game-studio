import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { AUDIO_KINDS, IMAGE_KINDS } from '../../shared/media'
import type { AssetEntry } from '../../shared/media'
import { setCustom } from './manifest'
import { dropPlaceholder } from './placeholder'

/**
 * Importing a file you made yourself (or got from somewhere) as an asset, for `edu_asset_replace` (ported from VN Studio's `import.ts`, without
 * the post-processing: a course takes the file as it is, so what you made is what the player shows). The asset becomes `source: custom` and
 * locked: the pipeline never regenerates it. A placeholder it had is removed.
 */

export const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.opus', '.flac', '.m4a']
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']

/** Throws a clear error when `file` cannot be the asset: a wrong extension for its kind, or an image that does not decode. */
export async function checkImportFile(entry: Pick<AssetEntry, 'id' | 'kind'>, file: string): Promise<void> {
  const ext = path.extname(file).toLowerCase()
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) throw new Error(`"${file}" is not a file`)
  if (entry.kind === 'voiceRef') throw new Error('voice references are uploaded, not imported here')
  if (IMAGE_KINDS.has(entry.kind)) {
    if (!IMAGE_EXTENSIONS.includes(ext)) throw new Error(`${entry.id} is an image: use a ${IMAGE_EXTENSIONS.join(', ')} file (got ${ext || 'no extension'})`)
    if (ext === '.svg') {
      if (!/<svg[\s>]/i.test(await fs.readFile(file, 'utf8'))) throw new Error(`"${path.basename(file)}" is not an SVG image`)
    } else await sharp(await fs.readFile(file)).metadata() // a file that is not an image fails here, with sharp's own message
  } else if (AUDIO_KINDS.has(entry.kind)) {
    if (!AUDIO_EXTENSIONS.includes(ext)) throw new Error(`${entry.id} is audio: use a ${AUDIO_EXTENSIONS.join(', ')} file (got ${ext || 'no extension'})`)
  } else throw new Error(`cannot import a file as ${entry.kind}`)
}

/** Imports `file` as the asset: copied to `assets/<id>/custom.<ext>`, `source: custom`, locked. */
export async function importAssetFile(projectDir: string, entry: AssetEntry, file: string): Promise<AssetEntry> {
  await checkImportFile(entry, file)
  const custom = await setCustom(projectDir, entry, file)
  return dropPlaceholder(projectDir, { ...custom, review: { status: 'approved', note: 'a file made by hand: not reviewed' } })
}
