import { describe, expect, it } from 'vitest'
import { PROMPT_VARS } from '../src/engine/edu/authoring'
import { applyMedia } from '../src/engine/edu/media-link'
import { voiceMergeOf } from '../src/engine/edu/media'
import { buildVoicePlan, buildVoiceSource, checkVoicePlan, deriveListening, fallbackStyle, fallbackVoiceLines, limitsOf, mergeVoicePlan, voicePlanSchema, voicePromptVars } from '../src/engine/edu/voice'
import type { VoiceSource } from '../src/engine/edu/voice'
import { parseCourseMedia } from '../src/shared/media'
import type { AssetManifest } from '../src/shared/media'
import { derivedListeningId, isDerivedItem, shortenForSpeech, voiceClipId } from '../src/shared/voice'

/**
 * The voice-director's contract (EGS-17), without a model: what it is shown, the checks of its answer, the deterministic fallback, the plan file, the
 * derived listening items, the manifest merge and the merge into the pack.
 */

const media = (voice: Record<string, unknown> = {}) => parseCourseMedia({ voice: { narration: true, ...voice } })
const names = (k: string): string => (k === 'hr' ? 'Croatian' : k === 'en' ? 'English' : k)

type Json = Record<string, unknown>
function course() {
  const pack: Json = {
    sourceLang: 'en',
    targetLang: 'hr',
    subject: 'Croatian greetings',
    audience: 'adults',
    units: [
      { id: 'u1', title: 'unit.u1.title', summary: 'unit.u1.summary' },
      { id: 'u2', title: 'unit.u2.title', summary: 'unit.u2.summary' }
    ],
    objectives: [
      { id: 'u1-o1', unit: 'u1' },
      { id: 'u2-o1', unit: 'u2' }
    ],
    items: [
      { id: 'u1-t1', objective: 'u1-o1', kind: 'typed', prompt: 'p1', explanation: 'e1', answer: 'u1-t1.a', difficulty: 2, tags: [], extensions: { facts: ['f1'] } },
      { id: 'u1-m1', objective: 'u1-o1', kind: 'mcq', prompt: 'p2', explanation: 'e2', options: [{ id: 'a', text: 'o.a' }, { id: 'b', text: 'o.b', why: 'w' }], answer: 'a', extensions: { facts: ['f1'] } },
      { id: 'u1-t2', objective: 'u1-o1', kind: 'typed', prompt: 'p3', explanation: 'e3', answer: 'u1-t2.a', extensions: { facts: ['f2'] } },
      { id: 'u2-t1', objective: 'u2-o1', kind: 'typed', prompt: 'p4', explanation: 'e4', answer: 'u2-t1.a', extensions: { facts: ['f3'] } },
      { id: 'u2-l1', objective: 'u2-o1', kind: 'listening', prompt: 'p5', explanation: 'e5', mode: 'type', transcript: 't.molim', answer: 't.molim', asset: 'aud-own', extensions: { facts: ['f3'] } },
      { id: 'u2-l2', objective: 'u2-o1', kind: 'listening', prompt: 'p6', explanation: 'e6', mode: 'type', transcript: 't.hvala', answer: 't.hvala', asset: 'aud-tone', extensions: { facts: ['f3'] } }
    ],
    encyclopedia: { articles: [{ id: 'a-u1-1', unit: 'u1', title: 'art.title', body: 'art.body', asset: 'img-x' }] },
    assets: [
      { id: 'aud-own', kind: 'audio', file: 'assets/own.wav', alt: 'alt.own' },
      { id: 'aud-tone', kind: 'audio', file: 'assets/placeholder-tone.wav', alt: 'alt.tone' }
    ],
    cues: [],
    extensions: {}
  }
  const catalogs: VoiceSource['catalogs'] = {
    en: { strings: { 'unit.u1.title': 'Greetings', 'unit.u2.title': 'Politeness', 'unit.u1.summary': 'You learn to greet people.', 'unit.u2.summary': 'You learn to be polite.', 'art.title': 'Why greet', 'art.body': 'Greeting matters. '.repeat(80), 'item.u2-l2.expl': 'x', e6: 'The clip says "Hvala". (In this test course the sound is a placeholder tone, not speech.)', 'alt.tone': 'A placeholder tone, not speech.' } },
    hr: { strings: { 'o.a': 'Dobar dan', 'o.b': 'Laku noć', 't.molim': 'Molim', 't.hvala': 'Hvala' }, accepted: { 'u1-t1.a': ['Dobro jutro'], 'u1-t2.a': ['Doviđenja', 'Do viđenja'], 'u2-t1.a': ['Izvolite'] } }
  }
  return { pack, catalogs }
}
const sourceOf = (): VoiceSource => {
  const { pack, catalogs } = course()
  return buildVoiceSource(pack, catalogs, { title: 'Croatian greetings', languageName: names, real: (id) => id === 'aud-own' })
}

