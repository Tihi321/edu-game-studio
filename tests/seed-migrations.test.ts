import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { applySeedMigrations, SEED_MIGRATIONS } from '../src/engine/store/seedMigrations'
import { SEED_HASHES_FILE, loadSeedState } from '../src/engine/store/seedRefresh'
import { splitFrontmatter } from '../src/shared/md'
import { parse as parseYaml } from 'yaml'
import { seedDir } from './helpers'

type Provider = { id: string; kind: string; models?: { id: string; context?: number }[] }

let data: string
const file = () => path.join(data, 'config', 'providers.md')
const providersOf = async (): Promise<Provider[]> => (parseYaml(splitFrontmatter(await readFile(file(), 'utf8')).frontmatter!) as { providers: Provider[] }).providers

/** A providers.md as an older release left it, edited by the user: a comment, one provider, a body, no client. */
const OLD = `---
kind: providers
providers:
  # my own note about the server
  - id: lmstudio
    kind: openai-compat
    local: true
    base_url: http://localhost:1234/v1
    concurrency: 2
    models: []
---
# My providers

Body text stays as it is.
`

beforeEach(async () => {
  data = await mkdtemp(path.join(os.tmpdir(), 'edu-mig-'))
})
afterEach(async () => {
  await rm(data, { recursive: true, force: true })
})

/** Makes a data folder, then replaces providers.md with `text` and forgets the migrations, as an older data folder would be. */
async function oldFolder(text: string): Promise<void> {
  await initDataFolder(data, seedDir)
  await writeFile(file(), text)
  const state = JSON.parse(await readFile(path.join(data, SEED_HASHES_FILE), 'utf8')) as Record<string, unknown>
  state.migrations = []
  await writeFile(path.join(data, SEED_HASHES_FILE), JSON.stringify(state))
}

