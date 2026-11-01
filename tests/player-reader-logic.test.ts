import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCourseFolder } from '../src/engine/edu/course-io'
import { makeTextResolver, validateCourse } from '../src/shared/edu'
import { encArticles, encyclopediaSectionSchema, glossaryOf, passageOf, readerChapters, type EncyclopediaSection } from '../src/shared/shells/encyclopedia'
import { emptyData, glossKey, readData, withChapterDone, withGlossDeck, withRead, withReaderAt } from '../src/player/shells/encyclopedia/data'
import { glossify, readMarkup, type GlossWord } from '../src/player/gloss'
import { FIXTURES } from './edu-fixtures'

/**
 * The pure parts of the reader (EGS-35), no DOM: the passage link, the chapters, the glossary, the segmentation of a text at the glossed
 * words, the saved reader data (position, chapters read, words out of the deck). The DOM is proved by the bot (tests/bot-encyclopedia.e2e.test.ts).
 */

const word = (id: string, term: string): GlossWord => ({ id, term, gloss: id })

describe('passageOf: extensions.passage', () => {
  it('reads an article, with or without a paragraph range (1-based, inclusive, ordered)', () => {
    expect(passageOf({ extensions: { passage: { article: 'a' } } })).toEqual({ article: 'a' })
    expect(passageOf({ extensions: { passage: { article: 'a', paragraphs: [2, 3] } } })).toEqual({ article: 'a', paragraphs: [2, 3] })
    expect(passageOf({ extensions: { passage: { article: 'a', paragraphs: [4, 2] } } })).toEqual({ article: 'a', paragraphs: [2, 4] })
  })
})

describe('glossify: the glossed words of a text', () => {
  const par = (s: string) => [{ text: s }]
  it('cuts a paragraph at the first mention of each term', () => {
    const out = glossify([par('Wer pendeln muss, spart Zeit. Wer nicht pendeln muss, auch.')], [word('p', 'pendeln')])
    expect(out[0]?.map((s) => [s.text, s.gloss?.id ?? null])).toEqual([
      ['Wer ', null],
      ['pendeln', 'p'],
      [' muss, spart Zeit. Wer nicht pendeln muss, auch.', null]
    ])
  })
  it('the longest term wins where two overlap, and a term is marked once in the whole text', () => {
    const out = glossify([par('Die Führungskräfte lernen.'), par('Eine Kraft und die Führungskräfte.')], [word('k', 'Kraft'), word('f', 'Führungskräfte')])
    expect(out.flat().filter((s) => s.gloss).map((s) => [s.text, s.gloss?.id])).toEqual([['Führungskräfte', 'f'], ['Kraft', 'k']])
  })
  it('prefers a whole word, falls back to a stem inside a longer word, and ignores a term that is not there', () => {
    const whole = glossify([par('Das Gerichtsurteil. Ein Gericht kocht.')], [word('g', 'Gericht')])
    expect(whole[0]?.filter((s) => s.gloss).map((s) => s.text)).toEqual(['Gericht'])
    expect(whole[0]?.[0]?.text).toBe('Das Gerichtsurteil. Ein ')
    const stem = glossify([par('Die Erschöpfungen nehmen zu.')], [word('e', 'Erschöpfung')])
    expect(stem[0]?.filter((s) => s.gloss).map((s) => s.text)).toEqual(['Erschöpfung'])
    const none = glossify([par('Nichts davon.')], [word('x', 'Mittelweg'), word('y', '  ')])
    expect(none[0]).toEqual([{ text: 'Nichts davon.' }])
  })
})

