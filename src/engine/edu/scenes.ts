import { z } from 'zod'
import { CEFR_LEVELS } from '../../shared/course'
import { normalizeText } from '../../shared/edu'
import { conjugate, findVerb, DE_PERSONS, DE_TENSES, type DeTense } from '../../shared/lang'
import { registerOf } from '../../shared/lang/de/register'
import { ROLEPLAY_VOCAB_COVERAGE, walkScene, type RoleplaySection, type RpLine } from '../../shared/shells/roleplay'
import { authoredItemSchema, ident, type AuthoredItem, type Problem } from './authoring'

/**
 * The scene-writer's contract (EGS-39, HUB-23): the output schema of the role, the pure `checkScenes` that `askRole` runs for its one repair
 * round, and `toRoleplaySection`, the conversion of an accepted answer into the course section (`shells.config.roleplay`) and its catalogs.
 * Nothing here calls a model or reads a file. The pipeline stage (EGS-55) builds the `SceneContext` from the course and wires the task names
 * `scenes`, `scenes_check`, `scenes_revise`, `scenes_accepted`.
 *
 * The writer answers with inline text (a line is a German sentence, `help` and `translation` are in the language of the course); the keys of
 * the catalogs are made here, named as the `hr-a1-greetings` fixture names them (`rp.sc.<scene>.<line>`, `.tr`, `.help`).
 */

export const SCENE_WRITER_ROLE = 'scene-writer'
/** The task names of the stage (EGS-55 registers them in `STAGE_OF`); `scenes_accepted` is the language-coach's `accepted` task on the new typed items. */
export const SCENE_TASKS = ['scenes', 'scenes_check', 'scenes_revise', 'scenes_accepted'] as const

/** Lines and turns of the learner in a unit scene, and in the finale (D4): the generator's bounds, tighter than the lint's. */
export const SCENE_LINES: readonly [number, number] = [8, 12]
export const SCENE_REPLIES: readonly [number, number] = [3, 5]
export const FINALE_LINES: readonly [number, number] = [10, 14]
export const FINALE_REPLIES: readonly [number, number] = [4, 6]

/** Scenes per unit by CEFR level (D4): A1 one, A2 one or two, B1 and B2 two. The format field `scenes_per_unit` overrides it. */
export function defaultScenesPerUnit(cefr: string | undefined): readonly [number, number] {
  switch (cefr) {
    case 'A2':
      return [1, 2]
    case 'B1':
    case 'B2':
      return [2, 2]
    default:
      return [1, 1]
  }
}

/** The kinds of the reply items the writer may add: `order` only from B1 (D1). */
export const sceneItemKinds = (cefr: string | undefined): readonly string[] => (rank(cefr) >= rank('B1') ? ['mcq', 'typed', 'cloze', 'order'] : ['mcq', 'typed', 'cloze'])

const rank = (l: string | undefined): number => (CEFR_LEVELS as readonly string[]).indexOf(l ?? '')
const text = (what: string) => z.string({ error: `${what} must be a string` }).trim().min(1, `${what} must not be empty`)

// ---- the writer's answer ----

/** `null` is dropped like in the other roles (a model writes it for a field it leaves out), except the `next` of a line: `null` ends the scene. */
function dropNullsKeepNext(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropNullsKeepNext)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => x !== null || k === 'next').map(([k, x]) => [k, dropNullsKeepNext(x)]))
  }
  return v
}

const speakerSchema = z.object({ id: ident, name: text('a speaker name'), learner: z.boolean().optional() })

/** A line is a `say` line (a speaker says German `text`, with a `translation`) or a `reply` line (the learner's turn at a course item, with its `help`). */
const lineSchema = z
  .object({
    id: ident,
    say: ident.optional(),
    text: text('the text of a line').optional(),
    translation: text('a translation').optional(),
    reply: ident.optional(),
    help: text('a help').optional(),
    youSay: text('the words of the learner').optional(),
    next: z.union([ident, z.null()], { error: 'every line needs "next": the id of the next line, or null on the last line of the scene' })
  })
  .superRefine((l, ctx) => {
    if ((l.say === undefined) === (l.reply === undefined)) ctx.addIssue({ code: 'custom', path: ['say'], message: `the line "${l.id}" must be either a say line ("say" + "text") or a reply line ("reply"), not both and not neither` })
    else if (l.say !== undefined && l.text === undefined) ctx.addIssue({ code: 'custom', path: ['text'], message: `the say line "${l.id}" has no "text"` })
    else if (l.reply !== undefined && (l.text !== undefined || l.translation !== undefined)) ctx.addIssue({ code: 'custom', path: ['text'], message: `the reply line "${l.id}" has "text" or "translation": a reply is the course item, its words are the item's answer (use "youSay" for other words)` })
  })

