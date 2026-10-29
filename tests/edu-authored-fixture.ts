import type { AuthoredItem, Article, Curriculum, DesignData, Frame } from '../src/engine/edu/authoring'
import type { FactPack } from '../src/engine/edu/factbase'
import type { Fact, SourceEntry } from '../src/engine/edu/factbase'
import type { AssembleInput } from '../src/engine/edu/assemble'

/**
 * What the content roles write for a tiny two-unit course, as the pipeline would hand it to `assembleCourse`: the fact base, the curriculum,
 * the articles and the items (after the misconception-designer: every wrong option has its why). Every objective is asked in two forms.
 */

export const FACTS: Fact[] = [
  { id: 'f1', fact: 'The Western Roman Empire ended in the year 476.', sources: [1], note: 'n1' },
  { id: 'f2', fact: 'Odoacer removed the last western emperor, Romulus Augustulus.', sources: [1, 2], note: 'n1' },
  { id: 'f3', fact: 'The Roman Senate met in a building called the Curia.', sources: [3], note: 'n2' },
  { id: 'f4', fact: 'The Roman Republic was led by two consuls who were elected each year.', sources: [3], note: 'n2' },
  { id: 'f5', fact: 'Augustus became the first Roman emperor in 27 BC.', sources: [4], note: 'n3' },
  { id: 'f6', fact: 'The Colosseum opened in the year 80 AD.', sources: [5], note: 'n3' }
]

export const SOURCES: SourceEntry[] = [
  { n: 1, url: 'https://example.org/476', title: 'The end of the western empire', retrieved: '2026-10-20' },
  { n: 2, url: 'https://example.org/odoacer', title: '', retrieved: '2026-10-20' },
  { n: 3, url: 'https://example.org/republic', title: 'The Roman Republic', retrieved: '2026-10-20' },
  { n: 4, url: 'https://example.org/augustus', title: 'Augustus', retrieved: '2026-10-20' },
  { n: 5, url: 'https://example.org/colosseum', title: 'The Colosseum', retrieved: '2026-10-20' }
]

export const FACT_PACK: FactPack = {
  factbase: FACTS.map((f) => {
    const s = SOURCES.find((x) => x.n === f.sources[0])!
    return { id: f.id, claim: `fact.${f.id}.claim`, source: s.title || 'example.org', url: s.url }
  }),
  strings: Object.fromEntries(FACTS.map((f) => [`fact.${f.id}.claim`, f.fact]))
}

export const CURRICULUM: Curriculum = {
  units: [
    { id: 'u1', title: 'The fall of Rome', summary: 'How the western empire ended.', requires: [] },
    { id: 'u2', title: 'Rome at its height', summary: 'The republic, the first emperor and the Colosseum.', requires: ['u1'] }
  ],
  objectives: [
    { id: 'u1-o1', unit: 'u1', bloom: 'remember', text: 'Say when the Western Roman Empire ended and who ended it.', facts: ['f1', 'f2'] },
    { id: 'u1-o2', unit: 'u1', bloom: 'remember', text: 'Name the building where the Senate met.', facts: ['f3'] },
    { id: 'u2-o1', unit: 'u2', bloom: 'understand', text: 'Explain how the Republic and the empire were led.', facts: ['f4', 'f5'] },
    { id: 'u2-o2', unit: 'u2', bloom: 'remember', text: 'Place the Colosseum in time.', facts: ['f6', 'f5'] }
  ]
}

export const ARTICLES: Article[] = [
  {
    id: 'a-fall',
    unit: 'u1',
    title: 'The end of the western empire',
    body: 'The Western Roman Empire ended in the year 476 [f1]. In that year a soldier called Odoacer removed the last western emperor, a boy named Romulus Augustulus [f2].\n\nThe Senate in Rome kept meeting in its own building, the Curia [f3], long after the emperors had left the city.',
    related: ['a-rome']
  },
  {
    id: 'a-rome',
    unit: 'u2',
    title: 'Republic, empire and arena',
    body: 'Before the emperors, Rome was a republic led by two consuls, who were elected each year [f4]. That changed when Augustus became the first emperor in 27 BC [f5].\n\nA century later the Colosseum opened in the year 80 AD [f6], a huge arena for games that the whole city could watch.',
    related: ['a-fall']
  }
]

const ex = (ex: string): { explanation: string } => ({ explanation: ex })

