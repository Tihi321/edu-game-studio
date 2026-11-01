import {
  clozeSchema,
  crosswordSchema,
  flashcardSchema,
  hotspotSchema,
  listeningSchema,
  matchPairsSchema,
  mcqSchema,
  multiSelectSchema,
  orderSchema,
  sortGroupsSchema,
  trueFalseSchema,
  typedSchema,
  wordSearchSchema,
  type CourseItem
} from '../course'
import {
  checkCloze,
  checkCrossword,
  checkFlashcard,
  checkHotspot,
  checkListening,
  checkMatchPairs,
  checkMcq,
  checkMultiSelect,
  checkOrder,
  checkSortGroups,
  checkTrueFalse,
  checkTyped,
  checkWordSearch,
  crosswordFor,
  wordSearchFor
} from './checkers'
import { placementSelection, verifyWordSearch } from './wordsearch'
import { verifyCrossword } from './crossword'
import { makeCheckContext, registerItemKind, ITEM_KINDS, type CheckContext, type ItemKindDef, type Problem, type TextRef, type ValidationContext } from './registry'
import { makeTextResolver } from './text'

/**
 * The built-in item kinds, registered into `ITEM_KINDS`. Importing this module (or `./index`) registers them once; a later kind is one more
 * `registerItemKind` call anywhere.
 *
 * Which kinds must give every wrong choice a `why` (the misconception explanation, `MISSING_WHY`): mcq, multi-select and listening-choose.
 * For the other kinds the explanation (and the optional per-item `why`) is enough.
 */

const refs = (path: string, key: string | undefined, role: TextRef['role'] = 'string'): TextRef[] => (key ? [{ path, key, role }] : [])
const base = (item: CourseItem): TextRef[] => [
  ...refs('prompt', item.prompt),
  ...refs('explanation', item.explanation),
  ...refs('didYouKnow', item.didYouKnow),
  ...refs('hint', item.hint)
]

function dupIds(list: readonly { id: string }[], path: string): Problem[] {
  const seen = new Set<string>()
  const out: Problem[] = []
  list.forEach((x, i) => {
    if (seen.has(x.id)) out.push({ code: 'DUPLICATE_ID', path: `${path}[${i}].id`, message: `the id "${x.id}" is used twice in ${path}` })
    seen.add(x.id)
  })
  return out
}

const resolverFor = (v: ValidationContext, lang: string) => makeTextResolver(v.catalogs, lang, v.pack.targetLang)
const ctxFor = (v: ValidationContext, lang: string): CheckContext => makeCheckContext({ pack: v.pack, text: resolverFor(v, lang) })

function assetKind(v: ValidationContext, id: string | undefined, kind: 'image' | 'audio', path: string): Problem[] {
  if (!id) return []
  const a = v.assets.get(id)
  if (a && a.kind !== kind) return [{ code: 'ASSET_KIND', path, message: `asset "${id}" is ${a.kind}, this item needs ${kind}` }]
  return []
}

function def<I extends CourseItem>(d: ItemKindDef<I>): void {
  registerItemKind(d)
}

def({
  kind: 'mcq',
  form: 'Multiple choice',
  recall: false,
  schema: mcqSchema,
  check: (item, answer) => checkMcq(item, answer),
  keyOf: (item) => item.answer,
  solve: (item) => item.answer,
  textRefs: (item) => [...base(item), ...item.options.flatMap((o, i) => [...refs(`options[${i}].text`, o.text), ...refs(`options[${i}].why`, o.why)])],
  validate: (item) => [
    ...dupIds(item.options, 'options'),
    ...(item.options.some((o) => o.id === item.answer) ? [] : [{ code: 'UNKNOWN_OPTION', path: 'answer', message: `the answer "${item.answer}" is not one of the options` }])
  ],
  distractors: (item) => item.options.flatMap((o, i) => (o.id === item.answer ? [] : [{ path: `options[${i}].why`, id: o.id, why: o.why }]))
})

def({
  kind: 'true-false',
  form: 'True or false',
  recall: false,
  schema: trueFalseSchema,
  check: (item, answer) => checkTrueFalse(item, answer),
  keyOf: (item) => item.answer,
  solve: (item) => item.answer,
  textRefs: (item) => [...base(item), ...refs('why', item.why)]
})

def({
  kind: 'multi-select',
  form: 'Select all that apply',
  recall: false,
  schema: multiSelectSchema,
  check: (item, answer) => checkMultiSelect(item, answer),
  keyOf: (item) => [...item.answers].sort(),
  solve: (item) => [...item.answers],
  textRefs: (item) => [...base(item), ...item.options.flatMap((o, i) => [...refs(`options[${i}].text`, o.text), ...refs(`options[${i}].why`, o.why)])],
  validate: (item) => [
    ...dupIds(item.options, 'options'),
    ...item.answers.flatMap((a, i) => (item.options.some((o) => o.id === a) ? [] : [{ code: 'UNKNOWN_OPTION', path: `answers[${i}]`, message: `the answer "${a}" is not one of the options` }]))
  ],
  distractors: (item) => item.options.flatMap((o, i) => (item.answers.includes(o.id) ? [] : [{ path: `options[${i}].why`, id: o.id, why: o.why }]))
})

