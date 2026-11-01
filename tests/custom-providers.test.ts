import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine/engine'
import { keyNameOf, removeCustomProviderEntry, upsertCustomProvider } from '../src/engine/models/customProviders'
import { deleteStoredKey, getStoredKey } from '../src/engine/models/keys'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { parseMd } from '../src/shared/md'
import type { EngineEvent } from '../src/shared/protocol'
import { seedDir } from './helpers'

let dir: string
let keysToClean: string[] = []
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'edu-custom-'))
  await initDataFolder(dir, seedDir)
})
afterEach(async () => {
  for (const k of keysToClean) deleteStoredKey(k)
  keysToClean = []
  await rm(dir, { recursive: true, force: true })
})

const file = (...p: string[]) => path.join(dir, 'config', ...p)
const readConfig = async (name: string) => parseMd(await readFile(file(name), 'utf8'))
/** A name no other test run uses, so the real credential store entry of the test is its own. */
const uniqueName = () => `Edu Test ${Math.random().toString(36).slice(2, 8)}`

function makeEngine(fetchImpl?: typeof fetch) {
  const events: EngineEvent[] = []
  const logs: string[] = []
  const engine = new Engine({ dataDir: dir, emit: (e) => events.push(e), log: (m) => logs.push(m), registry: { fetchImpl }, discover: false })
  const last = <T extends EngineEvent['type']>(type: T) => [...events].reverse().find((e) => e.type === type) as Extract<EngineEvent, { type: T }> | undefined
  return { engine, events, logs, last }
}

async function started(fetchImpl?: typeof fetch) {
  const e = makeEngine(fetchImpl)
  await e.engine.loadSettings()
  await e.engine.registry.load()
  return e
}

describe('custom provider entries in providers.md', () => {

  it('adds, edits and removes only custom entries, keeping comments, the other providers and the text below', async () => {
    const seed = await readFile(file('providers.md'), 'utf8')
    const input = { name: 'ACP proxy (home)', baseUrl: 'http://127.0.0.1:7461/v1', hasKey: false, free: true, jsonSchema: false, concurrency: 2, enabled: true }
    const added = upsertCustomProvider(seed, input)
    expect(added.id).toBe('acp-proxy-home')
    expect(added.text).toContain('# to verify') // comments of the seed stay
    expect(added.text.endsWith(seed.slice(seed.lastIndexOf('---\n') + 4))).toBe(true) // the body stays
    const entry = (parseMd(added.text).data.providers as Record<string, unknown>[]).find((p) => p.id === 'acp-proxy-home')
    expect(entry).toEqual({ id: 'acp-proxy-home', name: 'ACP proxy (home)', custom: true, kind: 'openai-compat', enabled: true, base_url: 'http://127.0.0.1:7461/v1', local: true, json_schema: false, concurrency: 2, discover: true, models: [] })
    // a paid one always names its key variable, a free one with a key too
    const paid = upsertCustomProvider(added.text, { ...input, name: 'Paid One', free: false, concurrency: 'auto' })
    expect((parseMd(paid.text).data.providers as Record<string, unknown>[]).find((p) => p.id === 'paid-one')).toMatchObject({ local: false, api_key_env: 'CUSTOM_PAID_ONE_API_KEY', concurrency: 'auto' })
    expect((parseMd(upsertCustomProvider(seed, { ...input, hasKey: true }).text).data.providers as Record<string, unknown>[]).find((p) => p.id === 'acp-proxy-home')).toMatchObject({ api_key_env: 'CUSTOM_ACP_PROXY_HOME_API_KEY' })

    // edit: fields change in place, the models and a hand-written field stay
    const withModel = added.text.replace('    models: []\n  # The ACP proxy', '    models: []\n  # The ACP proxy') // untouched seed text
    const hand = withModel.replace(/(- id: acp-proxy-home[\s\S]*?models: \[\])/, '$1\n    my_note: keep me')
    const edited = upsertCustomProvider(hand, { ...input, id: 'acp-proxy-home', name: 'Renamed', baseUrl: 'https://example.org/v1/', free: false, jsonSchema: true, concurrency: 5, enabled: false })
    expect(edited.id).toBe('acp-proxy-home')
    expect((parseMd(edited.text).data.providers as Record<string, unknown>[]).find((p) => p.id === 'acp-proxy-home')).toMatchObject({ name: 'Renamed', base_url: 'https://example.org/v1', local: false, json_schema: true, concurrency: 5, enabled: false, my_note: 'keep me', api_key_env: 'CUSTOM_ACP_PROXY_HOME_API_KEY' })

    // remove: back to the seed's providers, with the comments
    const removed = removeCustomProviderEntry(added.text, 'acp-proxy-home')
    expect(removed.keyEnv).toBeUndefined()
    expect(parseMd(removed.text).data).toEqual(parseMd(seed).data)
    expect(removed.text).toContain('# to verify')
    expect(removeCustomProviderEntry(paid.text, 'paid-one').keyEnv).toBe('CUSTOM_PAID_ONE_API_KEY')
  })

  it('refuses a seed id, a taken id, a bad URL, an empty name, and editing or removing a seed provider', async () => {
    const seed = await readFile(file('providers.md'), 'utf8')
    const input = { name: 'x', baseUrl: 'http://localhost:1/v1', hasKey: false, free: true, jsonSchema: false, concurrency: 1, enabled: true }
    for (const name of ['DeepSeek', 'LMStudio', 'strata', 'ACP', 'Paid', 'Client']) expect(() => upsertCustomProvider(seed, { ...input, name }), name).toThrow(/built-in/)
    const once = upsertCustomProvider(seed, { ...input, name: 'My Server' }).text
    expect(() => upsertCustomProvider(once, { ...input, name: 'my server' })).toThrow(/exists already/)
    expect(() => upsertCustomProvider(seed, { ...input, name: '!!!' })).toThrow(/letter or digit/)
    expect(() => upsertCustomProvider(seed, { ...input, name: 'Ok', baseUrl: 'file:///x' })).toThrow(/http/)
    expect(() => upsertCustomProvider(seed, { ...input, id: 'deepseek', name: 'Ok' })).toThrow(/not a custom provider/)
    expect(() => removeCustomProviderEntry(seed, 'lmstudio')).toThrow(/not a custom provider/)
    expect(() => removeCustomProviderEntry(seed, 'nope')).toThrow(/not a custom provider/)
  })
})

