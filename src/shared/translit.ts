/**
 * Transliteration of non-Latin text to Latin letters, for slugs and keys (a course folder, a character key, an identifier) and nothing
 * else: it is not a spelling guide. Table-driven, no dependency.
 *
 * Covered: Cyrillic (Russian, Ukrainian, Belarusian, Serbian, Bulgarian), Greek, Armenian, Georgian, Hebrew, Arabic and Persian (consonants
 * only), Devanagari, Hiragana and Katakana (Hepburn), Hangul (Revised Romanization). Han, Thai and every other letter are dropped and
 * counted: the caller adds a short hash so two different titles never share a slug.
 */

export interface Transliterated {
  /** The Latin text. It may keep diacritics (`ā` after a Japanese long vowel): the caller strips them. */
  latin: string
  /** How many letters had no mapping and were dropped (Han, Thai ...). Punctuation and symbols are not counted. */
  dropped: number
}

const cap = (s: string, upper: boolean): string => (upper && s ? s[0]!.toUpperCase() + s.slice(1) : s)

// ---- Cyrillic ----

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Ukrainian and Belarusian
  ґ: 'g', є: 'ye', і: 'i', ї: 'yi', ў: 'u',
  // Serbian and Macedonian
  ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz', ѕ: 'dz', ѓ: 'g', ќ: 'k'
}

// ---- Greek (after the accents are removed) ----

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r',
  σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o'
}

// ---- Armenian (lower case; upper case is 0x30 below) ----

const ARMENIAN: Record<string, string> = {
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz',
  ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch', պ: 'p', ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'w',
  փ: 'p', ք: 'k', օ: 'o', ֆ: 'f'
}

// ---- Georgian (Mkhedruli) ----

const GEORGIAN: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h'
}

// ---- Hebrew and Arabic (consonants) ----

const HEBREW: Record<string, string> = {
  א: '', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'v', ז: 'z', ח: 'h', ט: 't', י: 'y', כ: 'k', ך: 'k', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's',
  ע: '', פ: 'p', ף: 'p', צ: 'ts', ץ: 'ts', ק: 'k', ר: 'r', ש: 'sh', ת: 't'
}

const ARABIC: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'a', آ: 'a', ٱ: 'a', ى: 'a', ة: 'a', ء: '', ؤ: 'w', ئ: 'y', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh',
  ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ک: 'k', ل: 'l', م: 'm', ن: 'n',
  ه: 'h', ہ: 'h', و: 'w', ي: 'y', ی: 'y', ے: 'y',
  // Persian and Urdu
  پ: 'p', چ: 'ch', ژ: 'zh', گ: 'g', ٹ: 't', ڈ: 'd', ڑ: 'r', ں: 'n'
}

// ---- Devanagari ----

const DEVA_CONSONANT: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ng', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'ny', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th',
  द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l'
}
const DEVA_VOWEL: Record<string, string> = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ii', उ: 'u', ऊ: 'uu', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' }
const DEVA_SIGN: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' }
const VIRAMA = '्'
const NUKTA = /़/g

// ---- Japanese kana (Hepburn) ----

const KANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゎ: 'wa', ゃ: 'ya', ゅ: 'yu', ょ: 'yo'
}
/** The consonant part of a kana that takes a small ya, yu or yo (きゃ kya, しゃ sha, じゃ ja, ちゃ cha). */
const KANA_COMBO: Record<string, string> = { き: 'ky', ぎ: 'gy', し: 'sh', じ: 'j', ぢ: 'j', ち: 'ch', に: 'ny', ひ: 'hy', び: 'by', ぴ: 'py', み: 'my', り: 'ry' }
const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' }
/** Small vowels after a kana make a foreign sound: ふぁ fa, てぃ ti. */
const SMALL_VOWEL: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }
const LONG: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' }
const VOWELS = 'aiueo'

/** Katakana to hiragana (one table serves both); everything else stays. */
const toHiragana = (ch: string): string => {
  const c = ch.codePointAt(0)!
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch
}

/** Romanises the kana at `at`; returns how many characters it used (0: not a kana it knows). */
function kana(chars: string[], at: number, out: { s: string }): number {
  const ch = toHiragana(chars[at]!)
  const next = chars[at + 1] ? toHiragana(chars[at + 1]!) : ''
  if (ch === 'っ') {
    // a small tsu doubles the consonant of the next kana (kk, tt, ss; tch before ch)
    const syll = (KANA_COMBO[next] ?? KANA[next] ?? '').toString()
    out.s += syll.startsWith('ch') ? 't' : syll && !VOWELS.includes(syll[0]!) ? syll[0]! : ''
    return 1
  }
  if (ch === 'ー') {
    const last = out.s.slice(-1)
    if (LONG[last]) out.s = out.s.slice(0, -1) + LONG[last]
    return 1
  }
  if (KANA_COMBO[ch] && SMALL_Y[next]) {
    out.s += KANA_COMBO[ch]! + SMALL_Y[next]!
    return 2
  }
  if (KANA[ch] && !VOWELS.includes(KANA[ch]!) && SMALL_VOWEL[next]) {
    out.s += KANA[ch]!.replace(/[aiueo]$/, '') + SMALL_VOWEL[next]!
    return 2
  }
  if (KANA[ch] !== undefined) {
    out.s += KANA[ch]
    return 1
  }
  return 0
}