def({
  kind: 'cloze',
  form: 'Fill the gap',
  recall: true,
  schema: clozeSchema,
  check: (item, answer, ctx) => checkCloze(item, answer, ctx),
  keyOf: (item) => Object.fromEntries(item.gaps.map((g) => [g.id, g.answer])),
  solve: (item, ctx) => Object.fromEntries(item.gaps.map((g) => [g.id, ctx.text.canonical(g.answer) ?? ''])),
  textRefs: (item) => [
    ...base(item),
    ...refs('text', item.text),
    ...item.gaps.flatMap((g, i) => [
      ...refs(`gaps[${i}].answer`, g.answer, 'accepted'),
      ...(g.bank ? [...refs(`gaps[${i}].answer`, g.answer), ...g.bank.flatMap((b, j) => refs(`gaps[${i}].bank[${j}]`, b))] : [])
    ])
  ],
  validate: (item, v) => {
    const out: Problem[] = [...dupIds(item.gaps, 'gaps')]
    item.gaps.forEach((g, i) => {
      if (g.bank && !g.bank.includes(g.answer)) out.push({ code: 'UNKNOWN_OPTION', path: `gaps[${i}].bank`, message: `the word bank of gap "${g.id}" does not contain its answer key` })
    })
    for (const lang of v.languages) {
      const text = resolverFor(v, lang).text(item.text)
      if (text === undefined) continue
      for (const g of item.gaps) if (!text.includes(`{{${g.id}}}`)) out.push({ code: 'MISSING_GAP_MARKER', path: 'text', message: `the text in "${lang}" has no {{${g.id}}} marker` })
    }
    return out
  }
})

def({
  kind: 'typed',
  form: 'Type the answer',
  recall: true,
  schema: typedSchema,
  check: (item, answer, ctx) => checkTyped(item, answer, ctx),
  keyOf: (item) => item.answer,
  solve: (item, ctx) => ctx.text.canonical(item.answer) ?? '',
  textRefs: (item) => [...base(item), ...refs('answer', item.answer, 'accepted')]
})

def({
  kind: 'match-pairs',
  form: 'Match the pairs',
  recall: false,
  schema: matchPairsSchema,
  check: (item, answer) => checkMatchPairs(item, answer),
  keyOf: (item) => Object.fromEntries(item.pairs.map((p) => [p.id, p.id])),
  solve: (item) => Object.fromEntries(item.pairs.map((p) => [p.id, p.id])),
  textRefs: (item) => [...base(item), ...item.pairs.flatMap((p, i) => [...refs(`pairs[${i}].left`, p.left), ...refs(`pairs[${i}].right`, p.right)])],
  validate: (item) => dupIds(item.pairs, 'pairs')
})

def({
  kind: 'order',
  form: 'Put in order',
  recall: true,
  schema: orderSchema,
  check: (item, answer) => checkOrder(item, answer),
  keyOf: (item) => item.items.map((i) => i.id),
  solve: (item) => item.items.map((i) => i.id),
  textRefs: (item) => [...base(item), ...item.items.flatMap((x, i) => [...refs(`items[${i}].text`, x.text), ...refs(`items[${i}].when`, x.when)])],
  validate: (item) => dupIds(item.items, 'items')
})

def({
  kind: 'sort-groups',
  form: 'Sort into groups',
  recall: true,
  schema: sortGroupsSchema,
  check: (item, answer) => checkSortGroups(item, answer),
  keyOf: (item) => Object.fromEntries(item.items.map((i) => [i.id, i.group])),
  solve: (item) => Object.fromEntries(item.items.map((i) => [i.id, i.group])),
  textRefs: (item) => [
    ...base(item),
    ...item.groups.flatMap((g, i) => refs(`groups[${i}].title`, g.title)),
    ...item.items.flatMap((x, i) => [...refs(`items[${i}].text`, x.text), ...refs(`items[${i}].why`, x.why)])
  ],
  validate: (item) => [
    ...dupIds(item.groups, 'groups'),
    ...dupIds(item.items, 'items'),
    ...item.items.flatMap((x, i) => (item.groups.some((g) => g.id === x.group) ? [] : [{ code: 'UNKNOWN_GROUP', path: `items[${i}].group`, message: `the group "${x.group}" does not exist` }]))
  ]
})

def({
  kind: 'hotspot',
  form: 'Find it on the picture',
  recall: true,
  schema: hotspotSchema,
  check: (item, answer) => checkHotspot(item, answer),
  keyOf: (item) => item.answer,
  solve: (item) => item.answer,
  textRefs: (item) => [...base(item), ...item.regions.flatMap((r, i) => [...refs(`regions[${i}].label`, r.label), ...refs(`regions[${i}].why`, r.why)])],
  validate: (item, v) => [
    ...dupIds(item.regions, 'regions'),
    ...(item.regions.some((r) => r.id === item.answer) ? [] : [{ code: 'UNKNOWN_REGION', path: 'answer', message: `the answer "${item.answer}" is not one of the regions` }]),
    ...assetKind(v, item.asset, 'image', 'asset')
  ]
})