describe('what the voice-director is shown', () => {
  it('reads the units, the narration candidates, the listening items and the taught phrases a listening item can be made from', () => {
    const src = sourceOf()
    expect(src).toMatchObject({ sourceLang: 'en', targetLang: 'hr', language: 'English', targetLanguage: 'Croatian' })
    expect(src.narration.map((n) => [n.key, n.kind, n.ref])).toEqual([['unit.u1.summary', 'unit', 'u1'], ['unit.u2.summary', 'unit', 'u2'], ['art.body', 'article', 'a-u1-1']])
    expect(src.candidates.map((c) => [c.item, c.mode, c.phrase, c.unit])).toEqual([
      ['u1-t1', 'type', 'Dobro jutro', 'u1'],
      ['u1-m1', 'choose', 'Dobar dan', 'u1'],
      ['u1-t2', 'type', 'Doviđenja', 'u1'],
      ['u2-t1', 'type', 'Izvolite', 'u2']
    ])
    // the listening items it has: one with its own real recording (no clip is made), one with a tone placeholder (a clip replaces it)
    expect(src.listening.map((l) => [l.item, l.key, l.lang, l.ownAudio])).toEqual([['u2-l1', 't.molim', 'hr', true], ['u2-l2', 't.hvala', 'hr', false]])
  })

  it('a phrase a hand-made listening item already speaks is not offered again; a source language course has no candidates', () => {
    const { pack, catalogs } = course()
    ;(catalogs.hr!.accepted as Record<string, string[]>)['u2-t1.a'] = ['Hvala']
    expect(buildVoiceSource(pack, catalogs, { title: 't', languageName: names }).candidates.map((c) => c.item)).not.toContain('u2-t1')
    const mono = { ...pack, targetLang: undefined }
    expect(buildVoiceSource(mono, catalogs, { title: 't', languageName: names }).candidates).toEqual([])
  })

  it('the prompt variables are exactly the ones the prompt file is registered with', () => {
    const vars = voicePromptVars(sourceOf(), media())
    expect(Object.keys(vars).sort()).toEqual([...PROMPT_VARS['voice-director/plan']].sort())
    expect(vars).toMatchObject({ source_lang: 'en', target_lang: 'hr', target_language: 'Croatian', max_narration: 12, per_unit: 3 })
    expect(String(vars.candidates)).toMatch(/^- u1-t1 \(typed, unit u1 "Greetings"\): Dobro jutro$/m)
    expect(String(vars.candidates)).toMatch(/^- u1-m1 \(multiple choice, unit u1 "Greetings"\): Dobar dan$/m)
    expect(String(vars.listening)).toMatch(/u2-l1.*\(has its own recording\)/)
    expect(String(voicePromptVars(sourceOf(), media({ narration: false })).narration)).toMatch(/narration is switched off/)
    expect(String(voicePromptVars(sourceOf(), media({ listening: false })).candidates)).toMatch(/switched off/)
  })
})