const sceneSchema = z.object({
  id: ident,
  unit: ident.optional(),
  title: text('a scene title'),
  setting: text('a scene setting').optional(),
  cefr: z.enum(CEFR_LEVELS, { error: `cefr is one of ${CEFR_LEVELS.join(', ')}` }).optional(),
  start: ident,
  lines: z.array(lineSchema, { error: 'lines must be a list of lines' }).min(2, 'a scene has at least 2 lines')
})

/** New reply items: the kinds of `sceneItemKinds` (the level gate on `order` is in `checkScenes`). */
const newItemSchema = authoredItemSchema.refine((i) => ['mcq', 'typed', 'cloze', 'order'].includes(i.kind), { error: 'a new reply item is an mcq, a typed, a cloze (with a gap) or, from B1, an order item' })

export const sceneOutputSchema = z.preprocess(
  (v) => dropNullsKeepNext(v),
  z.object({
    speakers: z.array(speakerSchema).default([]),
    scenes: z.array(sceneSchema, { error: 'scenes must be a list of scenes' }).min(1, 'write at least one scene'),
    newItems: z.array(newItemSchema).default([])
  })
) as unknown as z.ZodType<SceneOutput>

export interface SceneOutput {
  speakers: z.output<typeof speakerSchema>[]
  scenes: SceneDraft[]
  newItems: AuthoredItem[]
}
export type SceneSpeaker = z.output<typeof speakerSchema>
export type SceneLine = z.output<typeof lineSchema>
export type SceneDraft = z.output<typeof sceneSchema>
export type SceneSayLine = SceneLine & { say: string; text: string }
export type SceneReplyLine = SceneLine & { reply: string }
export const isSceneSay = (l: SceneLine): l is SceneSayLine => l.say !== undefined && l.text !== undefined
export const isSceneReply = (l: SceneLine): l is SceneReplyLine => l.reply !== undefined

// ---- the context the check needs ----

/** An item of the course a reply may point at (built by the stage from the pack items and their catalogs). */
export interface SceneItemInfo {
  id: string
  kind: string
  /** The answers are in the taught language (`taught: true`); false = the learner would answer in the course language, which a German dialogue cannot use. */
  taught?: boolean
  /** The learner produces the words (a typed item, a cloze gap without a word bank): at least one such reply per unit. */
  typed: boolean
  /** The accepted answers as text (canonical first), for the checks on German, giving the answer away and the unit's verbs. */
  answers: readonly string[]
}

export interface SceneUnit {
  id: string
  /** `scope.json` vocabulary: the German term. */
  vocabulary: readonly { term: string }[]
  /** `scope.json` verbs of a verb unit: `tense` is a tense id of the verb table (`praesens`, `perfekt` ...). */
  verbs?: readonly { inf: string; tense?: string }[]
}

export interface SceneContext {
  /** The CEFR level of the course: a scene above it, and `order` items below B1, are refused. */
  cefr: string
  /** The taught language; the checks on German text and register run for `de` (the default). */
  targetLang?: string
  /** The items of the course the replies may reuse. */
  items: readonly SceneItemInfo[]
  /** The unit the call is for; missing = the finale (no new items, bigger scene, no vocabulary or typed-reply quota). */
  unit?: SceneUnit
  /** Speakers written by earlier calls (ids the scenes may use without listing them again). */
  knownSpeakers?: readonly { id: string; learner?: boolean }[]
  /** Scene ids already used by other calls. */
  existingSceneIds?: Iterable<string>
  /** How many scenes this call must give (inclusive). */
  sceneCount?: readonly [number, number]
  /** At least this many typed replies in the unit's scenes (default 1 for a unit, 0 for the finale). */
  minTyped?: number
  /** The writer may add reply items (default: yes for a unit, no for the finale). */
  allowNewItems?: boolean
  /** New item ids must start with this (`rp-<unit>-`). */
  itemIdPrefix?: string
  /** Facts and objectives for the new items. */
  factIds?: Iterable<string>
  objectives?: readonly { id: string; unit: string }[]
  /** Replaces the default share of the unit's vocabulary that the scenes must use. */
  vocabularyShare?: number
}