def({
  kind: 'listening',
  form: 'Listen and answer',
  recall: false,
  schema: listeningSchema,
  check: (item, answer, ctx) => checkListening(item, answer, ctx),
  keyOf: (item) => item.answer,
  solve: (item, ctx) => (item.mode === 'choose' ? item.answer : (ctx.text.canonical(item.answer) ?? '')),
  textRefs: (item) => [
    ...base(item),
    ...refs('transcript', item.transcript),
    ...(item.mode === 'type' ? refs('answer', item.answer, 'accepted') : []),
    ...(item.options ?? []).flatMap((o, i) => [...refs(`options[${i}].text`, o.text), ...refs(`options[${i}].why`, o.why)])
  ],
  validate: (item, v) => [
    ...dupIds(item.options ?? [], 'options'),
    ...(item.mode === 'choose' && !(item.options ?? []).some((o) => o.id === item.answer) ? [{ code: 'UNKNOWN_OPTION', path: 'answer', message: `the answer "${item.answer}" is not one of the options` }] : []),
    ...assetKind(v, item.asset, 'audio', 'asset')
  ],
  distractors: (item) => (item.mode === 'choose' ? (item.options ?? []).flatMap((o, i) => (o.id === item.answer ? [] : [{ path: `options[${i}].why`, id: o.id, why: o.why }])) : [])
})

def({
  kind: 'flashcard',
  form: 'Flashcard',
  recall: true,
  schema: flashcardSchema,
  check: (item, answer) => checkFlashcard(item, answer),
  keyOf: () => null,
  solve: () => 'good',
  textRefs: (item) => [...base(item), ...refs('back', item.back)],
  validate: (item, v) => (item.backAsset && !v.assets.has(item.backAsset) ? [{ code: 'UNKNOWN_ASSET', path: 'backAsset', message: `unknown asset "${item.backAsset}"` }] : [])
})

def({
  kind: 'crossword',
  form: 'Crossword',
  recall: true,
  schema: crosswordSchema,
  check: (item, answer, ctx) => checkCrossword(item, answer, ctx),
  keyOf: (item) => Object.fromEntries(item.words.map((w) => [w.id, w.answer])),
  solve: (item, ctx) => Object.fromEntries(item.words.map((w) => [w.id, ctx.text.canonical(w.answer) ?? ''])),
  textRefs: (item) => [...base(item), ...item.words.flatMap((w, i) => [...refs(`words[${i}].answer`, w.answer, 'accepted'), ...refs(`words[${i}].clue`, w.clue)])],
  validate: (item, v) => {
    const out = dupIds(item.words, 'words')
    for (const lang of v.languages) {
      const ctx = ctxFor(v, lang)
      if (item.words.some((w) => !ctx.text.canonical(w.answer))) continue // reported as MISSING_TEXT
      const { grid, words } = crosswordFor(item, ctx)
      if (grid.unplaced.length > 0) out.push({ code: 'PUZZLE_UNPLACED', path: 'words', message: `in "${lang}" the crossword cannot place: ${grid.unplaced.join(', ')}` })
      for (const p of verifyCrossword(grid, words)) out.push({ code: 'PUZZLE_INVALID', path: 'words', message: `in "${lang}": ${p}` })
    }
    return out
  }
})

def({
  kind: 'word-search',
  form: 'Word search',
  recall: true,
  schema: wordSearchSchema,
  check: (item, answer, ctx) => checkWordSearch(item, answer, ctx),
  keyOf: (item) => item.words.map((w) => w.id),
  solve: (item, ctx) => wordSearchFor(item, ctx).grid.placements.map(placementSelection),
  textRefs: (item) => [...base(item), ...item.words.flatMap((w, i) => refs(`words[${i}].answer`, w.answer, 'accepted'))],
  validate: (item, v) => {
    const out = dupIds(item.words, 'words')
    for (const lang of v.languages) {
      const ctx = ctxFor(v, lang)
      if (item.words.some((w) => !ctx.text.canonical(w.answer))) continue
      const { grid, words } = wordSearchFor(item, ctx)
      if (grid.unplaced.length > 0) out.push({ code: 'PUZZLE_UNPLACED', path: 'words', message: `in "${lang}" the word search cannot place: ${grid.unplaced.join(', ')}` })
      for (const p of verifyWordSearch(grid, words)) out.push({ code: 'PUZZLE_INVALID', path: 'words', message: `in "${lang}": ${p}` })
    }
    return out
  }
})

/** The ids of the built-in kinds, as registered. */
export const BUILTIN_KIND_IDS: readonly string[] = [...ITEM_KINDS.keys()]
