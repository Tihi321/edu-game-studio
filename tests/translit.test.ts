import { describe, expect, it } from 'vitest'
import { asciiSlug, assertSlug, courseSlug, stripDiacritics } from '../src/engine/edu/paths'
import { transliterate } from '../src/shared/translit'

const slug = (s: string): string => asciiSlug(s, { sep: '-', fallback: 'course' })

describe('transliterate', () => {
  it('Cyrillic: Russian, Ukrainian, Serbian', () => {
    expect(slug('Война и мир')).toBe('voina-i-mir')
    expect(slug('Щука, Жук, Чехов, Цой, Юля, Яна')).toBe('shchuka-zhuk-chekhov-tsoi-yulya-yana')
    expect(slug('Київ Ґанок Їжак Єва')).toBe('kiyiv-ganok-yizhak-yeva')
    expect(slug('Ђорђе Љубица Њега Ћирилица Џем')).toBe('djordje-ljubitsa-njega-cirilitsa-dzem')
  })
  it('Greek, with the accents and the polytonic letters', () => {
    expect(slug('Ὀδύσσεια')).toBe('odysseia')
    expect(slug('Ελλάδα')).toBe('ellada')
    expect(slug('Θεός, Χάος, Ψυχή')).toBe('theos-chaos-psychi')
    expect(slug('Ούτος')).toBe('outos')
  })
  it('Armenian and Georgian', () => {
    expect(slug('Հայաստան')).toBe('hayastan')
    expect(slug('საქართველო')).toBe('sakartvelo')
  })
  it('Hebrew and Arabic (consonants), Persian letters', () => {
    expect(slug('שלום')).toBe('shlvm')
    expect(slug('محمد')).toBe('mhmd')
    expect(slug('پارسی')).toBe('parsy')
  })
  it('Devanagari: the virama drops the inherent a', () => {
    expect(slug('नमस्ते')).toBe('namaste')
    expect(slug('हिन्दी')).toBe('hindii')
    expect(slug('क्षमा')).toBe('kshamaa')
  })
  it('Hiragana and Katakana in Hepburn: small ya, small tsu, the long mark', () => {
    expect(slug('さくら')).toBe('sakura')
    expect(slug('きゃりー')).toBe('kyari')
    expect(slug('しゃしん')).toBe('shashin')
    expect(slug('ざっし')).toBe('zasshi')
    expect(slug('まっちゃ')).toBe('matcha')
    expect(slug('ラーメン')).toBe('ramen')
    expect(slug('トーキョー')).toBe('tokyo')
    expect(slug('ファイル')).toBe('fairu')
  })
  it('Hangul: Revised Romanization from the syllables', () => {
    expect(slug('한국어')).toBe('hangugeo')
    expect(slug('서울')).toBe('seoul')
    expect(slug('안녕하세요')).toBe('annyeonghaseyo')
  })
  it('counts the letters it cannot write: Han and Thai', () => {
    expect(transliterate('红楼梦')).toMatchObject({ latin: '', dropped: 3 })
    expect(transliterate('สวัสดี').dropped).toBeGreaterThan(0)
    expect(transliterate('東京 Tokyo')).toMatchObject({ latin: ' Tokyo', dropped: 2 })
    expect(transliterate('Plain ASCII, 42!')).toEqual({ latin: 'Plain ASCII, 42!', dropped: 0 })
    // punctuation and symbols are not letters
    expect(transliterate('「…」')).toMatchObject({ dropped: 0 })
  })
  it('keeps Latin letters, and writes the ones that do not decompose', () => {
    expect(slug('Šime Đurđević')).toBe('sime-durdevic')
    expect(slug('Łódź Ørsted Straße Æon')).toBe('lodz-orsted-strasse-aeon')
  })
})

describe('slugs', () => {
  it('Han-only text gets a short hash, the same for the same text and another for another text', () => {
    const a = courseSlug('红楼梦')
    expect(a).toMatch(/^course-[0-9a-f]{6}$/)
    expect(courseSlug('红楼梦')).toBe(a)
    expect(courseSlug('西游记')).not.toBe(a)
    expect(courseSlug('東京 Tokyo')).toMatch(/^tokyo-[0-9a-f]{6}$/)
    expect(courseSlug('Тихий Дон')).toBe('tikhii-don')
  })
  it('mixed text keeps its Latin part, transliterates the rest, and hashes only when something was dropped', () => {
    expect(courseSlug('Hello Мир')).toBe('hello-mir')
    expect(courseSlug('Hello 世界')).toMatch(/^hello-[0-9a-f]{6}$/)
    expect(courseSlug('Ancient Rome: an Introduction')).toBe('ancient-rome-an-introduction')
    expect(courseSlug('')).toBe('course')
  })
  it('a long title is cut and still fits a slug of 60 characters with the hash', () => {
    expect(courseSlug('a'.repeat(100))).toBe('a'.repeat(60))
    const long = courseSlug('红'.repeat(5) + 'b'.repeat(100))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).toMatch(/-[0-9a-f]{6}$/)
  })
  it('a slug made by courseSlug is always accepted by assertSlug, and a path is not', () => {
    for (const t of ['Šime Đurđević', 'Война и мир', '한국어', 'Rimsko carstvo']) expect(assertSlug(courseSlug(t))).toBe(courseSlug(t))
    expect(() => assertSlug('../x')).toThrow(/invalid course slug/)
    expect(() => assertSlug('a/b')).toThrow()
    expect(() => assertSlug('')).toThrow()
  })
  it('stripDiacritics handles č ć đ š ž', () => {
    expect(stripDiacritics('čćđšž ČĆĐŠŽ')).toBe('ccdsz CCDSZ')
  })
})
