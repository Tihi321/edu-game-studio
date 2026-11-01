import { z } from 'zod'
import { langSchema } from './media'

/**
 * The course contract every game shell reads (EGS-02).
 *
 *  - `course/pack.json` (`CoursePack`) is the language-neutral template: ids, objectives, the prerequisite graph, items with answer
 *    keys, shells, assets, cues, encyclopedia and fact base. Every visible string in it is a KEY into the text catalog.
 *  - `course/text/<lang>.json` (`TextCatalog`) is the only translatable document: `strings` (key -> text) and `accepted` (key -> the
 *    accepted spellings of a typed answer, first entry = canonical). Book Translator translates it like the VN pack.
 *  - Answer keys are language-neutral (option ids, indexes, numbers, group ids, hotspot ids, pair ids, order as id arrays). Only text
 *    answers (typed, cloze gaps, listening-typed, crossword and word-search words) point to catalog keys whose accepted strings live
 *    per language.
 *
 * Extending without breaking:
 *  - the pack is versioned (`schema: 1`) and strict: a new core field means a new schema number;
 *  - shell-specific settings live in `shells.config[shellId]` (any shell id is accepted: encyclopedia, mindmaze, rpg, roleplay ...);
 *  - later features (speaking items, teacher mode, multiplayer) go in `extensions` (pack level) or `extensions` (item level);
 *  - the item kinds below are a zod discriminated union for the built-ins, and `ITEM_KINDS` / `registerItemKind` (`edu/registry.ts`)
 *    is the runtime registry the validator, the checkers and the shells go through, so a new kind registers without touching them.
 *    The pack schema therefore only checks the common item fields; each item is then parsed by its kind's schema (`validateCourse`).
 *
 * This file is pure (no DOM, no node): the browser player bundles it.
 */

export const COURSE_SCHEMA_VERSION = 1

/** An id of a unit, objective, item, asset, option ... letters, digits, `-` and `_`. */
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'an id: letters, digits, - and _')
/** A key into the text catalog, such as `u1.q3.prompt`. */
export const keySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, 'a text key: letters, digits, . : - and _')
export type CourseId = z.infer<typeof idSchema>
export type TextKey = z.infer<typeof keySchema>

export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export const DIACRITICS_POLICIES = ['ignore', 'warn', 'strict'] as const

// ---- text catalog ----

export const textCatalogSchema = z.strictObject({
  schema: z.literal(1).default(1),
  lang: langSchema,
  /** key -> the text shown to the learner. */
  strings: z.record(keySchema, z.string()),
  /** key -> accepted answers of a typed gap/word, first entry = the canonical answer (also what the game shows as "the answer"). */
  accepted: z.record(keySchema, z.array(z.string().min(1)).min(1)).optional()
})
export type TextCatalog = z.infer<typeof textCatalogSchema>

// ---- items ----

export const itemKindsBuiltin = [
  'mcq',
  'true-false',
  'multi-select',
  'cloze',
  'typed',
  'match-pairs',
  'order',
  'sort-groups',
  'hotspot',
  'listening',
  'flashcard',
  'crossword',
  'word-search',
  'conjugation'
] as const
export type BuiltinKind = (typeof itemKindsBuiltin)[number]

/** The fields every item has, whatever its kind. */
export const itemBaseShape = {
  id: idSchema,
  objective: idSchema,
  /** The question or instruction. */
  prompt: keySchema,
  /** Shown after the answer, right or wrong. */
  explanation: keySchema,
  /** A curiosity hook shown after a right answer. */
  didYouKnow: keySchema.optional(),
  hint: keySchema.optional(),
  /** An image (or, for listening, the audio) that goes with the item. */
  asset: idSchema.optional(),
  difficulty: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string()).default([]),
  /** Room for later features (speaking, teacher mode ...). */
  extensions: z.record(z.string(), z.unknown()).optional()
}

const optionSchema = z.strictObject({
  id: idSchema,
  text: keySchema,
  /** Why this option is wrong: the misconception it stands for. Required for every distractor (`MISSING_WHY`). */
  why: keySchema.optional()
})
export type ChoiceOption = z.infer<typeof optionSchema>

export const mcqSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('mcq'),
  options: z.array(optionSchema).min(2).max(8),
  /** The id of the right option. */
  answer: idSchema,
  shuffle: z.boolean().default(true)
})

export const trueFalseSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('true-false'),
  /** The prompt is the statement. */
  answer: z.boolean(),
  /** The misconception behind the wrong choice. */
  why: keySchema.optional()
})

