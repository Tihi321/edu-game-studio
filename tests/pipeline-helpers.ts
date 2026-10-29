import { createHash } from 'node:crypto'
import path from 'node:path'
import type { EngineOptions } from '../src/engine/engine'
import type { PlaytestResult } from '../src/engine/edu/playtest'
import type { ChatRequest } from '../src/engine/models/types'
import { contentText } from '../src/engine/models/types'
import type { BriefInput } from '../src/shared/brief'
import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'
import { callTool, buildTools } from '../src/engine/mcp/tools'
import { waitIdle } from './edu-helpers'
import { makeResearchEnv } from './research-helpers'
import type { ResearchEnv, ResearchEnvOptions } from './research-helpers'

/**
 * A scripted course author for the pipeline tests: one mock model that answers every role of the team by reading its prompt (the ids, the
 * facts and the objectives are in the text), so the whole pipeline runs on the mock provider with no network. Knobs decide where it says
 * `revise`. Every call is logged as `<role>/<task>` (and `:<unit>` for a unit task), for the assertions.
 */

export interface AuthorOptions {
  /** The fact-checker's verdict for a unit in a round (default pass). */
  factCheck?: (unit: string, round: number) => 'pass' | 'revise'
  /** An audience reviewer's verdict in a round (default pass). */
  review?: (role: string, round: number) => 'pass' | 'revise'
  /** The playtester's verdict. */
  report?: 'pass' | 'revise'
  /** The art-director's answer: `ok` (default), `repair` (wrong the first time, right after the repair round) or `unusable` (never right: the deterministic plan is used). */
  artPlan?: 'ok' | 'repair' | 'unusable'
  /** The art-critic's verdict on a picture in a round (default pass). */
  artReview?: (assetId: string, round: number) => 'pass' | 'revise'
  /** The composer's answer: `ok` (default), `merge` (every unit shares the first unit's track), `repair` (wrong the first time), `unusable` (never right: the deterministic plan is used). */
  musicPlan?: 'ok' | 'repair' | 'unusable' | 'merge'
}

export interface Author {
  calls: string[]
  count(prefix: string): number
  /** The number of images in each request the art-critic got (a picture goes with every review). */
  criticImages: number[]
}

const userText = (req: ChatRequest): string => req.messages.filter((m) => m.role === 'user').map((m) => contentText(m.content)).join('\n')
const lines = (text: string): string[] => text.split('\n')
const jsonLines = (text: string): Record<string, unknown>[] =>
  lines(text)
    .filter((l) => l.startsWith('{"id"'))
    .map((l) => JSON.parse(l.replace(/,$/, '')) as Record<string, unknown>)
const grab = (text: string, re: RegExp): string => re.exec(text)?.[1] ?? ''
const out = (v: unknown): string => JSON.stringify(v)

/** `- u1-o1 [remember] text (facts: f1, f2)` lines of a unit (or all). */
const objectives = (text: string, unit?: string): { id: string; unit: string; facts: string[] }[] =>
  lines(text)
    .map((l) => /^- ((u\d+)-o\d+) \[\w+\] .* \(facts: ([^)]*)\)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && (!unit || m[2] === unit))
    .map((m) => ({ id: m[1]!, unit: m[2]!, facts: m[3]!.split(',').map((f) => f.trim()) }))

