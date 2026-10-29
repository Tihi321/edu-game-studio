import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import type { Document, YAMLMap } from 'yaml'
import { splitFrontmatter } from '../../shared/md'
import { atomicWrite } from './atomic'
import type { SeedState } from './seedRefresh'

/**
 * One-time, additive migrations of config files you edited. The seed refresh (`seedRefresh.ts`) never touches an edited file, so an entry
 * added to a seed file in a later release would never reach it. A migration adds a missing entry or field and never overwrites a value.
 * Its id is recorded in `.seed-hashes.json` once it ran (even when it changed nothing), so an entry you delete later does not come back.
 * A file that is missing or does not parse is skipped and not recorded: the migration runs again at the next start.
 */
export interface SeedMigration {
  id: string
  /** The seed file, relative to the data folder (`/`). */
  file: string
  /** Edits the frontmatter in place and says whether it changed anything. `seed` is the same file in the seed folder, or null when it does not parse. */
  apply(doc: Document, seed: Document | null): boolean
}

/** The context window recorded for the client's models: Claude Code's. Nothing in Edu Studio sizes a prompt by it. */
export const CLIENT_CONTEXT = 200000

/** The context window recorded for the `antigravity` client model. */
export const ANTIGRAVITY_CONTEXT = 1000000

function providersOf(doc: Document): YAMLMap[] {
  const seq = doc.get('providers', true)
  return isSeq(seq) ? seq.items.filter(isMap) : []
}

const isClient = (p: YAMLMap): boolean => p.get('kind') === 'client' || p.get('id') === 'client'

export const SEED_MIGRATIONS: SeedMigration[] = [
  {
    id: 'providers-client-v1',
    file: 'config/providers.md',
    apply(doc, seed) {
      if (providersOf(doc).some(isClient)) return false
      const entry = seed ? providersOf(seed).find(isClient) : undefined
      const seq = doc.get('providers', true)
      if (!entry || !isSeq(seq)) return false
      seq.add(entry.clone())
      return true
    }
  },
  {
    id: 'providers-client-context-v1',
    file: 'config/providers.md',
    apply(doc) {
      let changed = false
      for (const p of providersOf(doc)) {
        if (p.get('kind') !== 'client') continue
        const models = p.get('models', true)
        if (!isSeq(models)) continue
        for (const m of models.items) {
          if (isMap(m) && !m.has('context')) {
            m.set('context', CLIENT_CONTEXT)
            changed = true
          }
        }
      }
      return changed
    }
  },
  {
    id: 'providers-acp-v1',
    file: 'config/providers.md',
    apply(doc, seed) {
      if (providersOf(doc).some((p) => p.get('id') === 'acp')) return false
      const entry = seed ? providersOf(seed).find((p) => p.get('id') === 'acp') : undefined
      const seq = doc.get('providers', true)
      if (!entry || !isSeq(seq)) return false
      seq.add(entry.clone())
      return true
    }
  },
  {
    id: 'providers-client-antigravity-v1',
    file: 'config/providers.md',
    apply(doc) {
      const client = providersOf(doc).find(isClient)
      const models = client?.get('models', true)
      if (!client || !isSeq(models)) return false
      if (models.items.some((m) => isMap(m) && m.get('id') === 'antigravity')) return false
      models.add(doc.createNode({ id: 'antigravity', vision: true, context: ANTIGRAVITY_CONTEXT }))
      return true
    }
  },
  {
    id: 'settings-fallbacks-v1',
    file: 'config/settings.md',
    apply(doc) {
      if (doc.has('fallbacks')) return false
      const gd = doc.get('group_defaults', true)
      const gdMap = isMap(gd) ? gd : null
      const paid = (doc.get('default_paid_model') as string) || (gdMap?.get('paid') as string) || 'deepseek/deepseek-flash'
      const strata = (doc.get('default_strata_model') as string) || (gdMap?.get('strata') as string) || 'strata/qwen3.8-flash-next'
      const lm = (doc.get('default_lmstudio_model') as string) || (gdMap?.get('lmstudio') as string) || 'lmstudio/gemma-4-e4b-it'
      const defs: Record<string, string> = { paid, strata, lmstudio: lm }
      if (gdMap) {
        for (const item of gdMap.items) {
          const k = String(item.key)
          const v = String(item.value)
          if (v) defs[k] = v
        }
      }
      const mo = doc.get('model_order', true)
      const order = isSeq(mo) ? mo.items.map((x) => String(x)) : []
      const groups = [...new Set([...order, 'paid', 'strata', 'lmstudio'])]
      const derived: string[] = []
      for (const g of groups) {
        const m = defs[g]
        if (m && !derived.includes(m)) derived.push(m)
      }
      doc.set('fallbacks', doc.createNode(derived.length > 0 ? derived : ['deepseek/deepseek-flash', 'strata/qwen3.8-flash-next', 'lmstudio/gemma-4-e4b-it']))
      doc.set('fallback_shared', order.length > 0)
      doc.delete('group_defaults')
      doc.delete('model_order')
      doc.delete('default_paid_model')
      doc.delete('default_strata_model')
      doc.delete('default_lmstudio_model')
      return true
    }
  },
  {
    id: 'voice-local-v1',
    file: 'config/voice.md',
    // The local ComfyUI TTS engines replaced VibeTTS: the endpoint, token, timeout and batch keys mean nothing now, and
    // the old file had no `chunkChars`. Values that still mean something (`format`, `speed`) are never overwritten.
    apply(doc) {
      let changed = false
      for (const key of ['vibettsUrl', 'vibettsToken', 'timeoutS', 'voiceTimeoutS', 'batchTimeoutS', 'chunkSize']) {
        if (doc.has(key)) {
          doc.delete(key)
          changed = true
        }
      }
      if (!doc.has('format')) {
        doc.set('format', 'mp3')
        changed = true
      }
      if (!doc.has('speed')) {
        doc.set('speed', 1)
        changed = true
      }
      if (!doc.has('chunkChars')) {
        doc.set('chunkChars', 400)
        changed = true
      }
      return changed
    }
  }
]

async function readFrontmatterDoc(file: string): Promise<{ doc: Document; text: string; frontmatter: string; body: string } | null> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
  const { frontmatter, body } = splitFrontmatter(text)
  if (frontmatter === null) return null
  const doc = parseDocument(frontmatter)
  if (doc.errors.length > 0) return null
  return { doc, text, frontmatter, body }
}

/** Runs the migrations that did not run yet. Returns the ids that changed a file. */
export async function applySeedMigrations(dataDir: string, seedDir: string, state: SeedState, migrations: SeedMigration[] = SEED_MIGRATIONS): Promise<string[]> {
  const changed: string[] = []
  for (const mig of migrations) {
    if (state.migrations.includes(mig.id)) continue
    const rel = mig.file.split('/')
    const mine = await readFrontmatterDoc(path.join(dataDir, ...rel))
    if (!mine) continue
    const seed = await readFrontmatterDoc(path.join(seedDir, ...rel))
    if (mig.apply(mine.doc, seed?.doc ?? null)) {
      const eol = mine.text.includes('\r\n') ? '\r\n' : '\n'
      const fm = mine.doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol)
      await atomicWrite(path.join(dataDir, ...rel), `---${eol}${fm}---${eol}${mine.body}`)
      changed.push(mig.id)
    }
    state.migrations.push(mig.id)
  }
  return changed
}