// ---- Korean (Revised Romanization, from the syllable) ----

const HANGUL_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const HANGUL_VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const HANGUL_FINAL = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h']

function hangul(cp: number): string {
  const n = cp - 0xac00
  return HANGUL_INITIAL[Math.floor(n / 588)]! + HANGUL_VOWEL[Math.floor((n % 588) / 28)]! + HANGUL_FINAL[n % 28]!
}

// ---- Latin letters that do not decompose ----

const LATIN_EXTRA: Record<string, string> = { ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ı: 'i' }

const MARKS = /[̀-ͯ]/g
const isMark = (ch: string): boolean => /\p{M}/u.test(ch)

/** The base letter of a character with accents: `ά` -> `α`, `Ὀ` -> `Ο`. */
const baseOf = (ch: string): string => ch.normalize('NFD').replace(MARKS, '')

/**
 * Latin text for any text: Latin letters, digits and punctuation stay as they are, the scripts above are transliterated, every other letter is
 * dropped and counted.
 */
export function transliterate(text: string): Transliterated {
  const chars = [...text.normalize('NFC').replace(NUKTA, '')]
  const out = { s: '' }
  let dropped = 0
  let prev = '' // the last Greek base letter, for ου
  for (let i = 0; i < chars.length; ) {
    const ch = chars[i]!
    const cp = ch.codePointAt(0)!
    const lower = ch.toLowerCase()
    const upper = ch !== lower
    let used = 1
    let mapped: string | undefined
    let greek = ''
    if (cp < 0x250 || (cp >= 0x1e00 && cp <= 0x1eff)) {
      mapped = LATIN_EXTRA[ch] ?? ch
    } else if (cp >= 0x400 && cp <= 0x52f) {
      const m = CYRILLIC[lower] ?? CYRILLIC[baseOf(lower)]
      if (m !== undefined) mapped = cap(m, upper)
    } else if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) {
      greek = baseOf(ch).toLowerCase()
      const m = greek === 'υ' && prev === 'ο' ? 'u' : GREEK[greek]
      if (m !== undefined) mapped = cap(m, upper)
    } else if (cp >= 0x531 && cp <= 0x586) {
      const m = ARMENIAN[cp <= 0x556 ? String.fromCodePoint(cp + 0x30) : ch]
      if (m !== undefined) mapped = cap(m, cp <= 0x556)
    } else if ((cp >= 0x10d0 && cp <= 0x10fa) || (cp >= 0x1c90 && cp <= 0x1cba)) {
      mapped = GEORGIAN[cp >= 0x1c90 ? String.fromCodePoint(cp - 0x1c90 + 0x10d0) : ch]
    } else if (cp >= 0x5d0 && cp <= 0x5ea) {
      mapped = HEBREW[ch]
    } else if (cp >= 0x600 && cp <= 0x6ff) {
      mapped = ARABIC[ch]
      if (mapped === undefined && isMark(ch)) mapped = '' // the vowel points
    } else if (cp >= 0x900 && cp <= 0x97f) {
      const c = DEVA_CONSONANT[ch]
      const next = chars[i + 1]
      if (c !== undefined) {
        if (next === VIRAMA) {
          mapped = c // the virama drops the inherent a
          used = 2
        } else if (next && DEVA_SIGN[next] !== undefined) {
          mapped = c + DEVA_SIGN[next]!
          used = 2
        } else mapped = c + 'a'
      } else if (DEVA_VOWEL[ch] !== undefined) mapped = DEVA_VOWEL[ch]
      else if (ch === 'ं' || ch === 'ँ') mapped = 'n'
      else if (ch === 'ः') mapped = 'h'
      else if (ch === VIRAMA || DEVA_SIGN[ch] !== undefined) mapped = ''
      else if (cp >= 0x966 && cp <= 0x96f) mapped = String(cp - 0x966)
    } else if (cp >= 0x3040 && cp <= 0x30ff) {
      const n = kana(chars, i, out)
      if (n > 0) {
        i += n
        prev = ''
        continue
      }
    } else if (cp >= 0xac00 && cp <= 0xd7a3) {
      mapped = hangul(cp)
    }
    prev = greek
    if (mapped !== undefined) out.s += mapped
    else if (/\p{L}/u.test(ch)) dropped++
    else if (!isMark(ch)) out.s += ch
    i += used
  }
  return { latin: out.s, dropped }
}
