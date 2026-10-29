import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { assertSlug, coursesDir } from '../edu/paths'
import { writeMd } from '../store/atomic'

/** Lowercase words of a question: the key under which notes and research jobs are matched. "How long did it take?" and "how long did it take" are one question. */
export function questionKey(question: string): string {
  return (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
}

export const questionHash = (question: string): string => createHash('sha1').update(questionKey(question)).digest('hex').slice(0, 8)

/**
 * The id of the research job for a question: `<slug>--research--q<hash>--r0`. It starts with the course slug (so `edu_status` counts it),
 * and the same question for the same course is always the same job.
 */
export const researchJobId = (slug: string, question: string): string => `${slug}--research--q${questionHash(question)}--r0`

export interface NoteFact {
  fact: string
  /** Where it came from. Missing for facts from the model's own knowledge (those notes are `unverified`). */
  source?: { url: string; title?: string }
}

/** A sentence of a page kept word for word, with its page: what the researcher's notes may lack (a date, a figure) stays in front of the writers. */
export interface NoteExcerpt {
  text: string
  url: string
}

export interface NoteFile {
  /** Path relative to the data folder, forward slashes. */
  file: string
  /** The course it belongs to, or null for a shared note (`research/`). */
  course: string | null
  /** The number in the file name (`<n>-<question-slug>.md`). */
  n: number
  slug: string
  question: string
  unverified: boolean
  body: string
  created: string
  /** The pages the facts come from (empty for unverified notes). */
  sources: { url: string; title: string; retrieved: string }[]
}

/** A fact as the researcher wrote it into a note's body. */
export interface ParsedFact {
  fact: string
  url?: string
  unverified: boolean
}

const stampOf = (d = new Date()) => d.toISOString().slice(0, 10)

/** The heading of the verbatim sentences at the end of a note. */
export const EXCERPTS_HEADING = '## Source excerpts (verbatim, for checking)'

/** `- <fact> (source: <url>, <date>)` and `- <fact> (source: none, the model's own knowledge, <date>; unverified)`: the facts of a note, in order. */
export function parseNoteFacts(note: Pick<NoteFile, 'body'>): ParsedFact[] {
  const at = note.body.indexOf(EXCERPTS_HEADING)
  const text = at >= 0 ? note.body.slice(0, at) : note.body
  const out: ParsedFact[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('- ')) continue
    const m = /^- (.*?)\s*\(source: (?:(none)[^)]*|(\S+?), \d{4}-\d{2}-\d{2})\)\s*$/.exec(line)
    if (m) {
      const fact = m[1]!.replace(/\s+/g, ' ').trim()
      if (fact) out.push({ fact, ...(m[3] ? { url: m[3] } : {}), unverified: !m[3] })
    } else {
      const fact = line.slice(2).replace(/\s+/g, ' ').trim()
      if (fact) out.push({ fact, unverified: true }) // a line a person added without a source is not a sourced fact
    }
  }
  return out
}

/**
 * Research notes as markdown files: `courses/<slug>/research/<n>-<question-slug>.md` for a course and `research/<n>-<question-slug>.md` for
 * notes every course may use. Notes are found by their question (the exact words) or by the words they share with a query: the edu engine
 * has no embedding index.
 */
export class ResearchStore {
  constructor(private readonly dataDir: string) {}

  dirFor(course: string | null): string {
    return course ? path.join(coursesDir(this.dataDir), assertSlug(course), 'research') : path.join(this.dataDir, 'research')
  }

  relDir(course: string | null): string {
    return course ? `courses/${assertSlug(course)}/research` : 'research'
  }

  private async readNote(course: string | null, name: string): Promise<NoteFile | null> {
    try {
      const doc = parseMd(await fs.readFile(path.join(this.dirFor(course), name), 'utf8'))
      const m = /^(\d+)-(.*)\.md$/.exec(name)
      return {
        file: `${this.relDir(course)}/${name}`,
        course,
        n: m ? Number(m[1]) : 0,
        slug: m ? m[2]! : name.replace(/\.md$/, ''),
        question: String(doc.data.question ?? name),
        unverified: doc.data.unverified === true,
        body: doc.body.trim(),
        created: String(doc.data.created ?? ''),
        sources: (Array.isArray(doc.data.sources) ? (doc.data.sources as Record<string, unknown>[]) : [])
          .filter((x) => x && typeof x.url === 'string')
          .map((x) => ({ url: String(x.url), title: String(x.title ?? ''), retrieved: String(x.retrieved ?? doc.data.created ?? '') }))
      }
    } catch {
      return null
    }
  }