describe('the reader data', () => {
  const arts = new Set(['a1', 'a2'])
  const keys = new Set([glossKey('a1', 'g1'), glossKey('a2', 'g2')])
  it('keeps the position (clamped), the chapters read and the words out of the deck; drops ids the course no longer has', () => {
    const d = readData({ found: [], read: [], reader: { chapter: 'a2', scroll: 7, done: ['a1', 'gone'] }, glossOff: [glossKey('a1', 'g1'), 'a9/zz', 4] }, new Set(), arts, keys)
    expect(d.reader).toEqual({ chapter: 'a2', scroll: 1, done: ['a1'] })
    expect(d.glossOff).toEqual(['a1/g1'])
    expect(readData({ reader: { chapter: 'gone', scroll: 'x' } }, new Set(), arts, keys).reader).toEqual({ scroll: 0, done: [] })
    expect(readData({ glossOff: ['a9/zz'] }, new Set(), arts, keys).glossOff).toBeUndefined()
  })
  it('moves, marks a chapter read once, and switches a word out of the deck and back', () => {
    let d = emptyData()
    d = withReaderAt(d, 'a1', 0.5)
    expect(d.reader).toEqual({ chapter: 'a1', scroll: 0.5, done: [] })
    expect(withReaderAt(d, 'a1', 0.501)).toBe(d) // too small a step to save
    d = withChapterDone(withRead(d, 'a1'), 'a1')
    expect(withChapterDone(d, 'a1')).toBe(d)
    expect(d.reader?.done).toEqual(['a1'])
    d = withReaderAt(d, 'a2', 0)
    expect(d.reader).toEqual({ chapter: 'a2', scroll: 0, done: ['a1'] })
    d = withGlossDeck(d, 'a1/g1', false)
    expect(d.glossOff).toEqual(['a1/g1'])
    expect(withGlossDeck(d, 'a1/g1', false)).toBe(d)
    d = withGlossDeck(d, 'a1/g1', true)
    expect('glossOff' in d).toBe(false)
  })
})

describe('the de-b2-reading fixture', () => {
  it('validates; its chapters are the two readings in unit order; every item names a text that exists', async () => {
    const loaded = await loadCourseFolder(path.join(FIXTURES, 'de-b2-reading'))
    const res = validateCourse(loaded.pack, loaded.catalogs)
    expect(res.problems).toEqual([])
    const pack = res.pack!
    const chapters = readerChapters(pack, encArticles(pack))
    expect(chapters.map((c) => c.id)).toEqual(['art-homeoffice', 'art-radverkehr'])
    const section: EncyclopediaSection = encyclopediaSectionSchema.parse(pack.shells.config.encyclopedia)
    expect(section.reader).toBe(true)
    for (const lang of ['hr', 'en']) {
      const text = makeTextResolver(res.catalogs!, lang, pack.targetLang)
      for (const c of chapters) {
        const entries = glossaryOf(section, c.id)
        expect(entries).toHaveLength(12)
        const body = text.text(c.bodyKeys[0] as string) as string
        const n = body.split(/\s+/).length
        expect(n).toBeGreaterThanOrEqual(380)
        expect(n).toBeLessThanOrEqual(450)
        for (const e of entries) {
          expect(body).toContain(text.text(e.term) as string)
          expect(text.text(e.gloss)).toBeTruthy()
        }
      }
      for (const it of pack.items) {
        const p = passageOf(it)
        expect(p, it.id).not.toBeNull()
        const art = pack.encyclopedia.articles.find((a) => a.id === p?.article)
        expect(art, it.id).toBeTruthy()
        const paragraphs = (text.text(art?.body ?? '') ?? '').split(/\n+/).length
        if (p?.paragraphs) expect(p.paragraphs[1]).toBeLessThanOrEqual(paragraphs)
      }
    }
  })
})

describe('listening passages (EGS-38)', () => {
  it('passageUrls lists the clips of a paragraph in order and stops at the first gap', async () => {
    const { passageUrls } = await import('../src/player/shells/encyclopedia/view-reader')
    const assets = { 'art-a1-p1': 'u1', 'art-a1-p2': 'u2', 'art-a1-p2-2': 'u2b', 'art-a1-p2-4': 'x' }
    expect(passageUrls(assets, 'a1', 1)).toEqual(['u1'])
    expect(passageUrls(assets, 'a1', 2)).toEqual(['u2', 'u2b'])
    expect(passageUrls(assets, 'a1', 3)).toEqual([])
  })
})

describe('readMarkup (EGS-50): headings and citation markers', () => {
  it('turns "## " into a heading and "[n]" into cite runs, and the words still match around them', () => {
    const m = readMarkup([[{ text: '## Die Stadt' }], [{ text: 'Das Haus steht dort [1], und der Garten [2, 3] auch.' }]])
    expect(m[0]).toEqual({ heading: true, runs: [{ text: 'Die Stadt' }] })
    expect(m[1]?.heading).toBe(false)
    expect(m[1]?.runs.filter((r) => r.cite).map((r) => r.text)).toEqual(['1', '2,3'])
    expect(m.flatMap((p) => p.runs).some((r) => /##|\[\d/.test(r.text))).toBe(false)
    const segs = glossify(m.map((p) => p.runs), [word('g', 'Garten')])
    expect(segs[1]?.some((s) => s.gloss?.id === 'g')).toBe(true)
    expect(segs[1]?.every((s) => !s.cite || !s.gloss)).toBe(true)
  })
})
