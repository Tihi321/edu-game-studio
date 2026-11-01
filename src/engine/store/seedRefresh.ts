import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomic'

/**
 * Seed refresh. The data folder is made from `seed/` and never overwritten, so a prompt or config improved in a new release never reached
 * an existing data folder. This keeps the hash of each seed file as it was copied (`.seed-hashes.json`):
 *
 * - the file is not there: copy it;
 * - it is the same as the seed: nothing to do;
 * - it is still the seed version that was copied (its hash is the recorded one, or a known earlier seed version): untouched, so update it;
 * - otherwise you edited it (or the app did): keep it, and note that an update is available.
 *
 * Text is hashed with line endings normalised (Windows checkouts have CRLF).
 */

export const SEED_HASHES_FILE = '.seed-hashes.json'

export const seedHash = (content: string | Buffer): string => createHash('sha1').update(content.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')

/**
 * The hashes of earlier seed versions, per file, for data folders made before the hashes were recorded (a file whose hash is in here was never
 * edited, so a newer seed version may replace it). A release that changes a seed file adds the hash of the old version here.
 * EGS-29: the formats and the two verb-unit prompts.
 * EGS-06: the skeleton's roles.md (the director only) and providers.md (no search providers). EGS-07: the skeleton's studios.md (no Scriptorium).
 */
export const SEED_HISTORY: Record<string, string[]> = {
  'config/roles.md': ['9e88b188a02d708205d434ffc5fb8808bb219d88'],
  'config/providers.md': ['5aecc02009ddbba887510a274691d7b79d068af0'],
  'config/studios.md': ['37a657caf935ec861a816ac7a3809bf0abf100c2'],
  // EGS-29: language-a1 only (no A2 / B1, no verb units); the curriculum and scope prompts before the verb-unit note.
  'config/formats.md': ['3633c790d5a018cfe77907fa3bdab9424c3a6e02'],
  'prompts/curriculum-designer/curriculum.md': ['efabbebdfa66580082fa27a7a35871803f3592b7'],
  // EGS-30: the writer prompts before the {{language_rules}} block, and the language coach agent.
  'prompts/language-coach/scope.md': ['dbb3818a2d982a14d7393b146160e9e291f9b0ec', '0a0652273ba7ebc68df3b4967880ac90533dd068'],
  'prompts/item-writer/items.md': ['abb0d76e2427f4d4efa2c197bd984aebfa3dfbe6'],
  'prompts/item-writer/items_revise.md': ['be4a25db18916d47ae5a1176b10abbe0939af450'],
  'prompts/language-coach/accepted.md': ['b3b07d18991a0d74005d716b1f7bf79a26d8521c'],
  'prompts/misconception-designer/distractors.md': ['60c7d76084a44ca6ef73c0756c93daf4a8939b42'],
  'prompts/explainer/explain.md': ['97b72f05ed74ab8c4805036e5fa0068e34d9a601'],
  'prompts/fact-checker/fact_check.md': ['d40f651bc39e2defbf8fc423d7ea2b008635ec73'],
  'agents/language-coach-ines-markovic.md': ['9c2f75b0bb382873742e7ba9366a563682c3388f']
}

export interface SeedState {
  version: 1
  /** Seed file (relative, `/`) -> hash of the seed version that was last copied or confirmed. */
  files: Record<string, string>
  /** Files you edited that have a newer seed version. */
  updateAvailable: string[]
  /** Ids of the one-time migrations that ran (see `seedMigrations.ts`). */
  migrations: string[]
}

export const emptySeedState = (): SeedState => ({ version: 1, files: {}, updateAvailable: [], migrations: [] })

export type SeedAction = 'copy' | 'same' | 'update' | 'keep'

/**
 * What to do with one seed file. `destHash` is null when the file is not in the data folder. Returns the action and the new state of that file
 * (`recorded`: the hash to remember, or undefined to forget; `pending`: an update is available for the edited file).
 */
export function planSeedFile(rel: string, seed: string, destHash: string | null, state: Pick<SeedState, 'files'>, history: Record<string, string[]> = SEED_HISTORY): { action: SeedAction; recorded: string | undefined; pending: boolean } {
  const recorded = state.files[rel]
  if (destHash === null) return { action: 'copy', recorded: seed, pending: false }
  if (destHash === seed) return { action: 'same', recorded: seed, pending: false }
  const past = history[rel] ?? []
  const untouched = destHash === recorded || past.includes(destHash)
  if (untouched) return { action: 'update', recorded: seed, pending: false }
  // edited by you. A seed that did not change since the version your file came from has no update; a changed one does.
  const seedChanged = recorded !== undefined ? recorded !== seed : !past.includes(seed)
  return { action: 'keep', recorded: recorded ?? (seedChanged ? undefined : seed), pending: seedChanged }
}

export async function loadSeedState(dataDir: string): Promise<SeedState> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(dataDir, SEED_HASHES_FILE), 'utf8')) as Partial<SeedState>
    return { version: 1, files: { ...(j.files ?? {}) }, updateAvailable: [...(j.updateAvailable ?? [])], migrations: [...(j.migrations ?? [])] }
  } catch {
    return emptySeedState()
  }
}

export async function saveSeedState(dataDir: string, state: SeedState): Promise<void> {
  const sorted: SeedState = { version: 1, files: Object.fromEntries(Object.entries(state.files).sort(([a], [b]) => a.localeCompare(b))), updateAvailable: [...state.updateAvailable].sort(), migrations: [...state.migrations] }
  await atomicWrite(path.join(dataDir, SEED_HASHES_FILE), JSON.stringify(sorted, null, 2) + '\n')
}

/** The seeded files with a newer version that you edited (kept), from the last `initDataFolder`. */
export async function readSeedNotes(dataDir: string): Promise<{ updateAvailable: string[] }> {
  return { updateAvailable: (await loadSeedState(dataDir)).updateAvailable }
}

/** Applies `planSeedFile` to one file on disk and updates the state. Returns the action taken. */
export async function syncSeedFile(rel: string, from: string, to: string, state: SeedState): Promise<SeedAction> {
  const seedBytes = await fs.readFile(from)
  const seed = seedHash(seedBytes)
  let destHash: string | null = null
  try {
    destHash = seedHash(await fs.readFile(to))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const plan = planSeedFile(rel, seed, destHash, state)
  if (plan.action === 'copy' || plan.action === 'update') {
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.writeFile(to, seedBytes)
  }
  if (plan.recorded === undefined) delete state.files[rel]
  else state.files[rel] = plan.recorded
  state.updateAvailable = state.updateAvailable.filter((f) => f !== rel)
  if (plan.pending) state.updateAvailable.push(rel)
  return plan.action
}
