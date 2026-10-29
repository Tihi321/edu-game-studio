import { z } from 'zod'

/**
 * The puzzle data (format 1), shared by the engine and the renderer. It is what `templates/puzzles/game/python-packages/edu_puzzles` makes
 * and reads (see its README): plain JSON-shaped data, no classes. The puzzle core is kept apart from the flavour (`names`, `text`), which a
 * model may rewrite without touching the logic. A core has a `kind`: `murdle` (a grid of who, with what, where and why), `knights`
 * (Knights and Knaves), `logic` (a Puzzle Baron logic grid with an ordinal category), `testimony` (a cross-examination: press, then present the evidence that proves a statement false),
 * and `quiz` (multiple choice quiz).
 */

export const PUZZLE_FORMAT = 1
export const PUZZLE_KINDS = ['murdle', 'knights', 'testimony', 'logic', 'quiz'] as const
export type PuzzleKind = (typeof PUZZLE_KINDS)[number]
export const PUZZLE_BANDS = ['easy', 'medium', 'hard'] as const

export const LOGIC_PRESETS = {
  bakery: {
    intro: 'The bakery delivered one order each day. Work out which delivery was which.',
    categories: [
      { key: 'day', ref: 'the {n} delivery', names: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], prefix: 'd' },
      { key: 'customer', ref: 'the delivery to {n}', names: ['Ana', 'Boris', 'Cleo', 'Dino', 'Eva'], prefix: 'c' },
      { key: 'cake', ref: 'the {n} delivery', names: ['lemon cake', 'poppy roll', 'plum tart', 'honey bun', 'rye loaf'], prefix: 'k' },
      { key: 'town', ref: 'the delivery to {n}', names: ['Oakville', 'Pinebrook', 'Riverton', 'Stonegate', 'Wheatley'], prefix: 't' }
    ],
    unit: 'days'
  }
} as const

const itemId = z.string().regex(/^[a-z][a-z0-9]*$/, 'an item id such as s1, w2, p3')
const idRe = /^[a-z][a-z0-9_]*$/

export const puzzleClueSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'a clue id such as c1'),
  /** `is`: a and b go together. `not`: they do not. `either`: a goes with b[0] or b[1] (two items of one category). */
  type: z.enum(['is', 'not', 'either']),
  a: itemId,
  b: z.union([itemId, z.tuple([itemId, itemId])]),
  /** Items the prose points at by a trait (`descr`) instead of by name: "the heavy weapon". */
  descr: z.array(itemId).optional()
})
export type PuzzleClue = z.infer<typeof puzzleClueSchema>

/** One step of a deduction (a hint is made from it). Grid steps have a `cell`, Knights and Knaves steps a `who`. */
export const puzzleStepSchema = z
  .object({
    rule: z.string(),
    cell: z.tuple([itemId, itemId]).optional(),
    value: z.string(),
    clue: z.string().optional(),
    from: z.array(z.tuple([itemId, itemId])).optional(),
    who: z.string().optional(),
    statement: z.string().optional()
  })
  .passthrough()
export type PuzzleStep = z.infer<typeof puzzleStepSchema>

export const puzzleDifficultySchema = z.object({ steps: z.number().int(), score: z.number(), rules: z.record(z.string(), z.number()) })
export type PuzzleDifficulty = z.infer<typeof puzzleDifficultySchema>

const difficulty = puzzleDifficultySchema
const common = { format: z.literal(PUZZLE_FORMAT), seed: z.number().int().optional(), band: z.enum(PUZZLE_BANDS).optional(), difficulty, steps: z.array(puzzleStepSchema) }

/** Murdle: a grid of categories (suspect, weapon, place, and perhaps motive); the player accuses. */
export const murdleCoreSchema = z.object({
  ...common,
  kind: z.literal('murdle'),
  size: z.number().int().min(3).max(5),
  categories: z.array(z.object({ key: z.string(), items: z.array(itemId).min(3) })).min(3).max(4),
  /** Item id -> how to point at it by a trait (suspects, weapons and places): the attribute clues use these. */
  descr: z.record(z.string(), z.string()).optional(),
  /** Person -> { weapon, place } (one item of every other category, each used once). */
  solution: z.record(z.string(), z.record(z.string(), itemId)),
  clues: z.array(puzzleClueSchema).min(1),
  murder: z.object({ place: itemId, answer: z.object({ suspect: itemId, weapon: itemId, place: itemId, motive: itemId.optional() }) })
})