const prob = (ref: string, issue: string, fix?: string): Problem => ({ ref, issue, ...(fix ? { fix } : {}), severity: 'major' })
const fold = (s: string): string => normalizeText(s, { fold: true })
const dups = (list: readonly string[]): string[] => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))]

// ---- is this German? (a cheap guard against a line written in the course language) ----

const EN_WORDS = new Set(['the', 'and', 'you', 'are', 'is', 'to', 'of', 'my', 'your', 'this', 'that', 'with', 'for', 'how', 'what', 'where', 'would', 'can', 'have', 'please', 'hello', 'thanks', 'thank', 'good', 'morning', 'name', 'yes', 'i', 'am', 'it', 'we', 'do', 'not', 'want', 'like', 'here', 'there'])
const HR_WORDS = new Set(['je', 'sam', 'si', 'smo', 'ste', 'su', 'ne', 'što', 'sto', 'kako', 'gdje', 'ti', 'vi', 'hvala', 'molim', 'dobar', 'dobro', 'bok', 'zdravo', 'želim', 'zelim', 'imam', 'trebam', 'kava', 'ovo', 'ono', 'ima', 'mogu', 'možete', 'mozete', 'gospodine'])

/** True when the text is clearly Croatian or English: it has Croatian-only letters, or most of its words are common English or Croatian words that are no German words. */
export function looksNotGerman(s: string): boolean {
  if (/[čćšžđČĆŠŽĐ]/.test(s)) return true
  const words = s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
  if (words.length === 0) return false
  const hits = words.filter((w) => EN_WORDS.has(w) || HR_WORDS.has(w)).length
  return hits >= 1 && hits / words.length >= 0.5
}

// ---- answers of the items a scene points at ----

interface ReplyItem {
  id: string
  kind: string
  taught?: boolean
  typed: boolean
  answers: readonly string[]
  /** A new item written in this answer. */
  fresh: boolean
}

function newItemInfo(it: AuthoredItem): ReplyItem {
  let answers: string[] = []
  let typed = false
  if (it.kind === 'typed') {
    answers = it.accepted
    typed = true
  } else if (it.kind === 'mcq') {
    const right = it.options.find((o) => o.id === it.answer)
    answers = right ? [right.text] : []
  } else if (it.kind === 'cloze') {
    answers = it.gaps.flatMap((g) => g.accepted)
    typed = it.gaps.some((g) => !g.bank)
  }
  return { id: it.id, kind: it.kind, taught: it.taught === true, typed, answers, fresh: true }
}

const tokens = (s: string): string[] => fold(s).split(' ').filter(Boolean)
const stemOf = (w: string): string => (w.length >= 6 ? w.replace(/(en|n|e)$/, '') : w)
const ARTICLE = /^(der|die|das|ein|eine|einen|dem|den) /

