import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/** The split contract (EGS-40): `yarn test` never starts Chromium. Only tests/*.e2e.test.ts (run by `yarn test:e2e`) may import playwright or bot-helpers. */
it('no fast test file imports playwright or bot-helpers', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const importsBrowser = /(?:from|import\()\s*['"](?:playwright|\.\/bot-helpers)['"]/
  const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => f.endsWith('.test.ts') && !f.endsWith('.e2e.test.ts'))
    .filter((f) => importsBrowser.test(readFileSync(path.join(dir, f), 'utf8')))
  expect(offenders, 'move the Chromium part into tests/<name>.e2e.test.ts').toEqual([])
})