export function installAuthor(env: ResearchEnv, o: AuthorOptions = {}): Author {
  const calls: string[] = []
  const criticImages: number[] = []
  const log = (s: string) => calls.push(s)
  const on = (role: string, fn: (text: string, req: ChatRequest) => unknown) => env.mock.on({ role }, (req) => out(fn(userText(req), req)))

  on('director', (t) => {
    if (t.includes('A pipeline run has finished')) {
      log('director/summarize_run')
      return { summary: 'The course was built and published. Nothing failed.', redo: [] }
    }
    log('director/plan_brief')
    const n = Number(grab(t, /exactly (\d+) unit/)) || 2
    const topic = grab(t, /^Topic: (.*)$/m)
    return {
      title: `${topic}: a short course`,
      summary: `Learn the main ideas of ${topic}.`,
      units: Array.from({ length: n }, (_, i) => ({ title: `Part ${i + 1} of ${topic}`, focus: `The ${i + 1}. part of ${topic}.` })),
      research: Array.from({ length: n }, (_, i) => Array.from({ length: Number(grab(t, /(\d+) questions per unit at most/)) || 2 }, (_, j) => j + 1).map((j) => ({ question: `What are the key facts number ${j} of part ${i + 1} of ${topic}?`, unit: i + 1 }))).flat()
    }
  })

  on('curriculum-designer', (t) => {
    log('curriculum-designer/curriculum')
    const units = lines(t).filter((l) => /^\d+\. .+: /.test(l))
    const per = Number(grab(t, /(\d+) objective\(s\) in each/)) || 2
    const facts = lines(t).map((l) => /^\[(f\d+)\]/.exec(l)?.[1]).filter((f): f is string => !!f)
    let k = 0
    return {
      units: units.map((l, i) => ({ id: `u${i + 1}`, title: l.replace(/^\d+\. /, '').split(': ')[0], summary: `What part ${i + 1} covers.`, requires: i === 0 ? [] : [`u${i}`] })),
      objectives: units.flatMap((_, i) =>
        Array.from({ length: per }, (_, j) => ({ id: `u${i + 1}-o${j + 1}`, unit: `u${i + 1}`, bloom: j === 0 ? 'remember' : 'understand', text: `Explain point ${j + 1} of part ${i + 1}.`, facts: [facts[k++ % facts.length]!, facts[k % facts.length]!] }))
      )
    }
  })

  on('language-coach', (t) => {
    if (t.includes('Widen the accepted answers')) {
      log('language-coach/accepted')
      return { answers: lines(t).map((l) => /^(\S+): .* -> (.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ ref: m[1]!, accepted: [m[2]!, `${m[2]}!`] })) }
    }
    log('language-coach/scope')
    return { units: lines(t).map((l) => /^- (u\d+): /.exec(l)?.[1]).filter((u): u is string => !!u).map((u) => ({ unit: u, vocabulary: [{ term: 'bok', gloss: 'hello' }], grammar: [] })) }
  })

  on('subject-expert', (t) => {
    const unit = grab(t, /Unit (u\d+)/)
    if (t.includes('sent some articles of a learning course back')) {
      log(`subject-expert/articles_revise:${unit}`)
      const a = JSON.parse(grab(t, /The articles as they are now \(JSON\):\n([\s\S]*?)\n\nThe problems/)) as { id: string; body: string }[]
      return { articles: a.map((x) => ({ ...x, body: `${x.body}\n\nA checked sentence [${/\[(f\d+)\]/.exec(x.body)?.[1] ?? 'f1'}].` })) }
    }
    log(`subject-expert/articles:${unit}`)
    const prefix = grab(t, /Use the ids (\S+?)1,/)
    const n = Number(grab(t, /Write exactly (\d+) article/)) || 1
    const facts = objectives(t, unit).flatMap((x) => x.facts)
    const cite = (i: number) => `[${facts[i % facts.length]}]`
    return { articles: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, unit, title: `About ${unit} number ${i + 1}`, body: `The first thing to know is this one ${cite(0)}. Here is a second claim about the same topic ${cite(1)}.\n\nA third paragraph adds one more point for the reader ${cite(2)}.`, related: [] })) }
  })

  const makeItems = (t: string, unit: string, per: number, kinds: string[]): unknown[] => {
    const prefix = grab(t, /Ids: (\S+?)1,/)
    let n = 0
    const items: unknown[] = []
    for (const ob of objectives(t, unit)) {
      const order = ['mcq', 'true-false', 'typed', 'cloze', 'flashcard'].filter((k) => kinds.includes(k))
      for (let i = 0; i < per; i++) {
        const kind = order[i % order.length]!
        const id = `${prefix}${++n}`
        const common = { id, objective: ob.id, kind, explanation: `Because the fact says so (${id}).`, facts: [ob.facts[0]!], difficulty: 1 + (n % 4) }
        if (kind === 'mcq') items.push({ ...common, prompt: `Which statement is right about ${ob.id} (${id})?`, options: [{ id: 'a', text: `The right statement ${id}` }, { id: 'b', text: `A wrong statement ${id}` }, { id: 'c', text: `Another wrong statement ${id}` }], answer: 'a' })
        else if (kind === 'true-false') items.push({ ...common, prompt: `The fact about ${ob.id} is true (${id}).`, answer: true })
        else if (kind === 'typed') items.push({ ...common, prompt: `Type the key word of ${ob.id} (${id}).`, accepted: [`word${n}`] })
        else if (kind === 'cloze') items.push({ ...common, prompt: 'Fill the gap.', text: `The key word of ${ob.id} is {{g1}}.`, gaps: [{ id: 'g1', accepted: [`word${n}`], bank: [`word${n}`, `other${n}`, `third${n}`] }] })
        else items.push({ ...common, prompt: `Key term ${n}`, back: `The meaning of term ${n}` })
      }
    }
    return items
  }

  on('item-writer', (t) => {
    const unit = grab(t, /Unit (u\d+)/)
    if (t.includes('sent some questions of a learning game back')) {
      log(`item-writer/items_revise:${unit}`)
      return { items: jsonLines(t).map((i) => ({ ...i, prompt: `${String(i.prompt)} (corrected)` })) }
    }
    log(`item-writer/items:${unit}`)
    const per = Number(grab(t, /At least (\d+) items for each objective/)) || 3
    const kinds = grab(t, /The kinds you may use: ([^\n]*)\./).split(',').map((k) => k.trim())
    const items = makeItems(t, unit, per, kinds)
    const taught = /empty otherwise\): \S/.test(t)
    return { items: taught ? (items as Record<string, unknown>[]).map((i) => ({ ...i, taught: true })) : items }
  })

  on('misconception-designer', (t) => {
    const unit = grab(t, /Unit (u\d+)/)
    log(`misconception-designer/distractors:${unit}`)
    return {
      items: jsonLines(t).map((i) => {
        if (i.kind === 'true-false') return { id: i.id, why: 'Learners often think the opposite is true.' }
        const opts = i.options as { id: string; text: string; why?: string }[]
        const right = i.kind === 'mcq' ? [i.answer] : (i.answers as string[])
        return { id: i.id, options: [...opts.map((x) => (right.includes(x.id) ? { id: x.id, text: x.text } : { id: x.id, text: x.text, why: x.why ?? `A real misconception about ${String(i.id)}.` })), ...(opts.filter((x) => !right.includes(x.id)).length < 2 ? [{ id: 'd1', text: `Added wrong choice ${String(i.id)}`, why: 'A common slip.' }] : [])] }
      })
    }
  })

  on('fact-checker', (t) => {
    const unit = grab(t, /Item (u\d+)-q/) ? `u${grab(t, /### Item u(\d+)-q/)}` : ''
    const round = Number(grab(t, /review round (\d+)/)) || 1
    log(`fact-checker/fact_check:${unit}:k${round}`)
    const verdict = o.factCheck?.(unit, round) ?? 'pass'
    const first = grab(t, /### Item (\S+)/)
    return verdict === 'pass' ? { verdict, scores: { accuracy: 9 }, notes: 'Everything rests on a fact.', problems: [] } : { verdict, scores: { accuracy: 4 }, notes: 'One answer key is wrong.', problems: [{ ref: first, issue: 'the answer key does not match the fact', fix: 'fix the key', severity: 'major' }] }
  })

  on('explainer', (t) => {
    if (t.includes('A reviewer flagged some texts')) {
      log('explainer/polish')
      const strings = JSON.parse(grab(t, /\(JSON: key -> text\):\n([\s\S]*?)\n\nThe problems/)) as Record<string, string>
      return { strings: Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, `${v} (polished)`])) }
    }
    const unit = grab(t, /Unit (u\d+)/)
    log(`explainer/explain:${unit}`)
    const items = jsonLines(t)
    return { items: items.map((i, n) => ({ id: i.id, explanation: `Here is why: ${String(i.prompt).slice(0, 40)} rests on its fact.`, hint: 'Think of the fact.', ...(n === 0 ? { didYouKnow: 'A surprising extra.', didYouKnowFact: (i.facts as string[])[0] } : {}) })) }
  })

  on('game-designer', (t) => {
    log('game-designer/design')
    const rows = lines(t).map((l) => /^(u\d+-q\d+) (\S+) (\d)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    return { shells: ['quiz-arena', 'rpg'], quizArena: { roundLength: 5, bossLength: 6, timerSeconds: 30 }, difficulty: rows.map((m) => ({ item: m[1], difficulty: Number(m[3]) })), notes: 'Short rounds.' }
  })

  on('narrative-designer', (t) => {
    if (t.includes('longer story, written by Scriptorium')) {
      log('narrative-designer/scriptorium_brief')
      return { idea: 'A scribe travels across the empire and learns its secrets.', audience: 'teenagers', length: 'a short story of about 2000 words' }
    }
    log('narrative-designer/frame')
    const units = lines(t).map((l) => /^- (u\d+): /.exec(l)?.[1]).filter((u): u is string => !!u)
    return { premise: 'You are a young scribe.', characters: [{ name: 'Livia', role: 'the guide', description: 'An old scribe.' }], intro: 'Livia hands you a scroll.', outro: 'You deliver the scroll.', unitBeats: units.map((u) => ({ unit: u, beat: `Beat of ${u}.` })) }
  })

  const review = (role: string, dims: Record<string, number>) =>
    on(role, (t) => {
      const round = Number(grab(t, /review round (\d+)/)) || 1
      log(`${role}/review:k${round}`)
      const verdict = o.review?.(role, round) ?? 'pass'
      const key = /^\s*\[([^\]]+)\] (?:prompt|explanation): /m.exec(t)?.[1] ?? 'item.u1-q1.expl'
      return verdict === 'pass'
        ? { verdict, scores: dims, notes: 'Fine for the audience.', problems: [] }
        : { verdict, scores: Object.fromEntries(Object.keys(dims).map((k) => [k, 4])), notes: 'A text must change.', problems: [{ ref: key, issue: 'the wording is too hard', fix: 'use plainer words', severity: 'major' }] }
    })
  review('accessibility-reviewer', { accessibility: 9, readability: 9 })
  review('child-safety-reviewer', { age_fit: 9 })

  // the art-director plans one picture per article and per required slot, and one picture for the first question; the prompt lists them (see seed/prompts/art-director/plan.md)
  let artCalls = 0
  on('art-director', (t) => {
    artCalls++
    log('art-director/plan')
    const articles = lines(t).map((l) => /^- (a-u\d+-\d+) \(unit/.exec(l)?.[1]).filter((x): x is string => !!x)
    const slots = lines(t).map((l) => /^- shell (\S+), slot (\S+) \(/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    const flash = lines(t).map((l) => /^- (u\d+-q\d+) \((?:flashcard|mcq)/.exec(l)?.[1]).filter((x): x is string => !!x)[0] // the first question a picture could go with
    const bad = o.artPlan === 'unusable' || (o.artPlan === 'repair' && artCalls === 1)
    const images = [
      ...articles.map((id) => ({ for: 'article', id: bad ? 'no-such-article' : id, prompt: `A clear picture that shows the main idea of the article ${id}, a simple scene with one subject`, alt: `A picture for article ${id}` })),
      ...slots.map((m) => ({ for: 'shell', shell: m[1], slot: m[2], prompt: `The scene for ${m[1]} ${m[2]}: an empty place that fits the topic, soft light`, alt: `The art of ${m[1]} ${m[2]}` })),
      ...(flash ? [{ for: 'item', id: flash, prompt: `A friendly picture that helps to remember the question ${flash}`, alt: `A picture for the question ${flash}` }] : [])
    ]
    return { images, notes: 'Soft flat colours.' }
  })

  on('art-critic', (t, req) => {
    criticImages.push(req.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content)).filter((p) => p.type === 'image').length)
    const id = grab(t, /Asset: (\S+) \(/)
    const round = Number(grab(t, /It is round (\d+)/)) || 1
    log(`art-critic/review:${id}:k${round}`)
    const verdict = o.artReview?.(id, round) ?? 'pass'
    return verdict === 'pass'
      ? { verdict, scores: { relevance: 9, clarity: 9 }, notes: 'It shows what it should.', problems: [] }
      : { verdict, scores: { relevance: 4, clarity: 5 }, notes: 'The subject is not clear.', problems: [{ ref: id, issue: 'the subject is too small', fix: 'show the subject large in the middle', severity: 'major' }] }
  })

  // the composer plans one track per area the prompt lists and a sound effect for each event (see seed/prompts/composer/plan.md)
  let musicCalls = 0
  const SFX_SOUND: Record<string, string> = { correct: 'coin', wrong: 'cancel', combo: 'magic', 'level-up': 'powerup', boss: 'alert' }
  on('composer', (t) => {
    musicCalls++
    log('composer/plan')
    const areas = lines(t).map((l) => /^- (\S+) \((?:chiptune|comfy|flow)\): /.exec(l)?.[1]).filter((x): x is string => !!x)
    const events = lines(t).map((l) => /^- (correct|wrong|combo|level-up|boss)(?: \(REQUIRED\))?: /.exec(l)?.[1]).filter((x): x is string => !!x)
    if (o.musicPlan === 'unusable' || (o.musicPlan === 'repair' && musicCalls === 1)) return { music: [{ area: 'no-such-area', mood: 'calm', prompt: 'calm instrumental music', alt: 'x' }], sfx: [] }
    const units = areas.filter((a) => a.startsWith('unit-'))
    const merge = o.musicPlan === 'merge'
    return {
      music: areas
        .filter((a) => !merge || !units.slice(1).includes(a))
        .map((area) => ({
          area,
          ...(merge && area === units[0] ? { units: units.slice(1).map((u) => u.slice(5)) } : {}),
          mood: area === 'boss' || area === 'rpg-battle' ? 'mysterious-calm' : 'peaceful',
          prompt: `calm instrumental, soft piano and strings, slow tempo, for the area ${area}`,
          alt: `The music of ${area}`,
          seconds: 60
        })),
      sfx: events.map((event) => ({ event, sound: SFX_SOUND[event], alt: `The sound of ${event}` })),
      notes: 'Soft and slow.'
    }
  })

  on('playtester', () => {
    log('playtester/report')
    return o.report === 'revise'
      ? { verdict: 'revise', scores: { flow: 4, difficulty: 4 }, notes: 'Slow.', problems: [], deadEnds: ['somewhere'] }
      : { verdict: 'pass', scores: { flow: 9, difficulty: 8 }, notes: 'Smooth.', problems: [], deadEnds: [] }
  })

  on('publisher', () => {
    log('publisher/publish')
    return { blurb: 'Learn the main ideas in short, friendly rounds.', notes: 'Good.' }
  })

  return { calls, count: (prefix) => calls.filter((c) => c.startsWith(prefix)).length, criticImages }
}

/** A search provider's pages for any question: two pages with their own text. */
export const pagesForQuestion = (q: string) => {
  const h = createHash('sha1').update(q).digest('hex').slice(0, 6)
  return [1, 2].map((n) => ({ url: `https://example.test/${h}-${n}`, title: `Source ${h} part ${n}`, content: `Point ${n} of ${q.slice(0, 40)} is a fact worth knowing in the year ${1900 + n}. It was recorded carefully by people who studied it for a long time. `.repeat(4), inline: true }))
}

export const OK_PLAYTEST: PlaytestResult = {
  ok: true,
  durationMs: 1,
  failures: [],
  runs: [{ persona: 'perfect', mode: 'perfect', code: 0, ok: true, summary: { mode: 'perfect', seed: 1, steps: 20, correct: 20, wrong: 0, screens: ['title', 'end'], finished: true, consoleErrors: 0, maxSteps: 100, ok: true, failures: [] }, failures: [] }]
}

export interface PipelineEnvOptions extends AuthorOptions {
  research?: Partial<ResearchEnvOptions>
  engine?: Partial<EngineOptions>
  playtest?: EngineOptions['playtest']
  mixed?: boolean
  /** A vision model for the art-critic: without it the critic is skipped. */
  vision?: boolean
  /** Pixel Studio, Chiptune Studio and Google Flow are fakes (default: yes in a pipeline env, so no test reaches a real one). Set false to make the real clients. */
  studios?: boolean
}

export type PipelineEnv = ResearchEnv & { author: Author }

/** An engine with the mock team, a fake search, a fake playtest runner and the scripted author. */
export async function makePipelineEnv(o: PipelineEnvOptions = {}): Promise<PipelineEnv> {
  const env = await makeResearchEnv({ pagesFor: pagesForQuestion, ...(o.research ?? {}), ...(o.mixed ? { mixed: true } : {}), ...(o.vision ? { vision: true } : {}), studios: o.studios !== false, engine: { playtest: o.playtest ?? (async () => OK_PLAYTEST), ...(o.engine ?? {}) } })
  env.engine.factory = { ...env.engine.factory, max_attempts: 1 }
  const author = installAuthor(env, o)
  return Object.assign(env, { author })
}

export const BRIEF: BriefInput = { topic: 'The Roman Empire', audience: 'teenagers', age: 14, sourceLang: 'en', units: 2, story: 'none' }

/** The MCP tools of the env, and a caller. */
export function toolsOf(env: ResearchEnv) {
  const tools = buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(tools, name, args)
    return { ok: !r.isError, text: r.content[0].text, data: (r.isError ? { error: r.content[0].text } : r.structuredContent) as Record<string, unknown> }
  }
  return { tools, call }
}

export const courseFile = (env: ResearchEnv, slug: string, ...p: string[]): string => path.join(env.dir, 'courses', slug, ...p)

export const SLUG = 'the-roman-empire'
export const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T
export const pf = (env: PipelineEnv, ...p: string[]) => courseFile(env, SLUG, 'pipeline', ...p)
export const pipelineOf = async (env: PipelineEnv) => (await toolsOf(env).call('edu_status', { slug: SLUG })).data.pipeline as { run: number; stage: string; steps: { step: string; status: string; note?: string; job?: string }[]; blockedBy?: string[]; failed?: { step: string; failure: string }[]; next: string }
export const statusOf = (p: { steps: { step: string; status: string }[] }, key: string) => p.steps.find((s) => s.step === key)?.status

/** Starts the run from the brief and waits until nothing is left to do. */
export async function run(env: PipelineEnv, brief: Record<string, unknown> = BRIEF, ms = 60_000) {
  const { call } = toolsOf(env)
  const started = await call('edu_run_pipeline', { brief })
  expect(started.ok, started.text).toBe(true)
  const slug = started.data.slug as string
  const w = await waitIdle(env, slug, ms)
  return { started: started.data, failed: w.failed, slug }
}