/** Whether the unit's term is in the (folded) corpus: the whole phrase, without its article, or a single word by its stem (heißen / heiße). */
function termUsed(term: string, corpus: string, corpusTokens: readonly string[]): boolean {
  const first = term.split(/[,;(]/)[0] ?? term
  const full = fold(first)
  const bare = full.replace(ARTICLE, '')
  for (const v of new Set([full, bare])) {
    if (!v) continue
    if (` ${corpus} `.includes(` ${v} `)) return true
  }
  if (!bare.includes(' ')) {
    const stem = stemOf(bare)
    return stem.length >= 4 && corpusTokens.some((t) => t.startsWith(stem))
  }
  return false
}

/** Whether some form of the verb (any person, the unit's tense) is in the replies: every word of a form (a compound "bin gegangen", a separable "stehe auf") is in one answer. */
function verbUsed(v: { inf: string; tense?: string }, answers: readonly string[]): boolean {
  const verb = findVerb(v.inf)
  const answerTokens = answers.map(tokens)
  if (!verb) {
    const stem = stemOf(fold(v.inf))
    return answerTokens.some((ts) => ts.some((t) => t.startsWith(stem)))
  }
  const tenses: DeTense[] = DE_TENSES.includes(v.tense as DeTense) ? [v.tense as DeTense] : ['praesens']
  const forms = tenses.flatMap((t) => DE_PERSONS.flatMap((p) => conjugate(verb, t, p)))
  return forms.some((f) => {
    const need = tokens(f)
    return need.length > 0 && answerTokens.some((ts) => need.every((n) => ts.includes(n)))
  })
}

// ---- the check ----

/**
 * What the schema cannot see. Hard errors, each with the fix for the model: broken chain (dangling next, unreachable line, no end), unknown
 * speaker or item, a scene with no turn, German missing in say lines and answers, a reply with no help, a say line that is the answer of a turn,
 * du and Sie mixed in a scene, a scene above the level of the course, scene size, too few typed replies, a verb unit whose verbs never appear,
 * too little of the unit's vocabulary, and the problems of a new reply item (id, kind, objective, facts, `taught`, a `why` per wrong option).
 */
export function checkScenes(out: SceneOutput, ctx: SceneContext): Problem[] {
  const problems: Problem[] = []
  const de = (ctx.targetLang ?? 'de') === 'de'
  const finale = !ctx.unit
  const allowNew = ctx.allowNewItems ?? !finale
  const known = new Map<string, ReplyItem>(ctx.items.map((i) => [i.id, { id: i.id, kind: i.kind, taught: i.taught, typed: i.typed, answers: i.answers, fresh: false }]))
  const fresh = new Map(out.newItems.map((i) => [i.id, newItemInfo(i)]))

  // ---- speakers ----
  const speakerIds = new Set([...out.speakers.map((s) => s.id), ...(ctx.knownSpeakers ?? []).map((s) => s.id)])
  for (const d of dups(out.speakers.map((s) => s.id))) problems.push(prob(d, 'this speaker id is used twice'))
  for (const s of out.speakers) if ((ctx.knownSpeakers ?? []).some((k) => k.id === s.id)) problems.push(prob(s.id, 'this speaker was already given: leave it out of speakers and just use its id', 'list only new speakers'))
  const learners = [...out.speakers, ...(ctx.knownSpeakers ?? [])].filter((s) => s.learner)
  if (learners.length === 0) problems.push(prob('', 'no speaker is the learner', 'add a speaker with "learner": true (the learner, for example "you") and give the others 2 to 4 characters'))
  else if (learners.length > 1) problems.push(prob('', `${learners.length} speakers are the learner`, 'only one speaker has "learner": true'))
  if (out.speakers.filter((s) => !s.learner).length > 4) problems.push(prob('', 'more than 4 characters besides the learner', 'keep 2 to 4 characters'))

  // ---- the scenes of the call ----
  if (ctx.sceneCount && (out.scenes.length < ctx.sceneCount[0] || out.scenes.length > ctx.sceneCount[1])) {
    const [a, b] = ctx.sceneCount
    problems.push(prob('', `${out.scenes.length} scene(s) given, this call needs ${a === b ? `exactly ${a}` : `${a} to ${b}`}`, `give ${a === b ? a : `${a} to ${b}`} scene(s)`))
  }
  const existingScenes = new Set(ctx.existingSceneIds ?? [])
  for (const d of dups(out.scenes.map((s) => s.id))) problems.push(prob(d, 'this scene id is used twice'))
  const [linesLo, linesHi] = finale ? FINALE_LINES : SCENE_LINES
  const [repLo, repHi] = finale ? FINALE_REPLIES : SCENE_REPLIES
  const courseRank = rank(ctx.cefr)
  const replyAnswers: string[] = []
  const youSay: string[] = []
  const sayTexts: string[] = []
  const usedItems = new Set<string>()
  let typedReplies = 0

  for (const sc of out.scenes) {
    if (existingScenes.has(sc.id)) problems.push(prob(sc.id, 'this scene id is already used by another scene', 'use a new id (start it with the unit id)'))
    if (ctx.unit) {
      if (sc.unit !== ctx.unit.id) problems.push(prob(sc.id, `its unit is ${sc.unit ? `"${sc.unit}"` : 'missing'}, these scenes are for "${ctx.unit.id}"`, `set "unit": "${ctx.unit.id}"`))
    } else if (sc.unit) problems.push(prob(sc.id, 'the finale scene belongs to no unit', 'leave "unit" out'))
    if (sc.cefr && rank(sc.cefr) > courseRank) problems.push(prob(sc.id, `its cefr ${sc.cefr} is above the level of the course (${ctx.cefr})`, `use ${ctx.cefr} or lower`))

    // the chain of lines
    const ids = sc.lines.map((l) => l.id)
    for (const d of dups(ids)) problems.push(prob(`${sc.id}.${d}`, 'this line id is used twice in the scene'))
    if (!ids.includes(sc.start)) problems.push(prob(sc.id, `its start "${sc.start}" is not a line of the scene`, `start must be one of: ${ids.join(', ')}`))
    for (const l of sc.lines) if (l.next !== null && !ids.includes(l.next)) problems.push(prob(`${sc.id}.${l.id}`, `it goes on to "${l.next}", which is no line of the scene`, 'next is the id of a line of this scene, or null on the last line'))
    if (ids.includes(sc.start)) {
      const walk = walkScene({ start: sc.start, lines: sc.lines as unknown as RpLine[] })
      if (walk.loopAt !== undefined) problems.push(prob(sc.id, `the lines lead round in a circle at "${walk.loopAt}" and never end`, 'the last line has "next": null'))
      else if (!walk.ends && walk.dangling === undefined) problems.push(prob(sc.id, 'the chain does not end', 'the last line has "next": null'))
      const onPath = new Set(walk.path)
      for (const l of sc.lines) if (!onPath.has(l.id)) problems.push(prob(`${sc.id}.${l.id}`, 'this line can never be reached from the start', 'chain every line: each line\'s next is the following line, in order'))
      if (!sc.lines.filter((l) => onPath.has(l.id)).some(isSceneReply)) problems.push(prob(sc.id, 'the scene has no turn for the learner', 'add reply lines: the learner must answer'))
    }

    // size
    const replies = sc.lines.filter(isSceneReply)
    if (sc.lines.length < linesLo || sc.lines.length > linesHi) problems.push(prob(sc.id, `${sc.lines.length} lines, ${finale ? 'the finale' : 'a scene'} has ${linesLo} to ${linesHi}`, `write ${linesLo} to ${linesHi} lines`))
    if (replies.length < repLo || replies.length > repHi) problems.push(prob(sc.id, `${replies.length} turns for the learner, ${finale ? 'the finale' : 'a scene'} has ${repLo} to ${repHi}`, `give the learner ${repLo} to ${repHi} turns`))

    // lines
    const sceneAnswers: string[] = []
    for (const l of replies) {
      const item = known.get(l.reply) ?? fresh.get(l.reply)
      if (!item) {
        problems.push(prob(`${sc.id}.${l.id}`, `it asks the item "${l.reply}", which does not exist`, 'reuse an id from the list of items, or add the item to newItems'))
        continue
      }
      usedItems.add(item.id)
      if (!l.help) problems.push(prob(`${sc.id}.${l.id}`, 'a reply has no help', 'give "help": what the other speaker says in simpler words after a miss, with a hint in the language of the course'))
      if (item.taught === false || (item.fresh && item.taught !== true)) problems.push(prob(`${sc.id}.${l.id}`, `the item "${item.id}" does not have German answers${item.fresh ? ' (set "taught": true)' : ''}`, 'a reply is a German sentence: use an item whose answers are German'))
      if (de) for (const a of item.answers) if (looksNotGerman(a)) problems.push(prob(`${sc.id}.${l.id}`, `the answer "${a}" of the item "${item.id}" is not German`, 'the answers of a reply are in German'))
      if (item.typed) typedReplies++
      sceneAnswers.push(...item.answers)
      replyAnswers.push(...item.answers)
      if (l.youSay) {
        youSay.push(l.youSay)
        sceneAnswers.push(l.youSay)
        if (de && looksNotGerman(l.youSay)) problems.push(prob(`${sc.id}.${l.id}`, `youSay "${l.youSay}" is not German`, 'youSay is what the learner says, in German'))
      }
    }
    const says = sc.lines.filter(isSceneSay)
    const answerKeys = new Set(sceneAnswers.map(fold))
    for (const l of says) {
      sayTexts.push(l.text)
      if (!speakerIds.has(l.say)) problems.push(prob(`${sc.id}.${l.id}`, `it is said by "${l.say}", who is not a speaker`, `use one of: ${[...speakerIds].join(', ') || 'the speakers you list'}`))
      if (de && looksNotGerman(l.text)) problems.push(prob(`${sc.id}.${l.id}`, `the text "${l.text}" is not German`, 'a spoken line is German; the meaning goes in "translation", in the language of the course'))
      if (!l.translation) problems.push(prob(`${sc.id}.${l.id}`, 'a say line has no translation', 'give "translation": the meaning in the language of the course'))
      if (answerKeys.has(fold(l.text))) problems.push(prob(`${sc.id}.${l.id}`, `it says "${l.text}", which is also the answer to a turn of the scene: it gives the answer away`, 'say something else; the learner finds the words'))
    }
    if (de) {
      const regs = [...says.map((l) => l.text), ...sceneAnswers].map(registerOf)
      if (regs.some((r) => r.du) && regs.some((r) => r.sie)) problems.push(prob(sc.id, 'it addresses people with both du and Sie', 'one scene keeps one register: du (friends, children) or Sie (strangers, officials)'))
    }
  }

  // ---- new reply items ----
  if (out.newItems.length > 0 && !allowNew) problems.push(prob('', 'newItems must be empty here: reply with items of the list only', 'leave newItems out'))
  const knownObjectives = new Map((ctx.objectives ?? []).map((o) => [o.id, o.unit]))
  const facts = ctx.factIds ? new Set(ctx.factIds) : undefined
  for (const d of dups(out.newItems.map((i) => i.id))) problems.push(prob(d, 'this item id is used twice'))
  for (const it of out.newItems) {
    if (known.has(it.id)) problems.push(prob(it.id, 'this item id is already used by an item of the course', 'use a new id'))
    if (ctx.itemIdPrefix && !it.id.startsWith(ctx.itemIdPrefix)) problems.push(prob(it.id, `a new item id starts with "${ctx.itemIdPrefix}"`, `rename it "${ctx.itemIdPrefix}<n>"`))
    if (!sceneItemKinds(ctx.cefr).includes(it.kind)) problems.push(prob(it.id, `the kind "${it.kind}" is not allowed at ${ctx.cefr}`, `use one of: ${sceneItemKinds(ctx.cefr).join(', ')}`))
    if (it.taught !== true) problems.push(prob(it.id, 'a reply item has German answers', 'set "taught": true'))
    if (knownObjectives.size > 0) {
      const unit = knownObjectives.get(it.objective)
      if (unit === undefined) problems.push(prob(it.id, `its objective "${it.objective}" does not exist`, `use one of: ${[...knownObjectives.keys()].join(', ')}`))
      else if (ctx.unit && unit !== ctx.unit.id) problems.push(prob(it.id, `its objective "${it.objective}" belongs to the unit "${unit}"`, `use an objective of ${ctx.unit.id}`))
    }
    if (facts) for (const f of it.facts) if (!facts.has(f)) problems.push(prob(it.id, `it names the fact ${f}, which is not in the fact base`, 'use only fact ids that were given'))
    if (it.kind === 'mcq') {
      for (const o of it.options) if (o.id !== it.answer && !o.why) problems.push(prob(it.id, `the wrong option "${o.id}" has no why`, 'every wrong option needs the mistake it stands for'))
      if (it.options.filter((o) => o.id !== it.answer).length < 2) problems.push(prob(it.id, 'an mcq needs at least 2 wrong options'))
    }
    if (!usedItems.has(it.id)) problems.push(prob(it.id, 'no reply uses this new item', 'point a reply at it, or remove it from newItems'))
  }

  // ---- the unit: typed replies, vocabulary, verbs ----
  if (ctx.unit) {
    const needTyped = ctx.minTyped ?? 1
    if (typedReplies < needTyped) problems.push(prob(ctx.unit.id, `${typedReplies} typed reply(ies) in the scenes, at least ${needTyped} needed`, 'at least one reply is a typed item or a cloze with a gap and no word bank: the learner must produce German'))
    const corpusText = [...sayTexts, ...replyAnswers, ...youSay].map(fold).join(' ')
    const corpusTokens = corpusText.split(' ')
    const terms = ctx.unit.vocabulary.map((v) => v.term).filter((t) => fold(t))
    if (terms.length > 0) {
      const used = terms.filter((t) => termUsed(t, corpusText, corpusTokens))
      const need = ctx.vocabularyShare ?? ROLEPLAY_VOCAB_COVERAGE
      if (used.length / terms.length < need) {
        const missing = terms.filter((t) => !used.includes(t)).slice(0, 8)
        problems.push(prob(ctx.unit.id, `the scenes use ${used.length} of the unit's ${terms.length} vocabulary terms, at least ${Math.ceil(terms.length * need)} are needed`, `use more of: ${missing.join(', ')}`))
      }
    }
    const verbs = ctx.unit.verbs ?? []
    if (verbs.length > 0 && !verbs.some((v) => verbUsed(v, replyAnswers.concat(youSay)))) {
      problems.push(prob(ctx.unit.id, `none of the unit's verbs (${verbs.map((v) => v.inf).join(', ')}) is in a reply of the learner`, 'let the learner answer with a form of one of these verbs, in the unit\'s tense'))
    }
  }
  return problems
}

/** `askRole`'s `check` for a call: `askRole(ctx, { ..., schema: sceneOutputSchema, check: sceneCheck(sceneContext) })`. */
export const sceneCheck = (c: SceneContext) => (out: SceneOutput): Problem[] => checkScenes(out, c)

// ---- the answer as course data ----

export interface SceneSection {
  speakers: RoleplaySection['speakers']
  scenes: RoleplaySection['scenes']
  /** Catalog strings of the TARGET language (the German: say `text`, `youSay`). */
  target: Record<string, string>
  /** Catalog strings of the SOURCE language (translated into the editions later): names, titles, settings, `translation`, `help`. */
  source: Record<string, string>
}

/**
 * The accepted scenes as pack data and catalog strings. Keys: `rp.sp.<speaker>`, `rp.sc.<scene>.title`, `.setting`, `rp.sc.<scene>.<line>` (+ `.tr`, `.help`, `.you`).
 * The garden, the finale id and the new items are the stage's (EGS-55); scenes keep their `unit`, `cefr` and `start`.
 */
export function toRoleplaySection(out: Pick<SceneOutput, 'speakers' | 'scenes'>): SceneSection {
  const target: Record<string, string> = {}
  const source: Record<string, string> = {}
  const speakers = out.speakers.map((s) => {
    source[`rp.sp.${s.id}`] = s.name
    return { id: s.id, name: `rp.sp.${s.id}`, learner: s.learner === true }
  })
  const scenes = out.scenes.map((sc) => {
    const base = `rp.sc.${sc.id}`
    source[`${base}.title`] = sc.title
    if (sc.setting) source[`${base}.setting`] = sc.setting
    const lines = sc.lines.map((l) => {
      const key = `${base}.${l.id}`
      if (isSceneSay(l)) {
        target[key] = l.text
        if (l.translation) source[`${key}.tr`] = l.translation
        return { id: l.id, say: l.say, text: key, ...(l.translation ? { translation: `${key}.tr` } : {}), listen: false, next: l.next }
      }
      if (l.help) source[`${key}.help`] = l.help
      if (l.youSay) target[`${key}.you`] = l.youSay
      return { id: l.id, reply: l.reply as string, ...(l.help ? { help: `${key}.help` } : {}), ...(l.youSay ? { youSay: `${key}.you` } : {}), next: l.next }
    })
    return { id: sc.id, ...(sc.unit ? { unit: sc.unit } : {}), title: `${base}.title`, ...(sc.setting ? { setting: `${base}.setting` } : {}), ...(sc.cefr ? { cefr: sc.cefr } : {}), start: sc.start, lines }
  })
  return { speakers, scenes, target, source }
}