/** A claim of a Knights and Knaves statement (the speakers it names are ids `k1`..). */
export type KnightsClaim =
  | { type: 'knight' | 'knave'; who: string }
  | { type: 'same' | 'diff'; a: string; b: string }
  | { type: 'some_knave' | 'all_knight'; of: string[] }
  | { type: 'exactly'; k: number; of: string[] }
  | { type: 'not'; c: KnightsClaim }
  | { type: 'and' | 'or'; a: KnightsClaim; b: KnightsClaim }
const speakerId = z.string().regex(/^k\d+$/, 'a speaker id such as k1')
export const knightsClaimSchema: z.ZodType<KnightsClaim> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(['knight', 'knave']), who: speakerId }),
    z.object({ type: z.enum(['same', 'diff']), a: speakerId, b: speakerId }),
    z.object({ type: z.enum(['some_knave', 'all_knight']), of: z.array(speakerId).min(1) }),
    z.object({ type: z.literal('exactly'), k: z.number().int().min(0), of: z.array(speakerId).min(1) }),
    z.object({ type: z.literal('not'), c: knightsClaimSchema }),
    z.object({ type: z.enum(['and', 'or']), a: knightsClaimSchema, b: knightsClaimSchema })
  ])
)

/** Knights and Knaves: knights always tell the truth, knaves always lie; each statement is a claim about the speakers. */
export const knightsCoreSchema = z.object({
  ...common,
  kind: z.literal('knights'),
  size: z.number().int().min(2).max(5),
  speakers: z.array(speakerId).min(2).max(5),
  statements: z.array(z.object({ id: z.string().regex(/^t\d+$/, 'a statement id such as t1'), speaker: speakerId, claim: knightsClaimSchema })).min(1),
  solution: z.record(z.string(), z.enum(['knight', 'knave']))
})

const factPair = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a key such as clock'), value: z.string().min(1) })

/**
 * Testimony: a witness makes statements, the player may press one for more and must present the one piece of evidence that clashes with a
 * statement. A claim (what a statement says) and a fact (what evidence shows) clash when they are about the same key with different values.
 */
export const testimonyCoreSchema = z.object({
  ...common,
  kind: z.literal('testimony'),
  size: z.number().int().min(2).max(10),
  witness: z.literal('wit'),
  /** The vocabulary: a key, the values it can have, and the English templates ({v} is the value) of the default prose. */
  keys: z
    .array(z.object({ key: factPair.shape.key, label: z.string().optional(), values: z.array(z.string().min(1)).min(2), item: z.string().optional(), claim: z.string().optional(), fact: z.string().optional() }))
    .min(1),
  statements: z
    .array(z.object({ id: z.string().regex(/^t\d+$/, 'a statement id such as t1'), claims: z.array(factPair).min(1), press: z.object({ claims: z.array(factPair).min(1) }).optional() }))
    .min(2),
  evidence: z.array(z.object({ id: z.string().regex(/^e\d+$/, 'an evidence id such as e1'), facts: z.array(factPair).min(1) })).min(1),
  /** The statement to contradict, the evidence that does it, and whether the statement must be pressed first. */
  solution: z.object({ statement: z.string(), evidence: z.string(), press: z.boolean().optional() })
})

/** A clue of a logic grid: the Murdle types, and neither, one of (two with two) and the order types (`n` for apart: exactly n places). */
export const logicClueSchema = z.object({
  id: z.string().regex(/^c\d+$/, 'a clue id such as c1'),
  type: z.enum(['is', 'not', 'either', 'neither', 'oneof', 'before', 'after', 'apart']),
  a: z.union([itemId, z.tuple([itemId, itemId])]),
  b: z.union([itemId, z.tuple([itemId, itemId])]),
  n: z.number().int().min(1).optional()
})
export type LogicClue = z.infer<typeof logicClueSchema>

/**
 * A logic grid (Puzzle Baron): categories of equal size, the first of them ordinal (days, ages: the items have an order), clues about what goes
 * with what and about order. The player fills in the grid; there is no accusation.
 */