describe('seed migrations', () => {
  it('adds the client provider to an edited providers.md and keeps its comments, providers and body', async () => {
    await oldFolder(OLD)
    const res = await initDataFolder(data, seedDir)
    expect(res.migrated).toEqual(['providers-client-v1', 'providers-acp-v1'])
    const text = await readFile(file(), 'utf8')
    expect(text).toContain('# my own note about the server')
    expect(text.endsWith('# My providers\n\nBody text stays as it is.\n')).toBe(true)
    const providers = await providersOf()
    expect(providers.map((p) => p.id)).toEqual(['lmstudio', 'client', 'acp'])
    expect(providers[0]).toMatchObject({ concurrency: 2, base_url: 'http://localhost:1234/v1' })
    // the client entry comes from the seed, so it already has antigravity
    expect(providers[1]).toMatchObject({ kind: 'client', models: [{ id: 'claude-code', context: 200000 }, { id: 'antigravity', vision: true, context: 1000000 }] })
    expect(providers[2]).toMatchObject({ id: 'acp', kind: 'openai-compat', enabled: false, local: true, base_url: 'http://127.0.0.1:7461/v1', concurrency: 2, json_schema: false, discover: true, models: [] })
    expect((await loadSeedState(data)).migrations).toEqual(['providers-client-v1', 'providers-client-context-v1', 'providers-acp-v1', 'providers-client-antigravity-v1', 'settings-fallbacks-v1', 'voice-local-v1'])
  })

  it('gives a client model without context 200000 and never changes one that has a value', async () => {
    await oldFolder(OLD.replace('    models: []\n', '    models: []\n  - id: client\n    kind: client\n    models:\n      - id: claude-code\n      - id: other\n        context: 50000\n'))
    const res = await initDataFolder(data, seedDir)
    expect(res.migrated).toEqual(['providers-client-context-v1', 'providers-acp-v1', 'providers-client-antigravity-v1'])
    const client = (await providersOf()).find((p) => p.id === 'client')!
    expect(client.models).toEqual([{ id: 'claude-code', context: 200000 }, { id: 'other', context: 50000 }, { id: 'antigravity', vision: true, context: 1000000 }])
  })

  it('does not bring back a client entry you deleted after the migration ran', async () => {
    await oldFolder(OLD)
    await initDataFolder(data, seedDir)
    await writeFile(file(), OLD)
    const again = await initDataFolder(data, seedDir)
    expect(again.migrated).toEqual([])
    expect((await providersOf()).map((p) => p.id)).toEqual(['lmstudio'])
  })

  it('leaves a file with bad YAML alone and does not record the migration', async () => {
    const bad = '---\nproviders: [oops\n  - nope: : :\n---\nbody\n'
    await oldFolder(bad)
    const res = await initDataFolder(data, seedDir)
    expect(res.migrated).toEqual([])
    expect(await readFile(file(), 'utf8')).toBe(bad)
    expect((await loadSeedState(data)).migrations).toEqual(['settings-fallbacks-v1', 'voice-local-v1'])
  })

  it('an untouched file is updated by the seed refresh, and the migrations change nothing', async () => {
    // a data folder made from the old seed: providers.md is the recorded seed version, so the refresh replaces it
    await initDataFolder(data, seedDir)
    const seedText = await readFile(path.join(seedDir, 'config', 'providers.md'), 'utf8')
    const state = JSON.parse(await readFile(path.join(data, SEED_HASHES_FILE), 'utf8')) as { files: Record<string, string>; migrations: string[] }
    const { seedHash } = await import('../src/engine/store/seedRefresh')
    const old = seedText.replace(/\n {2}- id: client[\s\S]*?context: 200000\n/, '\n')
    expect(old).not.toBe(seedText)
    await writeFile(file(), old)
    state.files['config/providers.md'] = seedHash(old)
    state.migrations = []
    await writeFile(path.join(data, SEED_HASHES_FILE), JSON.stringify(state))
    const res = await initDataFolder(data, seedDir)
    expect(res.updated).toContain('config/providers.md')
    expect(res.migrated).toEqual([])
    expect(await readFile(file(), 'utf8')).toBe(seedText)
    expect((await loadSeedState(data)).migrations).toEqual(['providers-client-v1', 'providers-client-context-v1', 'providers-acp-v1', 'providers-client-antigravity-v1', 'settings-fallbacks-v1', 'voice-local-v1'])
  })

  it('adds acp and the antigravity client model once, and does not bring them back when you delete them', async () => {
    await oldFolder(OLD.replace('    models: []\n', '    models: []\n  - id: client\n    kind: client\n    models:\n      - id: claude-code\n        context: 200000\n'))
    const first = await initDataFolder(data, seedDir)
    expect(first.migrated).toEqual(['providers-acp-v1', 'providers-client-antigravity-v1'])
    const providers = await providersOf()
    expect(providers.map((p) => p.id)).toEqual(['lmstudio', 'client', 'acp'])
    expect(providers[1]!.models!.map((m) => m.id)).toEqual(['claude-code', 'antigravity'])
    expect((await readFile(file(), 'utf8'))).toContain('# my own note about the server')
    // delete both: they stay deleted
    await writeFile(file(), OLD.replace('    models: []\n', '    models: []\n  - id: client\n    kind: client\n    models:\n      - id: claude-code\n        context: 200000\n'))
    expect((await initDataFolder(data, seedDir)).migrated).toEqual([])
    expect((await providersOf()).map((p) => p.id)).toEqual(['lmstudio', 'client'])
  })
  it('migrates legacy group_defaults and model_order in settings.md to fallbacks and fallback_shared', async () => {
    await initDataFolder(data, seedDir)
    const oldSettings = `---
kind: settings
default_paid_model: deepseek/deepseek-flash
group_defaults:
  strata: strata/qwen3.8-flash-next
  lmstudio: lmstudio/my-local-model
model_order:
  - lmstudio
  - strata
---
`
    const settingsPath = path.join(data, 'config', 'settings.md')
    await writeFile(settingsPath, oldSettings)
    const state = JSON.parse(await readFile(path.join(data, SEED_HASHES_FILE), 'utf8')) as { migrations: string[] }
    state.migrations = state.migrations.filter((m) => m !== 'settings-fallbacks-v1')
    await writeFile(path.join(data, SEED_HASHES_FILE), JSON.stringify(state))

    const res = await initDataFolder(data, seedDir)
    expect(res.migrated).toContain('settings-fallbacks-v1')
    const updated = await readFile(settingsPath, 'utf8')
    expect(updated).toContain('fallbacks:')
    expect(updated).toContain('fallback_shared: true')
    expect(updated).not.toContain('group_defaults:')
    expect(updated).not.toContain('model_order:')
  })

  it('voice-local-v1 strips the VibeTTS keys from an edited voice.md and adds chunkChars, never touching format or speed', async () => {
    await initDataFolder(data, seedDir)
    const voicePath = path.join(data, 'config', 'voice.md')
    const oldVoice = `---
kind: voice
vibettsUrl: http://127.0.0.1:7723/mcp
vibettsToken: ''
timeoutS: 15
voiceTimeoutS: 180
batchTimeoutS: 900
chunkSize: 20
format: wav
speed: 1.2
---
# My voice

Edited body stays.
`
    await writeFile(voicePath, oldVoice)
    const state = JSON.parse(await readFile(path.join(data, SEED_HASHES_FILE), 'utf8')) as { migrations: string[] }
    state.migrations = state.migrations.filter((m) => m !== 'voice-local-v1')
    await writeFile(path.join(data, SEED_HASHES_FILE), JSON.stringify(state))

    const res = await initDataFolder(data, seedDir)
    expect(res.migrated).toContain('voice-local-v1')
    const text = await readFile(voicePath, 'utf8')
    expect(text).not.toMatch(/vibetts|timeoutS|chunkSize/)
    expect(text).toContain('chunkChars: 400')
    expect(text).toContain('format: wav')
    expect(text).toContain('speed: 1.2')
    expect(text).toContain('# My voice')
    expect(text).toContain('Edited body stays.')
  })

  it('voice-local-v1 is skipped when voice.md is missing, and not recorded', async () => {
    await initDataFolder(data, seedDir)
    await rm(path.join(data, 'config', 'voice.md'))
    const state = await loadSeedState(data)
    state.migrations = state.migrations.filter((m) => m !== 'voice-local-v1')
    const changed = await applySeedMigrations(data, seedDir, state, SEED_MIGRATIONS)
    expect(changed).not.toContain('voice-local-v1')
    expect(state.migrations).not.toContain('voice-local-v1')
  })
});