describe('the answer: its schema, its checks and the fallback', () => {
  const src = sourceOf()
  const limits = limitsOf(media({ listeningPerUnit: 2 }))

  it('the schema tolerates nulls and fills the defaults; a wrong shape is refused', () => {
    expect(voicePlanSchema.parse({ voices: { hr: { style: 'slow', gemini: null } }, narration: null, derive: [{ item: 'u1-t1', prompt: null }] })).toEqual({ voices: { hr: { style: 'slow' } }, narration: [], derive: [{ item: 'u1-t1' }], notes: '' })
    expect(voicePlanSchema.safeParse({ narration: 'a text' }).success).toBe(false)
    expect(voicePlanSchema.safeParse({ derive: [{ item: '' }] }).success).toBe(false)
  })

  it('checkVoicePlan names every problem: unknown key or item, repeats, over the limits, a language the course does not speak, a bad Gemini voice', () => {
    expect(checkVoicePlan(voicePlanSchema.parse({ voices: { hr: { gemini: 'gemini:Kore' }, en: {} }, narration: [{ key: 'unit.u1.summary' }], derive: [{ item: 'u1-t1' }, { item: 'u1-m1' }] }), src, limits)).toEqual([])
    const bad = checkVoicePlan(
      voicePlanSchema.parse({
        voices: { de: {}, hr: { gemini: 'Kore' } },
        narration: [{ key: 'no.key' }, { key: 'unit.u1.summary' }, { key: 'unit.u1.summary' }],
        derive: [{ item: 'nope' }, { item: 'u1-t1' }, { item: 'u1-t1' }, { item: 'u1-m1' }, { item: 'u1-t2' }]
      }),
      src,
      limits
    ).map((p) => `${p.ref}: ${p.issue}`)
    expect(bad).toEqual(
      expect.arrayContaining([
        'no.key: this is not a text that can be narrated',
        'unit.u1.summary: this text is narrated twice',
        'nope: no listening item can be made from this item',
        'u1-t1: this item is listed twice',
        'u1: 4 listening items from this unit, at most 2',
        'de: this language is not spoken in the course',
        'hr: "Kore" is not a Gemini voice id'
      ])
    )
    expect(checkVoicePlan(voicePlanSchema.parse({ narration: Array.from({ length: 13 }, (_, i) => ({ key: `k${i}` })) }), src, limits).some((p) => /13 texts to narrate, at most 12/.test(p.issue))).toBe(true)
  })

  it('the fallback narrates the unit summaries and one article per unit, derives up to perUnit items alternating typed and choose, and gives each language a style', () => {
    const f = fallbackVoiceLines(src, limits)
    expect(f.narration.map((n) => n.key)).toEqual(['unit.u1.summary', 'unit.u2.summary', 'art.body'])
    expect(f.derive.map((d) => d.item)).toEqual(['u1-t1', 'u1-m1', 'u2-t1']) // unit u1: typed, then choose (2 at most); unit u2: its one
    expect(Object.keys(f.voices).sort()).toEqual(['en', 'hr'])
    expect(f.voices.hr!.style).toMatch(/language teacher/)
    expect(checkVoicePlan(f, src, limits)).toEqual([])
    const off = fallbackVoiceLines(src, limitsOf(media({ narration: false, listening: false })))
    expect(off).toMatchObject({ narration: [], derive: [] })
  })
})