export const logicCoreSchema = z.object({
  ...common,
  kind: z.literal('logic'),
  size: z.number().int().min(3).max(5),
  /** `ref` says how a clue refers to an item of the category ("the {n} delivery", {n} being the item's name). */
  categories: z.array(z.object({ key: z.string(), items: z.array(itemId).min(3), ref: z.string().optional() })).min(3).max(5),
  /** The category whose items have an order, and the unit of "exactly n apart". */
  ordinal: z.object({ category: z.string(), unit: z.string().optional() }),
  hardTrans: z.number().int().optional(),
  solution: z.record(z.string(), z.record(z.string(), itemId)),
  clues: z.array(logicClueSchema).min(1)
})

export const quizQuestionSchema = z.object({
  id: z.string().regex(idRe),
  options: z.array(z.string().regex(idRe)).min(2).max(6),
  answer: z.string().regex(idRe)
}).superRefine((q, ctx) => {
  if (!q.options.includes(q.answer)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: `answer "${q.answer}" is not in options` })
  }
})
export type QuizQuestion = z.infer<typeof quizQuestionSchema>

export const quizCoreSchema = z.object({
  format: z.literal(PUZZLE_FORMAT).optional(),
  band: z.enum(PUZZLE_BANDS).optional(),
  steps: z.array(puzzleStepSchema).optional(),
  kind: z.literal('quiz'),
  seed: z.number().int(),
  questions: z.array(quizQuestionSchema).min(1).max(10),
  solution: z.record(z.string(), z.string()),
  difficulty: puzzleDifficultySchema
}).superRefine((d, ctx) => {
  const qIds = new Set<string>()
  for (const q of d.questions) {
    if (qIds.has(q.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questions'], message: `duplicate question id "${q.id}"` })
    qIds.add(q.id)
    if (d.solution[q.id] !== q.answer) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['solution', q.id], message: `solution["${q.id}"] must match question answer "${q.answer}"` })
    }
  }
})
export type QuizCore = z.infer<typeof quizCoreSchema>

export const puzzleCoreSchema = z.discriminatedUnion('kind', [
  murdleCoreSchema,
  knightsCoreSchema,
  testimonyCoreSchema,
  logicCoreSchema,
  quizCoreSchema
])
export type PuzzleCore = z.infer<typeof puzzleCoreSchema>
export type MurdleCore = z.infer<typeof murdleCoreSchema>
export type KnightsCore = z.infer<typeof knightsCoreSchema>
export type TestimonyCore = z.infer<typeof testimonyCoreSchema>
export type LogicCore = z.infer<typeof logicCoreSchema>

/** Every id of a core that needs a name: the items of a grid, the speakers of Knights and Knaves, the witness and the evidence of a testimony, or all options of a quiz. */
export const puzzleEntityIds = (core: PuzzleCore): string[] =>
  core.kind === 'knights'
    ? core.speakers
    : core.kind === 'testimony'
      ? [core.witness, ...core.evidence.map((e) => e.id)]
      : core.kind === 'quiz'
        ? core.questions.flatMap((q) => q.options)
        : core.categories.flatMap((c) => c.items)

/** Every id of a core that needs prose: the clues and the murder note, the statements and the intro, or a testimony's statements (and what a pressed one adds), evidence and intro. */
export const puzzleTextIds = (core: PuzzleCore): string[] =>
  core.kind === 'knights'
    ? [...core.statements.map((s) => s.id), 'intro']
    : core.kind === 'testimony'
      ? [...core.statements.flatMap((s) => (s.press ? [s.id, `${s.id}.press`] : [s.id])), ...core.evidence.map((e) => e.id), 'intro']
      : core.kind === 'logic'
        ? [...core.clues.map((c) => c.id), 'intro']
        : core.kind === 'quiz'
          ? ['intro', ...core.questions.map((q) => q.id)]
          : [...core.clues.map((c) => c.id), 'murder']

/** The ids of the things the player finds in the story (`clueAt`): a grid puzzle's clues, and a testimony's evidence (the statements of Knights and Knaves and of a testimony are all there from the start). */
export const puzzleFindableIds = (core: PuzzleCore): string[] =>
  core.kind === 'murdle' || core.kind === 'logic'
    ? core.clues.map((c) => c.id)
    : core.kind === 'testimony'
      ? core.evidence.map((e) => e.id)
      : []

/** What the puzzle engine returns: the core plus the canonical English flavour. */
export const puzzleGeneratedSchema = z.intersection(
  puzzleCoreSchema,
  z.object({
    names: z.record(z.string(), z.string()),
    /** Clue (or statement) id, and `murder` or `intro` -> sentence. */
    text: z.record(z.string(), z.string())
  })
)
export type PuzzleGenerated = z.infer<typeof puzzleGeneratedSchema>

