import { describe, expect, it } from 'vitest'
import { asciiSlug, assertSlug, courseSlug } from '../src/engine/edu/paths'
import { transliterate } from '../src/shared/translit'

const slug = (s: string): string => asciiSlug(s, { sep: '-', fallback: 'course' })

describe('transliterate', () => {
  it('transliterate: Cyrillic, kana, unwritable Han and Thai, Latin kept', () => {
  // Cyrillic: Russian, Ukrainian, Serbian
  {
    expect(slug('Война и мир')).toBe('voina-i-mir')
    expect(slug('Щука, Жук, Чехов, Цой, Юля, Яна')).toBe('shchuka-zhuk-chekhov-tsoi-yulya-yana')
    expect(slug('Київ Ґанок Їжак Єва')).toBe('kiyiv-ganok-yizhak-yeva')
    expect(slug('Ђорђе Љубица Њега Ћирилица Џем')).toBe('djordje-ljubitsa-njega-cirilitsa-dzem')
  }
  // Hiragana and Katakana in Hepburn: small ya, small tsu, the long mark
  {
    expect(slug('さくら')).toBe('sakura')
    expect(slug('きゃりー')).toBe('kyari')
    expect(slug('しゃしん')).toBe('shashin')
    expect(slug('ざっし')).toBe('zasshi')
    expect(slug('まっちゃ')).toBe('matcha')
    expect(slug('ラーメン')).toBe('ramen')
    expect(slug('トーキョー')).toBe('tokyo')
    expect(slug('ファイル')).toBe('fairu')
  }
  // counts the letters it cannot write: Han and Thai
  {
    expect(transliterate('红楼梦')).toMatchObject({ latin: '', dropped: 3 })
    expect(transliterate('สวัสดี').dropped).toBeGreaterThan(0)
    expect(transliterate('東京 Tokyo')).toMatchObject({ latin: ' Tokyo', dropped: 2 })
    expect(transliterate('Plain ASCII, 42!')).toEqual({ latin: 'Plain ASCII, 42!', dropped: 0 })
    // punctuation and symbols are not letters
    expect(transliterate('「…」')).toMatchObject({ dropped: 0 })
  }
  // keeps Latin letters, and writes the ones that do not decompose
  {
    expect(slug('Šime Đurđević')).toBe('sime-durdevic')
    expect(slug('Łódź Ørsted Straße Æon')).toBe('lodz-orsted-strasse-aeon')
  }
  })
})

describe('slugs', () => {
  it('slugs: Han-only text gets a stable hash; courseSlug is accepted by assertSlug, a path is not', () => {
  // Han-only text gets a short hash, the same for the same text and another for another text
  {
    const a = courseSlug('红楼梦')
    expect(a).toMatch(/^course-[0-9a-f]{6}$/)
    expect(courseSlug('红楼梦')).toBe(a)
    expect(courseSlug('西游记')).not.toBe(a)
    expect(courseSlug('東京 Tokyo')).toMatch(/^tokyo-[0-9a-f]{6}$/)
    expect(courseSlug('Тихий Дон')).toBe('tikhii-don')
  }
  // a slug made by courseSlug is always accepted by assertSlug, and a path is not
  {
    for (const t of ['Šime Đurđević', 'Война и мир', '한국어', 'Rimsko carstvo']) expect(assertSlug(courseSlug(t))).toBe(courseSlug(t))
    expect(() => assertSlug('../x')).toThrow(/invalid course slug/)
    expect(() => assertSlug('a/b')).toThrow()
    expect(() => assertSlug('')).toThrow()
  }
  })
})