describe('custom providers in the engine', () => {
  it('a free provider is its own group, its alias resolves, its model can be the art-critic vision model, and it can be removed again', async () => {
    const { engine, last } = await started()
    const name = uniqueName()
    const id = name.toLowerCase().replace(/ /g, '-')
    await engine.handleCommand({ type: 'saveCustomProvider', name, baseUrl: 'http://127.0.0.1:7461/v1', free: true, jsonSchema: false, concurrency: 2, enabled: true })
    expect(last('provider.saved')).toMatchObject({ ok: true, id })
    const p = engine.registry.providers.get(id)!
    expect(p).toMatchObject({ custom: true, local: true, name, kind: 'openai-compat', available: true, concurrency: 2, jsonSchema: false, enabled: true })
    expect(p.apiKeyEnv).toBeUndefined()
    const summary = (await engine.snapshot()).providers.find((x) => x.id === id)!
    expect(summary).toMatchObject({ name, custom: true, enabled: true, baseUrl: 'http://127.0.0.1:7461/v1', jsonSchema: false, local: true, canList: true })

    // models: a free provider needs no price; a vision model is kept
    await engine.handleCommand({ type: 'addModel', provider: id, id: 'claude-opus-5-5', context: 200000, vision: true })
    await engine.handleCommand({ type: 'addModel', provider: id, id: 'qwen3.8-flash' })
    expect(engine.registry.models.get(`${id}/claude-opus-5-5`)).toMatchObject({ picked: true, vision: true, priceIn: 0, priceOut: 0, context: 200000 })
    expect(engine.registry.models.get(`${id}/qwen3.8-flash`)).toMatchObject({ vision: false })
    const snap = await engine.snapshot()
    expect(snap.models.find((m) => m.ref === `${id}/claude-opus-5-5`)).toMatchObject({ group: id, vision: true, local: true })
    expect(snap.models.find((m) => m.ref === 'deepseek/deepseek-flash')?.group).toBe('paid')
    expect(snap.models.find((m) => m.ref === 'strata/qwen3.8-flash-next')?.group).toBe('strata')
    expect(snap.models.find((m) => m.ref === 'client/claude-code')?.group).toBeUndefined()

    // the alias: without a row it names no model; once added to fallbacks it resolves to that row
    expect(engine.registry.resolve(id)).toBe(id)
    expect(engine.registry.kindOf(id)).toBe(id)
    await engine.handleCommand({ type: 'saveSettings', fallbacks: [`${id}/qwen3.8-flash`, 'deepseek/deepseek-flash'] })
    expect(engine.registry.resolve(id)).toBe(`${id}/qwen3.8-flash`)
    expect((await readConfig('settings.md')).data.fallbacks).toEqual([`${id}/qwen3.8-flash`, 'deepseek/deepseek-flash'])
    await engine.setRoleModel('script-analyst', id) // roles.md names the provider id like an alias
    expect(engine.registry.roleModelRefs('script-analyst')[0]).toBe(`${id}/qwen3.8-flash`)
    await engine.handleCommand({ type: 'saveSettings', fallbacks: ['strata/qwen3.8-flash-next', `${id}/qwen3.8-flash`, 'deepseek/deepseek-flash'], fallbackShared: false })
    expect(engine.registry.roleEntries('director')).toEqual(['paid', 'strata', 'lmstudio']) // roles.md entries kept with shared false
    expect(engine.registry.roleEntries('script-analyst')[0]).toBe(id)
    expect((await engine.snapshot()).settings.fallbacks).toEqual(['strata/qwen3.8-flash-next', `${id}/qwen3.8-flash`, 'deepseek/deepseek-flash'])

    // limits and a hidden model are stored for it too
    await engine.handleCommand({ type: 'setProviderLimits', provider: id, rpm: 10 })
    await engine.handleCommand({ type: 'showModels', refs: [`${id}/qwen3.8-flash`], shown: false })

    // remove: the entry, its models.md refs, its group default and its place in the order go; roles.md is left
    await engine.handleCommand({ type: 'removeCustomProvider', id })
    expect(last('provider.saved')).toMatchObject({ ok: true, id, removed: true })
    expect(engine.registry.providers.has(id)).toBe(false)
    const models = (await readConfig('models.md')).data
    expect(JSON.stringify(models)).not.toContain(id)
    const settings = (await readConfig('settings.md')).data
    expect(settings.fallbacks).toEqual(['strata/qwen3.8-flash-next', 'deepseek/deepseek-flash'])
    expect(settings).not.toHaveProperty('group_defaults')
    expect(JSON.stringify((await readConfig('roles.md')).data)).toContain(id)
    expect(await readFile(file('providers.md'), 'utf8')).not.toContain(id)
    expect((await readFile(file('providers.md'), 'utf8'))).toContain('# to verify') // comments stay
    // an unknown or seed provider is refused
    await engine.handleCommand({ type: 'removeCustomProvider', id: 'deepseek' })
    expect(last('provider.saved')).toMatchObject({ ok: false, id: 'deepseek' })
    expect(engine.registry.providers.has('deepseek')).toBe(true)
  })

  it('a paid provider stores its key, takes the key through setSecret, needs prices, is its own group, and its key is deleted on remove', async () => {
    const { engine, last } = await started()
    const name = uniqueName()
    const id = name.toLowerCase().replace(/ /g, '-')
    const keyName = keyNameOf(id)
    keysToClean.push(keyName)
    await engine.handleCommand({ type: 'saveCustomProvider', name, baseUrl: 'https://api.example.org/v1', apiKey: 'sk-custom-1', free: false, jsonSchema: true, concurrency: 'auto', enabled: true })
    expect(last('provider.saved')).toMatchObject({ ok: true, id })
    expect(getStoredKey(keyName)).toBe('sk-custom-1')
    expect(JSON.stringify((await readConfig('providers.md')).data)).not.toContain('sk-custom-1') // never in a file
    const p = engine.registry.providers.get(id)!
    expect(p).toMatchObject({ custom: true, local: false, apiKeyEnv: keyName, available: true, concurrencyAuto: true, jsonSchema: true })
    expect(engine.allowedSecrets()).toContain(keyName)
    expect((await engine.snapshot()).keyNames).toContain(keyName)
    expect((await engine.snapshot()).secretsSet).toContain(keyName)
    expect((await engine.snapshot()).providers.find((x) => x.id === id)).toMatchObject({ keyName, keySet: true, custom: true })
    // setSecret accepts the name (and still refuses others)
    await engine.handleCommand({ type: 'setSecret', name: keyName, value: 'sk-custom-2' })
    expect(getStoredKey(keyName)).toBe('sk-custom-2')
    await engine.handleCommand({ type: 'setSecret', name: 'CUSTOM_NOT_A_PROVIDER_API_KEY', value: 'x' })
    expect(getStoredKey('CUSTOM_NOT_A_PROVIDER_API_KEY')).toBeUndefined()

    // a paid model needs both prices, and it is the provider's own group, not `paid`
    await engine.handleCommand({ type: 'addModel', provider: id, id: 'big-model' })
    expect(engine.registry.models.has(`${id}/big-model`)).toBe(false)
    await engine.handleCommand({ type: 'addModel', provider: id, id: 'big-model', priceIn: 2, priceOut: 8 })
    expect(engine.registry.models.get(`${id}/big-model`)).toMatchObject({ priceIn: 2, priceOut: 8 })
    expect(engine.registry.groupOf(`${id}/big-model`)).toBe(id)

    // an edit with an empty key keeps the stored one; a new key replaces it
    await engine.handleCommand({ type: 'saveCustomProvider', id, name: `${name} 2`, baseUrl: 'https://api.example.org/v2', free: false, jsonSchema: false, concurrency: 3, enabled: true })
    expect(getStoredKey(keyName)).toBe('sk-custom-2')
    expect(engine.registry.providers.get(id)).toMatchObject({ name: `${name} 2`, baseUrl: 'https://api.example.org/v2', concurrency: 3, jsonSchema: false })
    expect(engine.registry.models.has(`${id}/big-model`)).toBe(true) // the models stay
    await engine.handleCommand({ type: 'saveCustomProvider', id, name, baseUrl: 'https://api.example.org/v2', apiKey: 'sk-custom-3', free: false, jsonSchema: false, concurrency: 3, enabled: false })
    expect(getStoredKey(keyName)).toBe('sk-custom-3')
    expect(engine.registry.providers.get(id)).toMatchObject({ enabled: false, available: false })

    await engine.handleCommand({ type: 'removeCustomProvider', id })
    expect(getStoredKey(keyName)).toBeUndefined() // the key goes with the provider
    expect(engine.allowedSecrets()).not.toContain(keyName)
    expect(JSON.stringify((await readConfig('models.md')).data)).not.toContain(id)
  })
})
