import { describe, expect, it } from 'vitest'
import { loadCourseFolder } from '../src/engine/edu/course-io'
import { checkArticles, checkItems, type AuthoredItem } from '../src/engine/edu/authoring'
import { harvestGlossary } from '../src/engine/edu/harvest'
import { lintGameData, type LintProblem } from '../src/engine/edu/lint'
import { checkFlashcard, validateCourse } from '../src/shared/edu'
import { GAME_DATA_FORMAT, GAME_DATA_VERSION, type GameData } from '../src/shared/game-data'
import { hiddenGlossItems } from '../src/shared/gloss-deck'
import { languageRulesText } from '../src/shared/lang'
import { readingStats } from '../src/shared/reading'
import { startRound } from '../src/player/round'
import { FIXTURES } from './edu-fixtures'
import path from 'node:path'

type Raw = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function game(): Promise<GameData> {
  const loaded = await loadCourseFolder(path.join(FIXTURES, 'de-b2-reading'))
  const res = validateCourse(loaded.pack, loaded.catalogs)
  if (!res.ok || !res.pack || !res.catalogs) throw new Error('fixture invalid')
  return structuredClone({ format: GAME_DATA_FORMAT, version: GAME_DATA_VERSION, slug: 'x', builtAt: '2026-10-29T00:00:00.000Z', engine: 'test', pack: res.pack, catalogs: res.catalogs, defaultLang: res.pack.sourceLang, assets: {}, shell: 'quiz-arena' } as GameData)
}
const only = (ps: LintProblem[], code: string): LintProblem[] => ps.filter((p) => p.code === code)
const item = (d: GameData, id: string): Raw => d.pack.items.find((i) => i.id === id) as unknown as Raw

describe('reading lint codes', () => {
  it('the fixture has none of them', async () => {
    const ps = lintGameData(await game(), () => true)
    expect(ps.filter((p) => p.code.startsWith('READING_') || p.code === 'TFNG_OPTIONS' || p.code === 'SELFCHECK_NO_MODEL')).toEqual([])
  })
  it('an A1 course with glossed article notes and no recorded reading band gets no reading warnings', async () => {
    const d = await game()
    d.pack.cefr = 'A1'
    delete (d.pack.extensions as Raw).language
    d.catalogs.de!.strings['art.art-homeoffice.body'] = 'Ein kurzer Satz.'
    expect(only(lintGameData(d, () => true), 'READING_LENGTH')).toEqual([])
  })
  it('READING_LENGTH: too short and too long (warnings)', async () => {
    const d = await game()
    d.catalogs.de!.strings['art.art-homeoffice.body'] = 'Ein kurzer Satz.'
    d.catalogs.de!.strings['art.art-radverkehr.body'] = Array(30).fill(d.catalogs.de!.strings['art.art-radverkehr.body']).join('\n')
    const ps = only(lintGameData(d, () => true), 'READING_LENGTH')
    expect(ps.map((p) => p.severity)).toEqual(['warning', 'warning'])
  })
  it('READING_SENTENCE_LENGTH: a 60-word sentence (warning)', async () => {
    const d = await game()
    const long = Array(60).fill('Wort').join(' ') + '.'
    d.catalogs.de!.strings['art.art-homeoffice.body'] += '\n' + long
    const ps = only(lintGameData(d, () => true), 'READING_SENTENCE_LENGTH')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.severity).toBe('warning')
  })
  it('READING_ITEM_NO_PASSAGE: tagged reading without passage, unknown article, paragraph out of range (errors)', async () => {
    const d = await game()
    delete item(d, 'ho-mcq').extensions.passage
    item(d, 'rv-mcq').extensions.passage = { article: 'nope' }
    item(d, 'ho-cloze').extensions.passage = { article: 'art-homeoffice', paragraphs: [1, 99] }
    const ps = only(lintGameData(d, () => true), 'READING_ITEM_NO_PASSAGE')
    expect(ps).toHaveLength(3)
    expect(ps.every((p) => p.severity === 'error')).toBe(true)
  })
  it('READING_ITEM_COUNT: a reading with fewer than 4 items (warning)', async () => {
    const d = await game()
    d.pack.items = d.pack.items.filter((i) => !(i.id.startsWith('rv-') && i.id !== 'rv-mcq'))
    const ps = only(lintGameData(d, () => true), 'READING_ITEM_COUNT')
    expect(ps.map((p) => p.severity)).toEqual(['warning'])
  })
  it('TFNG_OPTIONS: shuffled, or options out of order (errors)', async () => {
    const d = await game()
    item(d, 'ho-tfng').shuffle = true
    item(d, 'rv-tfng').options.reverse()
    const ps = only(lintGameData(d, () => true), 'TFNG_OPTIONS')
    expect(ps).toHaveLength(2)
    expect(ps.every((p) => p.severity === 'error')).toBe(true)
  })
  it('SELFCHECK_NO_MODEL: a self-check card with a short back is an error, a long one is fine', async () => {
    const d = await game()
    const mk = (id: string, words: number): void => {
      d.catalogs.de!.strings[`${id}.p`] = 'Schreibe einen Text.'
      d.catalogs.de!.strings[`${id}.b`] = Array(words).fill('Wort').join(' ')
      d.catalogs.hr!.strings[`${id}.e`] = 'x'
      d.pack.items.push({ id, objective: 'obj-arbeit', kind: 'flashcard', prompt: `${id}.p`, back: `${id}.b`, explanation: `${id}.e`, difficulty: 3, tags: ['self-check'], extensions: {} } as never)
    }
    mk('sc-short', 5)
    mk('sc-long', 40)
    const ps = only(lintGameData(d, () => true), 'SELFCHECK_NO_MODEL')
    expect(ps).toHaveLength(1)
    expect(ps[0]!.message).toContain('sc-short')
  })
})

