import { describe, expect, it } from 'vitest'
import { checkScenes, sceneOutputSchema, toRoleplaySection, type SceneContext, type SceneOutput } from '../src/engine/edu/scenes'
import { roleplaySectionSchema } from '../src/shared/shells/roleplay'

/** EGS-39: the scene-writer's answer is checked in code (a golden German A1 answer passes; each class of fault gives its own problem). */

const line = (id: string, next: string | null, rest: Record<string, unknown>) => ({ id, next, ...rest })
const golden = (): unknown => ({
  speakers: [{ id: 'anna', name: 'Anna' }, { id: 'you', name: 'You', learner: true }],
  scenes: [
    {
      id: 'u1-cafe', unit: 'u1', title: 'A café', setting: 'You order a coffee.', cefr: 'A1', start: 'l1',
      lines: [
        line('l1', 'l2', { say: 'anna', text: 'Guten Tag! Was möchten Sie?', translation: 'Hello! What would you like?' }),
        line('l2', 'l3', { reply: 'i-hello', help: 'Say hello: Guten Tag.' }),
        line('l3', 'l4', { say: 'anna', text: 'Hier ist die Karte.', translation: 'Here is the menu.' }),
        line('l4', 'l5', { reply: 'i-coffee', help: 'Say: I would like a coffee. Ich möchte...' }),
        line('l5', 'l6', { say: 'anna', text: 'Gern. Möchten Sie auch Wasser?', translation: 'Gladly. Would you like water too?' }),
        line('l6', 'l7', { reply: 'rp-u1-1', help: 'Say yes, please: Ja, ...' }),
        line('l7', 'l8', { say: 'anna', text: 'Das macht drei Euro.', translation: 'That is three euros.' }),
        line('l8', 'l9', { reply: 'i-thanks', help: 'Say thank you: Danke schön.' }),
        line('l9', null, { say: 'anna', text: 'Auf Wiedersehen!', translation: 'Goodbye!' })
      ]
    }
  ],
  newItems: [{ id: 'rp-u1-1', objective: 'u1-o1', kind: 'cloze', taught: true, prompt: 'Say yes, please.', explanation: 'Bitte makes the answer polite.', facts: ['f1'], text: 'Ja, {{g1}}.', gaps: [{ id: 'g1', accepted: ['bitte'] }] }]
})
const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({
  cefr: 'A1',
  items: [
    { id: 'i-hello', kind: 'mcq', taught: true, typed: false, answers: ['Guten Tag!'] },
    { id: 'i-coffee', kind: 'typed', taught: true, typed: true, answers: ['Ich möchte einen Kaffee, bitte.'] },
    { id: 'i-thanks', kind: 'mcq', taught: true, typed: false, answers: ['Danke schön!'] }
  ],
  unit: { id: 'u1', vocabulary: [{ term: 'der Kaffee' }, { term: 'das Wasser' }, { term: 'möchten' }, { term: 'die Suppe' }] },
  sceneCount: [1, 1], itemIdPrefix: 'rp-u1-', factIds: ['f1'], objectives: [{ id: 'u1-o1', unit: 'u1' }],
  ...over
})
const run = (edit: (o: SceneOutput) => void, c: SceneContext = ctx()): string[] => {
  const o = sceneOutputSchema.parse(structuredClone(golden())) as SceneOutput
  edit(o)
  return checkScenes(o, c).map((p) => `${p.ref}: ${p.issue}`)
}
const lineOf = (o: SceneOutput, id: string) => o.scenes[0]!.lines.find((l) => l.id === id)!

describe('checkScenes (the scene-writer answer)', () => {
  it('accepts a good German A1 answer, keeps next: null, and turns it into a valid section with catalog keys', () => {
    const o = sceneOutputSchema.parse(golden()) as SceneOutput
    expect(o.scenes[0]!.lines[8]!.next).toBeNull()
    expect(checkScenes(o, ctx())).toEqual([])
    const s = toRoleplaySection(o)
    expect(roleplaySectionSchema.parse({ speakers: s.speakers, scenes: s.scenes, finale: undefined }).scenes[0]!.lines).toHaveLength(9)
    expect(s.target['rp.sc.u1-cafe.l1']).toBe('Guten Tag! Was möchten Sie?')
    expect(s.source).toMatchObject({ 'rp.sc.u1-cafe.l1.tr': 'Hello! What would you like?', 'rp.sc.u1-cafe.l2.help': 'Say hello: Guten Tag.', 'rp.sp.anna': 'Anna' })
  })

  const BROKEN: [string, (o: SceneOutput) => void, RegExp, Partial<SceneContext>?][] = [
    ['dangling next', (o) => void (lineOf(o, 'l3').next = 'zz'), /l3: it goes on to "zz"/],
    ['unreachable line', (o) => void (lineOf(o, 'l3').next = 'l5'), /l4: this line can never be reached/],
    ['unknown speaker', (o) => void (lineOf(o, 'l1').say = 'nobody'), /l1: it is said by "nobody"/],
    ['unknown item', (o) => void (lineOf(o, 'l2').reply = 'i-nope'), /i-nope", which does not exist/],
    ['no typed reply', () => undefined, /typed reply/, { minTyped: 3 }],
    ['text not German', (o) => void (lineOf(o, 'l3').text = 'Here is the menu and you are good.'), /l3: the text .* is not German/],
    ['reply with no help', (o) => void delete lineOf(o, 'l4').help, /l4: a reply has no help/],
    ['say gives the answer', (o) => void (lineOf(o, 'l3').text = 'Danke schön!'), /l3: .* gives the answer away/],
    ['du and Sie mixed', (o) => void (lineOf(o, 'l5').text = 'Möchtest du auch Wasser?'), /both du and Sie/],
    ['unit vocabulary unused', () => undefined, /use 0 of the unit's 4 vocabulary terms/, { unit: { id: 'u1', vocabulary: ['Suppe', 'Teller', 'Gabel', 'Messer'].map((term) => ({ term })) } }],
    ['verb never used', () => undefined, /none of the unit's verbs/, { unit: { id: 'u1', vocabulary: [], verbs: [{ inf: 'gehen', tense: 'praesens' }] } }]
  ]
  it.each(BROKEN)('reports %s', (_name, edit, expected, over) => {
    expect(run(edit, ctx(over)).join('\n')).toMatch(expected)
  })

  it('accepts a verb unit when a reply uses a form of a unit verb', () => {
    expect(run(() => undefined, ctx({ unit: { id: 'u1', vocabulary: [], verbs: [{ inf: 'möchten', tense: 'praesens' }] } }))).toEqual([])
  })
})