export const ITEMS: AuthoredItem[] = [
  {
    id: 'q1',
    kind: 'mcq',
    objective: 'u1-o1',
    prompt: 'In which year did the Western Roman Empire end?',
    options: [
      { id: 'a', text: '476' },
      { id: 'b', text: '410', why: 'In 410 the Visigoths sacked Rome, but the empire went on for decades.' },
      { id: 'c', text: '1453', why: '1453 is the end of the Eastern Roman Empire, not the Western one.' },
      { id: 'd', text: '27 BC', why: '27 BC is when the empire began under Augustus, not when it ended.' }
    ],
    answer: 'a',
    ...ex('The western empire ended in 476.'),
    facts: ['f1'],
    difficulty: 2,
    hint: 'It was in the fifth century.'
  },
  { id: 'q2', kind: 'true-false', objective: 'u1-o1', prompt: 'Odoacer removed the last western emperor.', answer: true, why: 'Some learners think the empire fell in one great battle, but it ended when Odoacer removed the emperor.', ...ex('Odoacer removed Romulus Augustulus, the last western emperor.'), facts: ['f2'], difficulty: 1 },
  { id: 'q3', kind: 'typed', objective: 'u1-o1', prompt: 'Type the year in which the Western Roman Empire ended.', accepted: ['476'], ...ex('The year was 476.'), facts: ['f1'], difficulty: 3 },
  {
    id: 'q4',
    kind: 'cloze',
    objective: 'u1-o2',
    prompt: 'Fill the gap.',
    text: 'The Roman Senate met in the {{g1}}.',
    gaps: [{ id: 'g1', accepted: ['Curia', 'the Curia'], bank: ['Curia', 'Forum', 'Colosseum'] }],
    ...ex('The Senate met in a building called the Curia.'),
    facts: ['f3'],
    difficulty: 2,
    didYouKnow: 'The Curia was rebuilt many times, but a Curia still stands in Rome today.',
    didYouKnowFact: 'f3'
  },
  { id: 'q5', kind: 'flashcard', objective: 'u1-o2', prompt: 'The Curia', back: 'The building where the Roman Senate met.', ...ex('The Senate met in the Curia.'), facts: ['f3'], difficulty: 1 },
  {
    id: 'q6',
    kind: 'match-pairs',
    objective: 'u2-o1',
    prompt: 'Match each leader to the time he led.',
    pairs: [
      { id: 'p1', left: 'Consul', right: 'The Republic' },
      { id: 'p2', left: 'Augustus', right: 'The empire' }
    ],
    ...ex('Two consuls led the Republic; Augustus was the first emperor.'),
    facts: ['f4', 'f5'],
    difficulty: 2
  },
  {
    id: 'q7',
    kind: 'order',
    objective: 'u2-o1',
    prompt: 'Put these in the order they happened.',
    items: [
      { id: 's1', text: 'Augustus becomes emperor', when: '27 BC' },
      { id: 's2', text: 'The Colosseum opens', when: '80 AD' },
      { id: 's3', text: 'The western empire ends', when: '476' }
    ],
    timeline: true,
    ...ex('Augustus came first, then the Colosseum, and the western empire ended last.'),
    facts: ['f1', 'f5', 'f6'],
    difficulty: 4
  },
  {
    id: 'q8',
    kind: 'sort-groups',
    objective: 'u2-o2',
    prompt: 'Sort the events into the right group.',
    groups: [
      { id: 'g1', title: 'Before the Colosseum opened' },
      { id: 'g2', title: 'After the Colosseum opened' }
    ],
    items: [
      { id: 'e1', text: 'Augustus becomes emperor', group: 'g1' },
      { id: 'e2', text: 'The western empire ends', group: 'g2', why: 'The western empire ended in 476, after 80 AD.' }
    ],
    ...ex('The Colosseum opened in 80 AD, after Augustus and before the end of the western empire.'),
    facts: ['f6', 'f5', 'f1'],
    difficulty: 3
  },
  {
    id: 'q9',
    kind: 'multi-select',
    objective: 'u2-o2',
    prompt: 'Which of these happened before the Colosseum opened?',
    options: [
      { id: 'a', text: 'Augustus became emperor' },
      { id: 'b', text: 'The Republic had two consuls' },
      { id: 'c', text: 'The western empire ended', why: 'The western empire ended in 476, long after the Colosseum opened in 80 AD.' }
    ],
    answers: ['a', 'b'],
    ...ex('Augustus and the consuls came before the Colosseum.'),
    facts: ['f6', 'f5', 'f4'],
    difficulty: 4
  }
]

export const DESIGN: DesignData = { enabled: ['quiz-arena'], requested: ['rpg'], quizArena: { roundLength: 5, bossLength: 6, timerSeconds: 30 }, difficulty: { q3: 3 }, notes: 'Short rounds for teenagers.' }

export const FRAME: Frame = {
  premise: 'You are a young scribe who must carry a message across the empire.',
  characters: [{ name: 'Livia', role: 'the guide', description: 'An old scribe who knows every road and likes riddles.' }],
  intro: 'Livia hands you a scroll and a map. The road to Rome is long.',
  outro: 'You reach Rome and deliver the scroll. Livia smiles: you know the empire now.',
  unitBeats: [
    { unit: 'u1', beat: 'You reach the old city and learn how the western empire ended.' },
    { unit: 'u2', beat: 'In Rome you see the Colosseum and meet the stories of the republic.' }
  ]
}

/** The draft of the items before the designer (no wrong option has its why). */
export const draftItems = (items: AuthoredItem[] = ITEMS): AuthoredItem[] =>
  items.map((it) => {
    if (it.kind === 'mcq' || it.kind === 'multi-select') return { ...it, options: it.options.map(({ id, text }) => ({ id, text })) }
    if (it.kind === 'true-false') {
      const { why: _why, ...rest } = it
      return rest
    }
    return it
  })

export const assembleInput = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  slug: 'roman-basics',
  title: 'Roman Basics',
  subject: 'Ancient Rome',
  audience: 'Teenagers',
  sourceLang: 'en',
  run: 1,
  brief: { topic: 'Ancient Rome', audience: 'Teenagers' },
  factbase: FACT_PACK,
  curriculum: CURRICULUM,
  articles: ARTICLES,
  items: ITEMS,
  design: DESIGN,
  story: FRAME,
  ...over
})