export const multiSelectSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('multi-select'),
  options: z.array(optionSchema).min(2).max(10),
  /** The ids of every right option. */
  answers: z.array(idSchema).min(1),
  shuffle: z.boolean().default(true)
})

export const clozeSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('cloze'),
  /** The sentence with a `{{gapId}}` marker for each gap. */
  text: keySchema,
  gaps: z
    .array(
      z.strictObject({
        id: idSchema,
        /** A catalog key with an `accepted` list per language. */
        answer: keySchema,
        /** A word bank: catalog keys (the answer included). Without it the gap is typed. */
        bank: z.array(keySchema).optional()
      })
    )
    .min(1),
  /** true: a missing accent is wrong; false: it is ignored; missing: the course default (`matching.diacritics`). */
  strictDiacritics: z.boolean().optional()
})

/** A verb table drill (EGS-27): the infinitive and its forms per person in one tense, each form typed on its own. */
export const conjugationSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('conjugation'),
  /** The infinitive shown as the heading ("gehen"): a catalog key, in the target-language catalog when the item is taught. */
  verb: keySchema,
  /** Metadata: praesens, perfekt, praeteritum, futur1, imperativ, konjunktiv2 (a free id for other languages). */
  tense: idSchema,
  forms: z
    .array(
      z.strictObject({
        /** ich, du, er, wir, ihr, sie, Sie for German; any id for other languages. */
        person: idSchema,
        /** The pronoun shown beside the input ("er / sie / es"). */
        label: keySchema,
        /** A catalog key with an accepted list per language, first = canonical, WITHOUT the pronoun. */
        answer: keySchema,
        /** Shown filled in, not asked. */
        given: z.boolean().default(false)
      })
    )
    .min(2)
    .max(7),
  /** How many of the asked forms one presentation asks (a drill); missing = all. */
  ask: z.number().int().min(1).optional(),
  strictDiacritics: z.boolean().optional()
})

export const typedSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('typed'),
  /** A catalog key with an `accepted` list per language (synonyms included). */
  answer: keySchema,
  strictDiacritics: z.boolean().optional()
})

export const matchPairsSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('match-pairs'),
  pairs: z.array(z.strictObject({ id: idSchema, left: keySchema, right: keySchema })).min(2).max(8)
})

export const orderSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('order'),
  /** In the CORRECT order; the player shuffles them. */
  items: z.array(z.strictObject({ id: idSchema, text: keySchema, /** A date or label shown after solving (timeline). */ when: keySchema.optional() })).min(2).max(10),
  timeline: z.boolean().default(false)
})

export const sortGroupsSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('sort-groups'),
  groups: z.array(z.strictObject({ id: idSchema, title: keySchema })).min(2).max(5),
  items: z
    .array(z.strictObject({ id: idSchema, text: keySchema, /** The id of the group it belongs to. */ group: idSchema, /** Why it belongs there. */ why: keySchema.optional() }))
    .min(2)
    .max(12)
})

const regionShapeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('circle'), cx: z.number(), cy: z.number(), r: z.number().positive() }),
  z.strictObject({ type: z.literal('rect'), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.strictObject({ type: z.literal('poly'), points: z.array(z.tuple([z.number(), z.number()])).min(3) })
])
export type RegionShape = z.infer<typeof regionShapeSchema>

export const hotspotSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('hotspot'),
  /** The image (a map or a labelled picture). Required here. */
  asset: idSchema,
  /** The size of the image: region coordinates are in image pixels. */
  width: z.number().positive(),
  height: z.number().positive(),
  regions: z
    .array(z.strictObject({ id: idSchema, label: keySchema, shape: regionShapeSchema, why: keySchema.optional() }))
    .min(2),
  /** The id of the right region. */
  answer: idSchema
})

export const listeningSchema = z
  .strictObject({
    ...itemBaseShape,
    kind: z.literal('listening'),
    /** The audio clip. Required here. */
    asset: idSchema,
    /** What the clip says (the text a speech engine reads), shown after the answer. */
    transcript: keySchema,
    mode: z.enum(['choose', 'type']),
    /** `choose`: the options. */
    options: z.array(optionSchema).min(2).max(8).optional(),
    /** `choose`: the id of the right option; `type`: the catalog key of the accepted answers. */
    answer: z.string().min(1),
    shuffle: z.boolean().default(true),
    strictDiacritics: z.boolean().optional()
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'choose' && !v.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'a choose listening item needs options' })
    if (v.mode === 'type' && v.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'a type listening item has no options' })
  })