describe('the plan file', () => {
  const src = sourceOf()
  const lines = voicePlanSchema.parse({ voices: { hr: { style: 'slow', gemini: 'gemini:Aoede' } }, narration: [{ key: 'unit.u1.summary', alt: 'Intro audio' }, { key: 'art.body' }], derive: [{ item: 'u1-t1', prompt: 'Type it.' }, { item: 'u1-m1' }] })
  const plan = buildVoicePlan(lines, src, { media: media(), by: 'model', at: '2026-10-30T10:00:00Z' })

  it('has a clip for the transcript of every listening item without a real recording, the derived items and the narration, with stable ids', () => {
    expect(plan.clips.map((c) => [c.id, c.lang, c.role, c.items])).toEqual([
      ['voice-hr-t-hvala', 'hr', 'listening', ['u2-l2']], // the hand-made item with a tone placeholder; u2-l1 has its own recording: no clip
      ['voice-hr-item-u1-t1-listen-transcript', 'hr', 'listening', ['u1-t1-listen']],
      ['voice-hr-o-a', 'hr', 'listening', ['u1-m1-listen']],
      ['voice-en-unit-u1-summary', 'en', 'narration', undefined],
      ['voice-en-art-body', 'en', 'narration', undefined]
    ])
    expect(plan.clips.find((c) => c.key === 'unit.u1.summary')).toMatchObject({ alt: 'Intro audio', text: 'You learn to greet people.' })
    expect(plan.clips.find((c) => c.key === 'art.body')!.text.length).toBeLessThanOrEqual(600) // a long article is cut at a sentence
    expect(plan.clips.find((c) => c.key === 'art.body')!.text).toMatch(/\.$/)
    expect(plan.voices).toEqual({ hr: { style: 'slow', gemini: 'gemini:Aoede' }, en: { style: expect.stringMatching(/narrator|teacher/) } })
    expect(plan).toMatchObject({ version: 1, source: 'model', sourceLang: 'en', targetLang: 'hr' })
    // a second plan of the same answer has the same ids
    expect(buildVoicePlan(lines, src, { media: media(), by: 'model' }).clips.map((c) => c.id)).toEqual(plan.clips.map((c) => c.id))
  })

  it('derived items: the source objective and facts, difficulty + 1, the source answers (type) or options (choose), a marker, a prompt in the source language', () => {
    expect(plan.derived.map((d) => d.id)).toEqual(['u1-t1-listen', 'u1-m1-listen'])
    const t = plan.derived[0]!
    expect(t).toMatchObject({ source: 'u1-t1', mode: 'type', clip: 'voice-hr-item-u1-t1-listen-transcript', strings: { en: { 'item.u1-t1-listen.prompt': 'Type it.' }, hr: { 'item.u1-t1-listen.transcript': 'Dobro jutro' } } })
    expect(t.item).toMatchObject({ id: 'u1-t1-listen', objective: 'u1-o1', kind: 'listening', mode: 'type', answer: 'u1-t1.a', transcript: 'item.u1-t1-listen.transcript', difficulty: 3, extensions: { facts: ['f1'], voice: { derivedFrom: 'u1-t1' } } })
    expect(t.item.tags).toContain('listening')
    const c = plan.derived[1]!
    expect(c.mode).toBe('choose')
    expect(c.item).toMatchObject({ options: [{ id: 'a', text: 'o.a' }, { id: 'b', text: 'o.b', why: 'w' }], answer: 'a', transcript: 'o.a' })
    expect(c.strings.en!['item.u1-m1-listen.prompt']).toMatch(/Listen to the recording and choose/) // the default words of the source language
    expect(isDerivedItem(t.item)).toBe(true)
    expect(derivedListeningId('u1-t1')).toBe('u1-t1-listen')
  })

  it('respects the limits: perUnit, switched-off narration or listening, unknown keys are dropped, a language without words gets the English ones', () => {
    const two = buildVoicePlan(voicePlanSchema.parse({ derive: ['u1-t1', 'u1-m1', 'u1-t2'].map((item) => ({ item })) }), src, { media: media({ listeningPerUnit: 2 }), by: 'model' })
    expect(two.derived.map((d) => d.source)).toEqual(['u1-t1', 'u1-m1'])
    const none = buildVoicePlan(lines, src, { media: media({ narration: false, listening: false }), by: 'model' })
    expect(none.clips).toEqual([])
    expect(none.derived).toEqual([])
    expect(buildVoicePlan(voicePlanSchema.parse({ narration: [{ key: 'no.key' }], derive: [{ item: 'no-item' }] }), src, { media: media(), by: 'model' }).derived).toEqual([])
    expect(deriveListening({ id: 'x', objective: 'o', kind: 'typed', answer: 'x.a' }, { item: 'x', unit: 'u1', mode: 'type', phrase: 'Dan', raw: {} }, { sourceLang: 'xx', targetLang: 'hr' }, 'p')!.strings.xx).toEqual({ 'item.x-listen.prompt': 'p' })
    expect(deriveListening({ id: 'x' }, { item: 'x', unit: 'u1', mode: 'type', phrase: 'Dan', raw: {} }, { sourceLang: 'en' }, 'p')).toBeNull() // not a language course
  })

  it('mergeVoicePlan adds an empty entry per clip and keeps the versions, hash, selection and lock of one that exists', () => {
    const m1 = mergeVoicePlan({ assets: [] }, plan)
    expect(m1.assets.map((a) => a.id)).toEqual(plan.clips.map((c) => c.id))
    expect(m1.assets[0]).toMatchObject({ kind: 'voice', versions: [], selected: null, locked: false, voice: { lang: 'hr', key: 't.hvala', role: 'listening', hash: '' } })
    const made: AssetManifest = { assets: m1.assets.map((a, i) => (i === 0 ? { ...a, versions: [{ n: 1, file: 'v1.wav', createdAt: 'x', seed: null, engine: 'e', prompt: 'p' }], selected: 1, locked: true, voice: { ...a.voice!, hash: 'h', text: 'Hvala', provider: 'gemini' as const } } : a)) }
    const m2 = mergeVoicePlan(made, { clips: plan.clips.map((c) => ({ ...c, alt: 'new alt' })) })
    expect(m2.assets[0]).toMatchObject({ selected: 1, locked: true, alt: 'new alt', voice: { hash: 'h', text: 'Hvala', provider: 'gemini' } })
  })
})

