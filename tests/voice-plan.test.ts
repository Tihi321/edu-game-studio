import { describe, expect, it } from 'vitest'
import { applyMedia } from '../src/engine/edu/media-link'
import { voiceMergeOf } from '../src/engine/edu/media'
import { buildVoicePlan, buildVoiceSource, checkVoicePlan, fallbackVoiceLines, limitsOf, voicePlanSchema } from '../src/engine/edu/voice'
import type { VoiceSource } from '../src/engine/edu/voice'
import { parseCourseMedia } from '../src/shared/media'

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

describe('the answer: its schema, its checks and the fallback', () => {
  const src = sourceOf()
  const limits = limitsOf(media({ listeningPerUnit: 2 }))

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
})

describe('listening passages (EGS-38)', () => {
  const de = 'Erster Absatz. Er hat zwei Sätze.\n\nZweiter Absatz ist da. ' + 'Ein langer Satz folgt hier. '.repeat(30)
  const mk = (voice: Record<string, unknown> = {}) => {
    const pack: Json = {
      sourceLang: 'hr',
      targetLang: 'de',
      subject: 'Deutsch B2',
      audience: 'adults',
      units: [{ id: 'u1', title: 'unit.u1.title' }],
      objectives: [{ id: 'o1', unit: 'u1' }],
      items: [],
      encyclopedia: { articles: [{ id: 'a1', unit: 'u1', title: 'art.a1.title', body: 'art.a1.body' }] },
      assets: [],
      cues: [],
      extensions: {}
    }
    const catalogs: VoiceSource['catalogs'] = { hr: { strings: { 'unit.u1.title': 'Jedinica' } }, de: { strings: { 'art.a1.title': 'Titel', 'art.a1.body': de } } }
    const src = buildVoiceSource(pack, catalogs, { title: 'Deutsch', languageName: (c) => (c === 'de' ? 'German' : 'Croatian') })
    return { src, plan: buildVoicePlan(fallbackVoiceLines(src, limitsOf(media(voice), true)), src, { media: media(voice), by: 'fallback' }) }
  }

  it('plans one German clip per paragraph, a long paragraph split at sentences, with stable ids art-<article>-p<n>', () => {
    const { plan } = mk({ passages: true })
    const clips = plan.clips.filter((c) => c.role === 'passage')
    expect(clips[0]).toMatchObject({ id: 'art-a1-p1', lang: 'de', key: 'art.a1.body', paragraph: 1, part: 1, text: 'Erster Absatz. Er hat zwei Sätze.' })
    expect(clips[1]!.id).toBe('art-a1-p2')
    expect(clips.slice(2).every((c, i) => c.id === `art-a1-p2-${i + 2}` && c.paragraph === 2)).toBe(true)
    expect(clips.map((c) => c.id)).toEqual(['art-a1-p1', 'art-a1-p2', 'art-a1-p2-2'])
    expect(clips.every((c) => c.text.length <= 450 && c.lang === 'de')).toBe(true)
    expect(plan.voices.de).toMatchObject({ vibetts: 'supertonic:M2' })
    expect(mk({ passages: true }).plan.clips.map((c) => c.id)).toEqual(plan.clips.map((c) => c.id)) // stable
  })
})