export const flashcardSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('flashcard'),
  /** The prompt is the front; the back is shown on flip and the learner grades themselves. */
  back: keySchema,
  backAsset: idSchema.optional()
})

export const crosswordSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('crossword'),
  /** The grid is built from these words by code (`generateCrossword`), per language, from `seed`. */
  words: z.array(z.strictObject({ id: idSchema, /** A catalog key with an `accepted` list. */ answer: keySchema, clue: keySchema })).min(3).max(20),
  seed: z.number().int(),
  maxSize: z.number().int().min(5).max(30).default(15)
})

export const wordSearchSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('word-search'),
  words: z.array(z.strictObject({ id: idSchema, answer: keySchema })).min(2).max(20),
  seed: z.number().int(),
  /** The grid side; missing: chosen from the words. */
  size: z.number().int().min(5).max(30).optional(),
  /** forward: right and down; diagonal: also the two forward diagonals; all: every direction, backwards too. */
  directions: z.enum(['forward', 'diagonal', 'all']).default('diagonal')
})

export const builtinItemSchema = z.discriminatedUnion('kind', [
  mcqSchema,
  trueFalseSchema,
  multiSelectSchema,
  clozeSchema,
  typedSchema,
  matchPairsSchema,
  orderSchema,
  sortGroupsSchema,
  hotspotSchema,
  listeningSchema,
  flashcardSchema,
  crosswordSchema,
  wordSearchSchema,
  conjugationSchema
])

export type McqItem = z.infer<typeof mcqSchema>
export type TrueFalseItem = z.infer<typeof trueFalseSchema>
export type MultiSelectItem = z.infer<typeof multiSelectSchema>
export type ClozeItem = z.infer<typeof clozeSchema>
export type TypedItem = z.infer<typeof typedSchema>
export type MatchPairsItem = z.infer<typeof matchPairsSchema>
export type OrderItem = z.infer<typeof orderSchema>
export type SortGroupsItem = z.infer<typeof sortGroupsSchema>
export type HotspotItem = z.infer<typeof hotspotSchema>
export type ListeningItem = z.infer<typeof listeningSchema>
export type FlashcardItem = z.infer<typeof flashcardSchema>
export type CrosswordItem = z.infer<typeof crosswordSchema>
export type ConjugationItem = z.infer<typeof conjugationSchema>
export type WordSearchItem = z.infer<typeof wordSearchSchema>
/** An item of one of the built-in kinds, narrowed by `kind`. */
export type BuiltinItem = z.infer<typeof builtinItemSchema>

/**
 * What the pack schema knows about every item: the common fields and a `kind` string. The kind's own schema (the built-in union or a
 * registered one) checks the rest, so a pack with a later kind still parses. Narrow with `isBuiltinItem`.
 */
export const courseItemSchema = z.looseObject({ ...itemBaseShape, kind: z.string().min(1) })
export type CourseItem = z.infer<typeof courseItemSchema>

export const isBuiltinItem = (item: CourseItem): item is BuiltinItem & CourseItem => (itemKindsBuiltin as readonly string[]).includes(item.kind)

// ---- the pack ----

export const unitSchema = z.strictObject({
  id: idSchema,
  title: keySchema,
  summary: keySchema.optional(),
  /** Prerequisite units: the graph is `requires`. A unit unlocks when every unit it requires is mastered. */
  requires: z.array(idSchema).default([])
})

export const objectiveSchema = z.strictObject({
  id: idSchema,
  unit: idSchema,
  bloom: z.enum(BLOOM_LEVELS),
  text: keySchema,
  /** Fact base ids the objective rests on. */
  facts: z.array(idSchema).default([])
})

export const assetSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['image', 'audio']),
  /** A path relative to `course/`, such as `assets/solar-system.svg`. */
  file: z.string().min(1),
  /** Alt text (an image) or a description (audio): a catalog key. */
  alt: keySchema
})

export const cueSchema = z.strictObject({
  id: idSchema,
  /** The game event: `correct`, `wrong`, `unit-complete`, `boss` ... (shells define their own). */
  on: z.string().min(1),
  asset: idSchema,
  loop: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(1)
})

export const articleSchema = z.strictObject({
  id: idSchema,
  title: keySchema,
  body: keySchema,
  /** Fact base ids the article cites. */
  citations: z.array(idSchema).default([]),
  asset: idSchema.optional(),
  /** Other articles it links to. */
  related: z.array(idSchema).default([]),
  /** The unit the article belongs to, if any. */
  unit: idSchema.optional()
})