describe('harvest (R4) and self-check (R5)', () => {
  async function raw() {
    const loaded = await loadCourseFolder(path.join(FIXTURES, 'de-b2-reading'))
    return { pack: structuredClone(loaded.pack) as Raw, cats: structuredClone(loaded.catalogs) as Record<string, Raw> }
  }
  it('is idempotent: stable ids, a second run adds nothing', async () => {
    const { pack, cats } = await raw()
    const a = harvestGlossary(pack, cats)
    expect(a.added).toHaveLength(24)
    expect(a.added[0]).toBe('art-homeoffice-gl-1')
    const snap = JSON.stringify([pack, cats])
    const b = harvestGlossary(pack, cats)
    expect(b.added).toEqual([])
    expect(b.kept).toEqual(a.added)
    expect(JSON.stringify([pack, cats])).toBe(snap)
    expect(validateCourse(pack, cats).problems.filter((p) => p.code !== 'MISSING_TEXT')).toEqual([])
  })
  it('a hidden entry is not harvested, and a hidden card is not queued in a round', async () => {
    const { pack, cats } = await raw()
    const first = pack.shells.config.encyclopedia.glossary['art-homeoffice'][0].id
    const r = harvestGlossary(pack, cats, { glossOff: [`art-homeoffice/${first}`] })
    expect(r.hidden).toEqual(['art-homeoffice-gl-1'])
    expect(r.added).toHaveLength(23)
    const full = await raw()
    harvestGlossary(full.pack, full.cats)
    const hidden = hiddenGlossItems(full.pack.items, [`art-homeoffice/${first}`])
    expect([...hidden]).toEqual(['art-homeoffice-gl-1'])
    const rs = startRound(full.pack as never, 'boss', { exclude: hidden })
    expect(rs.pool).not.toContain('art-homeoffice-gl-1')
    expect(rs.pool).toContain('art-homeoffice-gl-2')
  })
  it('a self-check flashcard is only ever graded by the learner', () => {
    const card = { kind: 'flashcard', tags: ['self-check'] } as never
    expect(checkFlashcard(card, 'the model answer itself').correct).toBe(false)
    expect(checkFlashcard(card, { text: 'x' }).correct).toBe(false)
    expect(checkFlashcard(card, 'again').correct).toBe(false)
    expect(checkFlashcard(card, 'good').correct).toBe(true)
  })
})

describe('writer checks and rules', () => {
  const art = (body: string, glossary: { term: string; gloss: string }[]) => ({ id: 'a1', unit: 'u1', title: 't', body, related: [], glossary }) as never
  it('checkArticles flags length, glossary size, a term not in the text and a duplicate', () => {
    const body = 'Kurz [f1].'.padEnd(100, ' x') + ' [f1]'
    const p = checkArticles({ articles: [art(body, [{ term: 'Nope', gloss: 'g' }, { term: 'nope', gloss: 'g' }])] }, { factIds: ['f1'], unitIds: ['u1'], unit: 'u1', reading: { words: [350, 700], glossary: [1, 5], cefr: 'B2' } })
    const t = p.map((x) => x.issue).join('\n')
    expect(t).toMatch(/words, at least 300/)
    expect(t).toMatch(/not in the text/)
    expect(t).toMatch(/glossed twice/)
  })
  it('checkItems flags tfng options, missing passage, bad paragraphs, short self-check', () => {
    const base = { objective: 'o1', prompt: 'p', explanation: 'e', facts: ['f1'] }
    const items = [
      { ...base, id: 'a', kind: 'mcq', tags: ['reading', 'tfng'], options: [{ id: 'x', text: 'a' }, { id: 'y', text: 'b' }, { id: 'z', text: 'c' }], answer: 'x' },
      { ...base, id: 'b', kind: 'true-false', answer: true, tags: ['reading'] },
      { ...base, id: 'c', kind: 'true-false', answer: true, passage: { article: 'a1', paragraphs: [1, 9] } },
      { ...base, id: 'd', kind: 'flashcard', back: 'short', tags: ['self-check'] }
    ] as AuthoredItem[]
    const p = checkItems(items, { objectives: [{ id: 'o1', unit: 'u1' }], factIds: ['f1'], allowedKinds: ['mcq', 'true-false', 'flashcard'], readings: { a1: 5 }, unitReadings: ['a1'] })
    const t = p.map((x) => `${x.ref}: ${x.issue}`).join('\n')
    expect(t).toMatch(/a: .*ids t, f, ng/)
    expect(t).toMatch(/b: .*names no passage/)
    expect(t).toMatch(/c: .*outside the text/)
    expect(t).toMatch(/d: .*model answer/)
    expect(t).toMatch(/a1: only 1 item/)
  })
  it('the B2 rules are added for German B2 only', () => {
    expect(languageRulesText('de', true, 'B2')).toContain('tfng')
    expect(languageRulesText('de', false, 'B2')).toContain('German rules for B2')
    expect(languageRulesText('de', true, 'A2')).not.toContain('tfng')
    expect(languageRulesText('hr', true, 'B2')).toBe('')
  })
  it('readingStats counts words and sentences, headings and citations excluded', () => {
    const s = readingStats('## Titel\n\nEins zwei drei [1]. Vier fünf, z. B. sechs!')
    expect(s).toMatchObject({ words: 8, sentences: 2 })
  })
})
