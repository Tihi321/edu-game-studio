import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { assetManifestSchema, type AssetEntry, type AssetManifest, type AssetVersion } from '../../shared/media'
import { atomicWrite } from '../store/atomic'

/** `courses/<slug>/course/assets.json` (`projectDir` is `courses/<slug>/course`; EGS-15 moved it into `course/`) */
export const manifestPath = (projectDir: string) => path.join(projectDir, 'assets.json')
/** `courses/<slug>/course/assets/<id>/` */
export const assetDir = (projectDir: string, id: string) => path.join(projectDir, 'assets', id)

/** Loads `assets.json`; a missing file is an empty manifest. */
export async function loadManifest(projectDir: string): Promise<AssetManifest> {
  let text: string
  try {
    text = await fs.readFile(manifestPath(projectDir), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { assets: [] }
    throw e
  }
  return assetManifestSchema.parse(JSON.parse(text))
}

export async function saveManifest(projectDir: string, manifest: AssetManifest): Promise<void> {
  await atomicWrite(manifestPath(projectDir), JSON.stringify(assetManifestSchema.parse(manifest), null, 2) + '\n')
}

export interface MergeResult {
  manifest: AssetManifest
  /** Ids that are new in the derived list. */
  added: string[]
  /** Ids in the manifest that the book no longer needs. They are kept (never deleted) but listed here. */
  orphaned: string[]
}

/**
 * Merges the freshly derived stubs into the stored manifest. Existing entries keep their versions, selection, custom
 * file, lock, seed and review; an entry that already has a prompt or versions keeps its prompt, negative, engine and size,
 * otherwise the derived values win. New ids are added; ids the book no longer needs are kept and reported as orphaned.
 * `AssetEntry` has no orphan flag, so callers use `orphaned` to hide them.
 */
export function mergeDerived(existing: AssetManifest | AssetEntry[], derived: AssetEntry[]): MergeResult {
  const old = Array.isArray(existing) ? existing : existing.assets
  const byId = new Map(old.map((e) => [e.id, e]))
  const added: string[] = []
  const assets: AssetEntry[] = []
  for (const d of derived) {
    const e = byId.get(d.id)
    if (!e) {
      added.push(d.id)
      assets.push(d)
      continue
    }
    const keep = e.prompt !== '' || e.versions.length > 0
    assets.push({
      ...e,
      kind: d.kind,
      refs: d.refs ?? e.refs,
      ...(keep ? {} : { prompt: d.prompt || e.prompt, negative: e.negative ?? d.negative, engine: d.engine, size: d.size })
    })
  }
  const derivedIds = new Set(derived.map((d) => d.id))
  const orphaned = old.filter((e) => !derivedIds.has(e.id)).map((e) => e.id)
  for (const id of orphaned) assets.push(byId.get(id)!)
  return { manifest: { assets }, added, orphaned }
}

export function getEntry(manifest: AssetManifest, id: string): AssetEntry | undefined {
  return manifest.assets.find((e) => e.id === id)
}

/** A manifest with `entry` replacing the one of the same id (appended when new). */
export function replaceEntry(manifest: AssetManifest, entry: AssetEntry): AssetManifest {
  const has = manifest.assets.some((e) => e.id === entry.id)
  return { assets: has ? manifest.assets.map((e) => (e.id === entry.id ? entry : e)) : [...manifest.assets, entry] }
}

/** The next version number (`max + 1`; versions are never renumbered). */
export function nextVersionN(entry: AssetEntry): number {
  return entry.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1
}

/** Records a version (its file already written) and selects it by default. A generated version makes the entry `generated` again. */
export function addVersion(entry: AssetEntry, version: AssetVersion, opts: { select?: boolean } = {}): AssetEntry {
  if (entry.versions.some((v) => v.n === version.n)) throw new Error(`${entry.id}: version ${version.n} already exists`)
  const select = opts.select !== false
  return {
    ...entry,
    versions: [...entry.versions, version],
    selected: select ? version.n : entry.selected,
    source: select ? 'generated' : entry.source
  }
}

/** Selects an existing version (and goes back to the generated source if the asset was custom). */
export function pickVersion(entry: AssetEntry, n: number): AssetEntry {
  if (!entry.versions.some((v) => v.n === n)) throw new Error(`${entry.id}: no version ${n}`)
  return { ...entry, selected: n, source: 'generated' }
}

/** Copies `file` to `assets/<id>/custom.<ext>` and makes it the asset: source `custom`, locked. */
export async function setCustom(projectDir: string, entry: AssetEntry, file: string): Promise<AssetEntry> {
  const ext = path.extname(file).toLowerCase() || '.bin'
  const dir = assetDir(projectDir, entry.id)
  await fs.mkdir(dir, { recursive: true })
  for (const f of await fs.readdir(dir)) if (/^custom\./.test(f)) await fs.rm(path.join(dir, f), { force: true })
  const name = `custom${ext}`
  await fs.copyFile(file, path.join(dir, name))
  return { ...entry, source: 'custom', customFile: name, locked: true }
}

export function unlock(entry: AssetEntry): AssetEntry {
  return { ...entry, locked: false }
}

export function lock(entry: AssetEntry): AssetEntry {
  return { ...entry, locked: true }
}

/** The file the build uses: the custom file when `source` is custom, else the selected version. Null when there is none on disk. */
export function resolveFile(projectDir: string, entry: AssetEntry): string | null {
  let name: string | undefined
  if (entry.source === 'custom') name = entry.customFile
  else name = entry.versions.find((v) => v.n === entry.selected)?.file
  if (!name) return null
  const file = path.join(assetDir(projectDir, entry.id), name)
  return existsSync(file) ? file : null
}
