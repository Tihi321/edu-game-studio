import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { SEED_HASHES_FILE, SEED_HISTORY, planSeedFile, readSeedNotes, seedHash } from '../src/engine/store/seedRefresh'

describe('planSeedFile (the decision)', () => {
  const h = (s: string) => seedHash(s)
  const none = { files: {} as Record<string, string> }
  it('copies a missing file and records the seed hash', () => {
    expect(planSeedFile('a.md', h('v1'), null, none, {})).toEqual({ action: 'copy', recorded: h('v1'), pending: false })
  })
  it('leaves a file that equals the seed', () => {
    expect(planSeedFile('a.md', h('v1'), h('v1'), none, {})).toMatchObject({ action: 'same', pending: false })
  })
  it('updates an untouched file (the recorded hash), and keeps an edited one with an update note', () => {
    const state = { files: { 'a.md': h('v1') } }
    expect(planSeedFile('a.md', h('v2'), h('v1'), state, {})).toEqual({ action: 'update', recorded: h('v2'), pending: false })
    expect(planSeedFile('a.md', h('v2'), h('mine'), state, {})).toEqual({ action: 'keep', recorded: h('v1'), pending: true })
    // the seed did not change since: an edited file has nothing to update
    expect(planSeedFile('a.md', h('v1'), h('mine'), state, {})).toMatchObject({ action: 'keep', pending: false })
  })
  it('legacy folders: a known earlier seed version counts as untouched, anything else is yours', () => {
    const history = { 'a.md': [h('v1')] }
    expect(planSeedFile('a.md', h('v2'), h('v1'), none, history).action).toBe('update')
    expect(planSeedFile('a.md', h('v2'), h('mine'), none, history)).toEqual({ action: 'keep', recorded: undefined, pending: true })
    expect(planSeedFile('a.md', h('v1'), h('mine'), none, history)).toEqual({ action: 'keep', recorded: h('v1'), pending: false })
  })
  it('hashes ignore line endings, and the earlier seed versions are the skeleton roles.md, providers.md and studios.md (EGS-06, EGS-07)', () => {
    expect(seedHash('a\r\nb\r\n')).toBe(seedHash('a\nb\n'))
    expect(Object.keys(SEED_HISTORY).sort()).toEqual(['config/formats.md', 'config/providers.md', 'config/roles.md', 'config/studios.md', 'prompts/curriculum-designer/curriculum.md', 'prompts/language-coach/scope.md'])
  })
})

describe('initDataFolder with seed refresh', () => {
  let root: string
  let seed: string
  let data: string
  const write = async (rel: string, text: string, base = seed) => {
    await mkdir(path.dirname(path.join(base, rel)), { recursive: true })
    await writeFile(path.join(base, rel), text)
  }
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'edu-seed-'))
    seed = path.join(root, 'seed')
    data = path.join(root, 'data')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('records hashes, updates untouched files on upgrade, keeps edited ones and says an update is available', async () => {
    await write('prompts/x/a.md', 'a v1')
    await write('prompts/x/b.md', 'b v1')
    await write('config/c.md', 'c v1')
    const first = await initDataFolder(data, seed)
    expect(first.copied).toEqual(expect.arrayContaining(['prompts/x/a.md', 'prompts/x/b.md', 'config/c.md']))
    expect(JSON.parse(await readFile(path.join(data, SEED_HASHES_FILE), 'utf8')).files['prompts/x/a.md']).toBe(seedHash('a v1'))

    await write('prompts/x/b.md', 'b edited by me', data) // the user edits b
    await write('prompts/x/a.md', 'a v2')
    await write('prompts/x/b.md', 'b v2')
    const second = await initDataFolder(data, seed)
    expect(second.updated).toEqual(['prompts/x/a.md'])
    expect(second.updateAvailable).toEqual(['prompts/x/b.md'])
    expect(await readFile(path.join(data, 'prompts/x/a.md'), 'utf8')).toBe('a v2')
    expect(await readFile(path.join(data, 'prompts/x/b.md'), 'utf8')).toBe('b edited by me')
    expect(await readFile(path.join(data, 'config/c.md'), 'utf8')).toBe('c v1')
    expect((await readSeedNotes(data)).updateAvailable).toEqual(['prompts/x/b.md'])

    // run again: nothing changes, the note stays
    const third = await initDataFolder(data, seed)
    expect(third.updated).toEqual([])
    expect(third.updateAvailable).toEqual(['prompts/x/b.md'])

    // deleting the edited file takes the new version, and the note goes
    await rm(path.join(data, 'prompts/x/b.md'))
    const fourth = await initDataFolder(data, seed)
    expect(fourth.copied).toContain('prompts/x/b.md')
    expect(fourth.updateAvailable).toEqual([])
    expect(await readFile(path.join(data, 'prompts/x/b.md'), 'utf8')).toBe('b v2')
  })

  it('never touches the starter agents after the first copy', async () => {
    await write('agents/composer.md', 'staff v1')
    await initDataFolder(data, seed)
    await write('agents/composer.md', 'staff v2')
    await initDataFolder(data, seed)
    expect(await readFile(path.join(data, 'agents/composer.md'), 'utf8')).toBe('staff v1')
  })
})