export const factSchema = z.strictObject({
  id: idSchema,
  /** The claim in one sentence (a catalog key), so the fact-checker can compare an item to it. */
  claim: keySchema.optional(),
  source: z.string().min(1),
  url: z.url().optional()
})

export const coursePackSchema = z.strictObject({
  schema: z.literal(COURSE_SCHEMA_VERSION),
  id: idSchema,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a slug: lower-case letters, digits and -'),
  /** The language the course was written in. */
  sourceLang: langSchema,
  /** The editions (UI languages). The source language is one of them. */
  languages: z.array(langSchema).min(1),
  /** A language course: the language that is taught. Its catalog (`text/<lang>.json`) holds the target-language phrases and their accepted answers; the editions hold the rest. */
  targetLang: langSchema.optional(),
  subject: z.string().min(1),
  audience: z.string().min(1),
  cefr: z.enum(CEFR_LEVELS).optional(),
  /** How typed answers are matched, course-wide (an item can override the accent policy with `strictDiacritics`). */
  matching: z
    .strictObject({
      diacritics: z.enum(DIACRITICS_POLICIES).default('ignore'),
      typos: z.boolean().default(true)
    })
    .default({ diacritics: 'ignore', typos: true }),
  units: z.array(unitSchema).min(1),
  objectives: z.array(objectiveSchema).min(1),
  items: z.array(courseItemSchema),
  shells: z
    .strictObject({
      enabled: z.array(z.string().min(1)).default(['quiz-arena']),
      /** Settings per shell id. Any shell id is accepted, so later shells extend the pack without changing the schema. */
      config: z.record(z.string(), z.record(z.string(), z.unknown())).default({})
    })
    .default({ enabled: ['quiz-arena'], config: {} }),
  assets: z.array(assetSchema).default([]),
  cues: z.array(cueSchema).default([]),
  encyclopedia: z.strictObject({ articles: z.array(articleSchema).default([]) }).default({ articles: [] }),
  factbase: z.array(factSchema).default([]),
  /** Room for later features (speaking items, teacher mode, multiplayer). Never read by the core. */
  extensions: z.record(z.string(), z.unknown()).default({})
})
export type CoursePack = z.infer<typeof coursePackSchema>
export type CourseUnit = z.infer<typeof unitSchema>
export type CourseObjective = z.infer<typeof objectiveSchema>
export type CourseAsset = z.infer<typeof assetSchema>

// ---- small helpers the validator, the lint and the shells share ----

/** The objectives of a unit (the unit-to-objective link is stored on the objective). */
export const objectivesOf = (pack: Pick<CoursePack, 'objectives'>, unitId: string): CourseObjective[] => pack.objectives.filter((o) => o.unit === unitId)

/** The items asked for one objective. */
export const itemsOf = (pack: Pick<CoursePack, 'items'>, objectiveId: string): CourseItem[] => pack.items.filter((i) => i.objective === objectiveId)

/** The unit an item belongs to (through its objective), if the references are valid. */
export function unitOfItem(pack: Pick<CoursePack, 'objectives'>, item: Pick<CourseItem, 'objective'>): string | undefined {
  return pack.objectives.find((o) => o.id === item.objective)?.unit
}

/** The first cycle in the prerequisite graph as a list of unit ids (the first id repeated at the end), or null. Unknown ids are ignored. */
export function findUnitCycle(units: readonly Pick<CourseUnit, 'id' | 'requires'>[]): string[] | null {
  const byId = new Map(units.map((u) => [u.id, u]))
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    const s = state.get(id)
    if (s === 2) return null
    if (s === 1) return [...stack.slice(stack.indexOf(id)), id]
    const u = byId.get(id)
    if (!u) return null
    state.set(id, 1)
    stack.push(id)
    for (const r of u.requires) {
      const c = visit(r)
      if (c) return c
    }
    stack.pop()
    state.set(id, 2)
    return null
  }
  for (const u of units) {
    const c = visit(u.id)
    if (c) return c
  }
  return null
}

/** Units in an order where every unit comes after the units it requires (cycles and unknown ids are skipped), ties in pack order. */
export function unitOrder(units: readonly Pick<CourseUnit, 'id' | 'requires'>[]): string[] {
  const out: string[] = []
  const done = new Set<string>()
  const ids = new Set(units.map((u) => u.id))
  let progress = true
  while (progress) {
    progress = false
    for (const u of units) {
      if (done.has(u.id)) continue
      if (u.requires.every((r) => done.has(r) || !ids.has(r))) {
        out.push(u.id)
        done.add(u.id)
        progress = true
      }
    }
  }
  return out
}
