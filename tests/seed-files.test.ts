import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { SEED_HASHES_FILE, seedHash } from '../src/engine/store/seedRefresh'

const SEED = path.resolve(__dirname, '../seed')
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

describe('seed files', () => {
  it('contain no control characters except newline, carriage return and tab (a `\f` in a Windows path is a form feed)', () => {
    const bad: string[] = []
    for (const file of walk(SEED)) {
      const text = fs.readFileSync(file, 'utf8')
      const at = [...text].findIndex((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127 })
      if (at >= 0) bad.push(`${path.relative(SEED, file)}: U+${[...text][at]!.charCodeAt(0).toString(16).padStart(4, '0')} at ${at}`)
    }
    expect(bad).toEqual([])
  })

  it('name no absolute Windows path (sibling tools are found by relative paths such as ../creative-hub)', () => {
    const bad: string[] = []
    for (const file of walk(SEED)) {
      const text = fs.readFileSync(file, 'utf8')
      if (/[A-Za-z]:\\/.test(text)) bad.push(path.relative(SEED, file))
    }
    expect(bad).toEqual([])
  })

  it('a data folder made from the seed records the hash of every seed file', async () => {
    const data = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '.'), 'edu-seed-'))
    try {
      await initDataFolder(data, SEED)
      const hashes = JSON.parse(fs.readFileSync(path.join(data, SEED_HASHES_FILE), 'utf8')) as { files: Record<string, string> }
      const studios = fs.readFileSync(path.join(data, 'config', 'studios.md'), 'utf8')
      expect(hashes.files['config/studios.md']).toBe(seedHash(studios))
      expect(studios).toContain('flowRepo: ../flow-music-mcp')
      expect(fs.existsSync(path.join(data, 'courses'))).toBe(true)
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
    }
  })
})