/** What `solve` proves. */
export const puzzleProofSchema = z.object({
  unique: z.boolean(),
  solutions: z.number().int(),
  deducible: z.boolean(),
  band: z.enum(PUZZLE_BANDS).nullable(),
  score: z.number(),
  steps: z.array(puzzleStepSchema),
  rules: z.record(z.string(), z.number())
})
export type PuzzleProof = z.infer<typeof puzzleProofSchema>

/** A puzzle of a book: the core and its flavour. */
export const puzzleEntrySchema = z.object({
  /** Lowercase key (`dinner`): a puzzle beat names it. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores, starting with a letter'),
  kind: z.enum(PUZZLE_KINDS),
  data: puzzleCoreSchema,
  /** Item (or speaker) id -> name shown in the puzzle (`s1`: Colonel Ash). */
  names: z.record(z.string(), z.string()),
  /** Clue (or statement) id -> the prose, and `murder` -> the murder note or `intro` -> the introduction. */
  text: z.record(z.string(), z.string()),
  /** Item id -> what it is in the story: a suspect is a character, a place a place, a weapon an image (an insert). A name then follows a renamed character. */
  links: z.record(z.string(), z.object({ type: z.enum(['character', 'place', 'image']), key: z.string() })).optional(),
  /** Clue id -> the beat that shows it (`CLUE:`): the puzzle lists only the clues found by then (clues with no entry are always listed). */
  clueAt: z.record(z.string(), z.string()).optional(),
  /** What a wrong answer does. Missing: retry as often as the player wants, a hint after 2 wrong accusations. */
  onFail: z.object({ mode: z.enum(['retry', 'continue', 'chapter']), to: z.number().int().positive().optional(), maxTries: z.number().int().positive().optional() }).optional(),
  /** False: no hint button and no offer. Missing: hints on. */
  hints: z.boolean().optional(),
  /** What the code proved when the puzzle was set. `textChecked`: the prose was read back and means the same constraints. */
  verified: z.object({ unique: z.boolean(), deducible: z.boolean(), score: z.number(), textChecked: z.boolean(), by: z.string() })
})
export type PuzzleEntry = z.infer<typeof puzzleEntrySchema>

/** The words of a puzzle in one edition: names and clue texts. */
export const editionPuzzleSchema = z.object({
  names: z.record(z.string(), z.string()),
  text: z.record(z.string(), z.string())
})
export type EditionPuzzle = z.infer<typeof editionPuzzleSchema>

/**
 * The read-back of a puzzle's prose: what a reader (who never saw the structured data) understood from the words alone. A grid clue is
 * `{id, type, a, b}`; a Knights and Knaves statement is `{id, speaker, claim}` (and its intro `{id: 'intro', truthTellers, liars}`); both use the names of the puzzle.
 */
export const readBackClueSchema = z.union([
  z.object({
    id: z.string(),
    type: z.enum(['is', 'not', 'either', 'neither', 'oneof', 'before', 'after', 'apart']),
    a: z.union([z.string(), z.array(z.string()).length(2)]),
    b: z.union([z.string(), z.array(z.string()).length(2)]),
    n: z.number().int().optional()
  }),
  z.object({ id: z.string(), speaker: z.string(), claim: z.record(z.string(), z.unknown()) }),
  /** Knights and Knaves intro: the rule it states, in its own words (who always tells the truth, who always lies). */
  z.object({ id: z.string(), truthTellers: z.string(), liars: z.string() }),
  /** Testimony: the claims of a statement (`t1`, `t1.press`) or the facts of a piece of evidence (`e1`). */
  z.object({ id: z.string(), claims: z.array(z.object({ key: z.string(), value: z.string() })).optional(), facts: z.array(z.object({ key: z.string(), value: z.string() })).optional() }).refine((x) => x.claims !== undefined || x.facts !== undefined, 'testimony entry needs claims or facts'),
  /** Quiz: question prompt, options and the correct answer. */
  z.object({ id: z.string(), prompt: z.string().optional(), options: z.array(z.string()).optional(), answer: z.string().optional() }).passthrough()
])
export type ReadBackClue = z.infer<typeof readBackClueSchema>