describe('clip ids and the narration text', () => {
  it('voiceClipId sanitizes the key, and a long key is cut with a short hash so two long keys never collide', () => {
    expect(voiceClipId('hr', 't.dobar-dan')).toBe('voice-hr-t-dobar-dan')
    expect(voiceClipId('HR', 'Item U1/Q1 transcript!')).toBe('voice-hr-item-u1-q1-transcript')
    const a = voiceClipId('hr', `item.${'x'.repeat(100)}.a`)
    const b = voiceClipId('hr', `item.${'x'.repeat(100)}.b`)
    expect(a.length).toBeLessThanOrEqual(72)
    expect(a).not.toBe(b)
    expect(voiceClipId('hr', '')).toBe('voice-hr-clip')
  })

  it('shortenForSpeech cuts at a sentence (else at a word), drops [f1] citations and collapses space', () => {
    expect(shortenForSpeech('One.  Two [f1].\n\nThree is long.', 20)).toBe('One. Two.')
    expect(shortenForSpeech('word '.repeat(30), 40)).toMatch(/word\.\.\.$/)
    expect(shortenForSpeech('short text')).toBe('short text')
  })
})

describe('the merge into the pack', () => {
  const src = sourceOf()
  const lines = voicePlanSchema.parse({ narration: [{ key: 'unit.u1.summary' }], derive: [{ item: 'u1-t1' }, { item: 'u1-m1' }] })
  const plan = buildVoicePlan(lines, src, { media: media(), by: 'model' })
  const all = new Set(plan.clips.map((c) => c.id))

  it('puts the derived items after their source, sets listening.asset, links the narration, adds the strings, drops the tone placeholder and what said it was one', () => {
    const { pack, catalogs } = course()
    const en = { strings: catalogs.en!.strings! as Record<string, string> }
    const hr = { strings: catalogs.hr!.strings! as Record<string, string> }
    const merge = { assets: [...all].map((id) => ({ id, kind: 'audio' as const, file: `assets/${id}/v1.wav`, alt: `asset.${id}.alt` })), targets: {}, voice: voiceMergeOf(plan, all) }
    const applied = applyMedia(pack, en, merge, { hr })
    expect(applied.voice).toEqual({ derived: 2, listening: 3, narration: 1 })
    const items = pack.items as Json[]
    expect(items.map((i) => i.id)).toEqual(['u1-t1', 'u1-t1-listen', 'u1-m1', 'u1-m1-listen', 'u1-t2', 'u2-t1', 'u2-l1', 'u2-l2'])
    expect(items.find((i) => i.id === 'u1-t1-listen')).toMatchObject({ asset: 'voice-hr-item-u1-t1-listen-transcript' })
    expect(items.find((i) => i.id === 'u2-l2')).toMatchObject({ asset: 'voice-hr-t-hvala' }) // the tone is replaced
    expect(items.find((i) => i.id === 'u2-l1')).toMatchObject({ asset: 'aud-own' }) // its own recording stays
    expect(en.strings['item.u1-t1-listen.prompt']).toMatch(/Listen to the recording and type/)
    expect(hr.strings['item.u1-t1-listen.transcript']).toBe('Dobro jutro') // the target-language string goes to the target catalog
    expect((pack.extensions as Json).narration).toEqual({ 'unit.u1.summary': 'voice-en-unit-u1-summary' })
    const assetIds = (pack.assets as Json[]).map((a) => a.id)
    expect(assetIds).not.toContain('aud-tone')
    expect(assetIds).toContain('aud-own')
    expect(en.strings['alt.tone']).toBeUndefined()
    expect(en.strings.e6).toBe('The clip says "Hvala".') // the stale "placeholder tone" note is gone
  })

  it('is idempotent; a derived item the plan no longer names is removed; a string that is there (corrected by hand) is kept; no narration removes the key', () => {
    const { pack, catalogs } = course()
    const en = { strings: catalogs.en!.strings! as Record<string, string> }
    const hr = { strings: catalogs.hr!.strings! as Record<string, string> }
    const mk = (p: typeof plan, ids: Set<string>) => ({ assets: [...ids].map((id) => ({ id, kind: 'audio' as const, file: `assets/${id}/v1.wav`, alt: `asset.${id}.alt` })), targets: {}, voice: voiceMergeOf(p, ids) })
    applyMedia(pack, en, mk(plan, all), { hr })
    const first = JSON.stringify(pack)
    applyMedia(pack, en, mk(plan, all), { hr })
    expect(JSON.stringify(pack)).toBe(first)

    hr.strings['item.u1-t1-listen.transcript'] = 'Dobro jutro, svima' // corrected by hand
    applyMedia(pack, en, mk(plan, all), { hr })
    expect(hr.strings['item.u1-t1-listen.transcript']).toBe('Dobro jutro, svima')

    const smaller = buildVoicePlan(voicePlanSchema.parse({ derive: [{ item: 'u1-m1' }] }), src, { media: media(), by: 'model' })
    applyMedia(pack, en, mk(smaller, new Set(smaller.clips.map((c) => c.id))), { hr })
    expect((pack.items as Json[]).map((i) => i.id)).toEqual(['u1-t1', 'u1-m1', 'u1-m1-listen', 'u1-t2', 'u2-t1', 'u2-l1', 'u2-l2'])
    expect((pack.extensions as Json).narration).toBeUndefined()
  })

  it('a clip without a file or a placeholder is not linked: its derived item is not added, its listening item keeps what it had', () => {
    const linked = new Set(['voice-hr-t-hvala'])
    const v = voiceMergeOf(plan, linked)
    expect(v).toEqual({ items: [], strings: {}, listening: { 'u2-l2': 'voice-hr-t-hvala' }, narration: {} })
  })
})

describe('narration default (EGS-33)', () => {
  it('is off for a language course and on for the others; an explicit setting wins', () => {
    expect(limitsOf(parseCourseMedia({}), true).narration).toBe(false)
    expect(limitsOf(parseCourseMedia({}), false).narration).toBe(true)
    expect(limitsOf(media({ narration: true }), true).narration).toBe(true)
    expect(limitsOf(media({ narration: false }), false).narration).toBe(false)
  })

  it('the taught German style says Hochdeutsch', () => {
    expect(fallbackStyle({ kids: false }, 'de', true)).toMatch(/Hochdeutsch/)
    expect(fallbackStyle({ kids: false }, 'hr', true)).not.toMatch(/Hochdeutsch/)
  })
})