  /** The notes of one scope, by number. */
  async list(course: string | null): Promise<NoteFile[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dirFor(course))).filter((f) => f.endsWith('.md') && /^\d+-/.test(f))
    } catch {
      return []
    }
    const out: NoteFile[] = []
    for (const name of names) {
      const note = await this.readNote(course, name)
      if (note) out.push(note)
    }
    return out.sort((a, b) => a.n - b.n || a.file.localeCompare(b.file))
  }

  /** The notes a course can use: its own, then the shared ones. */
  async available(course: string | null): Promise<NoteFile[]> {
    return [...(course ? await this.list(course) : []), ...(await this.list(null))]
  }

  /** A note that answers exactly this question (same words), in the course's notes first, then the shared notes. */
  async findExact(question: string, course: string | null): Promise<NoteFile | null> {
    const key = questionKey(question)
    if (!key) return null
    for (const scope of course ? [course, null] : [null]) {
      const hit = (await this.list(scope)).find((n) => questionKey(n.question) === key)
      if (hit) return hit
    }
    return null
  }

  /** The next free file name inside one folder: `<n>-<question-slug>.md`. */
  private async freeName(course: string | null, question: string): Promise<string> {
    const taken = (await this.list(course)).map((n) => n.n)
    const n = Math.max(0, ...taken) + 1
    const slug = questionKey(question).replace(/ /g, '-').slice(0, 56).replace(/-+$/, '') || 'note'
    return `${n}-${slug}.md`
  }

  /**
   * Writes a note. The facts are in the researcher's own words, one per line, each with its source URL and the date it was read.
   * `unverified: true` marks notes that come from the model's own knowledge.
   */
  async write(o: { question: string; course: string | null; facts: NoteFact[]; unverified: boolean; askedBy: string; purpose?: string; provider?: string; excerpts?: NoteExcerpt[]; from?: string; now?: Date }): Promise<NoteFile> {
    const date = stampOf(o.now)
    const name = await this.freeName(o.course, o.question)
    const sources = [...new Map(o.facts.filter((f) => f.source).map((f) => [f.source!.url, { url: f.source!.url, title: f.source!.title ?? '', retrieved: date }])).values()]
    const lines = o.facts.map((f) => `- ${f.fact.replace(/\s+/g, ' ').trim()} ${f.source ? `(source: ${f.source.url}, ${date})` : `(source: none, the model's own knowledge, ${date}; unverified)`}`)
    const excerpts = (o.excerpts ?? []).slice(0, 4).map((x) => `- "${x.text.replace(/\s+/g, ' ').replace(/"/g, "'").trim().slice(0, 300)}" (source: ${x.url}, ${date})`)
    const body = `\n# ${o.question.replace(/\s+/g, ' ').trim()}\n\n${o.unverified ? '**Unverified:** no web source was found. These facts come from the model\'s own knowledge. Treat them with suspicion.\n\n' : ''}${lines.join('\n')}\n${excerpts.length ? `\n${EXCERPTS_HEADING}\n\n${excerpts.join('\n')}\n` : ''}`
    await writeMd(
      path.join(this.dirFor(o.course), name),
      {
        kind: 'research',
        question: o.question.replace(/\s+/g, ' ').trim(),
        scope: o.course ? 'course' : 'shared',
        course: o.course,
        created: date,
        asked_by: o.askedBy,
        ...(o.purpose ? { purpose: o.purpose } : {}),
        ...(o.provider ? { provider: o.provider } : {}),
        ...(o.from ? { from: o.from } : {}),
        unverified: o.unverified,
        sources
      },
      body
    )
    return (await this.readNote(o.course, name))!
  }

  /**
   * Copies a shared note into a course (its facts and sources, marked `from`), so the course's fact base can merge it. Returns the course's
   * note; a course that already has a note for the question keeps it.
   */
  async adopt(course: string, note: NoteFile): Promise<NoteFile> {
    const have = (await this.list(course)).find((n) => questionKey(n.question) === questionKey(note.question))
    if (have) return have
    const facts = parseNoteFacts(note)
    const byUrl = new Map(note.sources.map((s) => [s.url, s]))
    const copy = await this.write({
      question: note.question,
      course,
      facts: facts.map((f) => ({ fact: f.fact, ...(f.url ? { source: { url: f.url, title: byUrl.get(f.url)?.title ?? '' } } : {}) })),
      unverified: note.unverified,
      askedBy: 'engine',
      purpose: `copied from the shared note ${note.file}`,
      from: note.file,
      now: note.created ? new Date(note.created) : undefined
    })
    return copy
  }
}

/** The note text a writer sees: the facts, framed as data. The source excerpts stay inside the cap, the facts give way. */
export function formatNote(n: NoteFile, maxChars = 2400): string {
  const body = n.body.replace(/^# .*\n+/, '').trim()
  const at = body.indexOf(EXCERPTS_HEADING)
  const facts = at >= 0 ? body.slice(0, at).trim() : body
  const excerpts = at >= 0 ? body.slice(at).trim() : ''
  const room = Math.max(600, maxChars - (excerpts ? excerpts.length + 2 : 0))
  const cut = facts.length > room ? facts.slice(0, room).replace(/\n[^\n]*$/, '') + '\n- (more facts in the file)' : facts
  return `### ${n.question}${n.unverified ? ' (unverified)' : ''}\n${cut}${excerpts ? `\n\n${excerpts}` : ''}`
}

export interface NoteHit {
  /** For the job log: `research: <question>`. */
  name: string
  /** The note, framed for the prompt. */
  text: string
  file: string
  note: NoteFile
}

/** The words of a text that carry meaning (no short words), for the keyword match. */
const wordsOf = (text: string): Set<string> => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).slice(0, 400))

/**
 * The notes of a course (and the shared ones) that share the most words with a query, best first. There is no embedding index in Edu
 * Studio: the match is on the words of the question and the note, so it finds notes about the same thing, not about similar things.
 */
export async function notesFor(store: ResearchStore, course: string | null, query: string, max = 4): Promise<NoteHit[]> {
  const notes = await store.available(course)
  if (notes.length === 0) return []
  const q = wordsOf(query)
  return notes
    .map((n) => ({ n, score: [...wordsOf(`${n.question} ${n.body}`)].filter((w) => q.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.n.file.localeCompare(b.n.file))
    .slice(0, max)
    .map(({ n }) => ({ name: `research: ${n.question}`, text: formatNote(n), file: n.file, note: n }))
}
