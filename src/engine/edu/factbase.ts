import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import { parseNoteFacts } from '../research/notes'
import type { NoteFile, ResearchStore } from '../research/notes'
import { writeMd } from '../store/atomic'
import { assertSlug, coursesDir } from './paths'

/**
 * The fact base of a course, in `courses/<slug>/factbase/`:
 * `sources.md` (the numbered sources, numbers never change), `facts.md` (the facts with stable ids `f1`, `f2` ...) and `merged.md` (the
 * research notes already merged). Writers cite a fact as `[f3]` in the text they write (the assembly turns those into numbers and into the
 * pack's `factbase`); `[3]` is a source number. The researcher writes notes, `mergeNotes` turns the new ones into facts.
 */

/** One numbered source. */
export interface SourceEntry {
  n: number
  url: string
  title: string
  retrieved: string
}

export interface Fact {
  /** `f1`, `f2` ...: never reused, never renumbered. */
  id: string
  /** The claim in one sentence, in the researcher's own words. */
  fact: string
  /** Source numbers (see `SourceEntry`). Empty only for an unverified fact. */
  sources: number[]
  /** The research note it came from. */
  note: string
  /** What it is about: the question of the note. */
  topic?: string
  /** From the model's own knowledge: no source. Only kept when `allow_unverified_facts` is set. */
  unverified?: boolean
}

export interface FactBaseView {
  facts: Fact[]
  sources: SourceEntry[]
  /** The notes already merged. */
  merged: string[]
  /** The notes of the course (merged or not). */
  notes: number
  /** Notes not merged yet (unverified notes wait here while `allow_unverified_facts` is false). */
  pendingNotes: string[]
}

export interface MergeResult {
  added: Fact[]
  /** Facts that repeat a fact already there (their sources were added to it). */
  duplicates: number
  /** Unverified facts left out because `allow_unverified_facts` is false. */
  skippedUnverified: number
  /** The notes read (merged now). */
  merged: string[]
}

/** The fact entries of a pack (`pack.factbase`) and the catalog strings of their claims. */
export interface FactPack {
  factbase: { id: string; claim: string; source: string; url?: string }[]
  strings: Record<string, string>
}

const CITED_FACTS = /\[(f\d{1,4}(?:\s*[,;]\s*f\d{1,4})*)\]/g
const CITED_NUMBERS = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g

/** `[f3]`, `[f3, f5]` and `[f3][f5]` in a text: the fact ids it cites, in order of first use. */
export function citedFactIds(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(CITED_FACTS)) for (const id of m[1]!.split(/[,;]/)) if (!out.includes(id.trim())) out.push(id.trim())
  return out
}

/** `[3]`, `[3, 4]` and `[3][4]` in a text: the source numbers it cites, ascending. */
export function citedNumbers(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(CITED_NUMBERS)) for (const x of m[1]!.split(/[,;]/)) out.add(Number(x))
  return [...out].sort((a, b) => a - b)
}

/** Facts as prompt lines: `[f3] claim (sources [1][4])`. An unverified fact says so. */
export function factLines(facts: Fact[]): string {
  return facts.map((f) => `[${f.id}] ${f.fact} ${f.sources.length ? `(sources ${f.sources.map((s) => `[${s}]`).join('')})` : '(unverified, no source)'}`).join('\n')
}

/** The numbered sources as lines: `[3] Title. URL`. */
export function sourceLines(list: SourceEntry[], only?: Iterable<number>): string {
  const keep = only ? new Set(only) : null
  return list
    .filter((s) => !keep || keep.has(s.n))
    .map((s) => `[${s.n}] ${s.title ? `${s.title}. ` : ''}${s.url}`)
    .join('\n')
}

/** Text compared for duplicates: lower-case letters and digits, one space between words. */
export const normaliseFact = (text: string): string => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')

const factNumber = (id: string): number => Number(id.slice(1)) || 0

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface FactBaseOptions {
  /** True: unverified facts (no source) are merged too. `config/factory.md` `allow_unverified_facts`. */
  allowUnverified: () => boolean
}

export class FactBase {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dataDir: string,
    private readonly store: ResearchStore,
    private readonly opts: FactBaseOptions
  ) {}

  dir(slug: string): string {
    return path.join(coursesDir(this.dataDir), assertSlug(slug), 'factbase')
  }

  private async readDoc(slug: string, name: string): Promise<Record<string, unknown>> {
    try {
      return parseMd(await fs.readFile(path.join(this.dir(slug), name), 'utf8')).data
    } catch {
      return {}
    }
  }

  async sources(slug: string): Promise<SourceEntry[]> {
    const raw = (await this.readDoc(slug, 'sources.md')).sources
    return Array.isArray(raw)
      ? (raw as Record<string, unknown>[]).filter((s) => s && typeof s.url === 'string' && Number.isFinite(Number(s.n))).map((s) => ({ n: Number(s.n), url: String(s.url), title: String(s.title ?? ''), retrieved: String(s.retrieved ?? '') }))
      : []
  }

  async facts(slug: string): Promise<Fact[]> {
    const raw = (await this.readDoc(slug, 'facts.md')).facts
    if (!Array.isArray(raw)) return []
    return (raw as Record<string, unknown>[])
      .filter((f) => f && typeof f.id === 'string' && typeof f.fact === 'string')
      .map((f) => ({
        id: String(f.id),
        fact: String(f.fact),
        sources: Array.isArray(f.sources) ? f.sources.map(Number).filter(Number.isFinite) : [],
        note: String(f.note ?? ''),
        ...(typeof f.topic === 'string' && f.topic ? { topic: f.topic } : {}),
        ...(f.unverified === true ? { unverified: true } : {})
      }))
  }

  /** The notes (files) whose facts are in the fact base. */
  async merged(slug: string): Promise<Set<string>> {
    const raw = (await this.readDoc(slug, 'merged.md')).notes
    return new Set(Array.isArray(raw) ? (raw as unknown[]).map(String) : [])
  }

  private async exclusive<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.locks.set(slug, next.catch(() => undefined))
    return next
  }

  /**
   * Adds the facts of the course's research notes that are not merged yet. A fact that repeats one already there (the same words, ignoring
   * case and punctuation) adds its source to that fact instead of a new one. New facts get the next ids (`f<max+1>`), new sources the next
   * numbers, so ids and numbers already cited never change. An unverified fact (a note without sources) is only merged when
   * `allow_unverified_facts` is set; its note stays pending so a later change of the setting picks it up.
   */
  mergeNotes(slug: string): Promise<MergeResult> {
    return this.exclusive(slug, async () => {
      const notes = await this.store.list(slug)
      const merged = await this.merged(slug)
      const facts = await this.facts(slug)
      const sources = await this.sources(slug)
      const result: MergeResult = { added: [], duplicates: 0, skippedUnverified: 0, merged: [] }
      const allow = this.opts.allowUnverified()
      let nextId = Math.max(0, ...facts.map((f) => factNumber(f.id))) + 1
      const bySource = new Map(sources.map((s) => [s.url, s.n]))
      const known = new Map(facts.map((f) => [normaliseFact(f.fact), f]))
      let sourcesChanged = false
      let factsChanged = false
      const sourceNumber = (note: NoteFile, url: string): number => {
        const have = bySource.get(url)
        if (have !== undefined) return have
        const n = Math.max(0, ...sources.map((s) => s.n)) + 1
        const meta = note.sources.find((s) => s.url === url)
        sources.push({ n, url, title: meta?.title ?? '', retrieved: meta?.retrieved ?? note.created })
        bySource.set(url, n)
        sourcesChanged = true
        return n
      }
      for (const note of notes) {
        if (merged.has(note.file)) continue
        let pending = false
        for (const pf of parseNoteFacts(note)) {
          const unverified = note.unverified || !pf.url
          if (unverified && !allow) {
            result.skippedUnverified++
            pending = true
            continue
          }
          const key = normaliseFact(pf.fact)
          if (!key) continue
          const n = pf.url ? sourceNumber(note, pf.url) : undefined
          const dup = known.get(key)
          if (dup) {
            result.duplicates++
            if (n !== undefined && !dup.sources.includes(n)) {
              dup.sources.push(n)
              if (dup.unverified) delete dup.unverified // a sourced note confirms an unverified fact
              factsChanged = true
            }
            continue
          }
          const fact: Fact = { id: `f${nextId++}`, fact: pf.fact, sources: n !== undefined ? [n] : [], note: note.file, topic: note.question, ...(unverified ? { unverified: true } : {}) }
          facts.push(fact)
          known.set(key, fact)
          result.added.push(fact)
          factsChanged = true
        }
        if (!pending) {
          merged.add(note.file)
          result.merged.push(note.file)
        }
      }
      if (sourcesChanged) await this.writeSources(slug, sources)
      if (factsChanged) await this.writeFacts(slug, facts)
      if (result.merged.length) await this.writeMerged(slug, merged)
      return result
    })
  }

  private writeSources(slug: string, list: SourceEntry[]): Promise<void> {
    return writeMd(
      path.join(this.dir(slug), 'sources.md'),
      { kind: 'factbase', part: 'sources', sources: list },
      `\n# Sources\n\nThe numbers are cited in square brackets. They never change once given.\n\n${list.map((s) => `${s.n}. ${s.title ? `${s.title}. ` : ''}${s.url} (retrieved ${s.retrieved})`).join('\n')}\n`
    )
  }

  private writeFacts(slug: string, facts: Fact[]): Promise<void> {
    return writeMd(
      path.join(this.dir(slug), 'facts.md'),
      { kind: 'factbase', part: 'facts', facts },
      `\n# Facts\n\nEach fact has a stable id and the numbers of its sources (see sources.md). Text cites a fact as [f3].\n\n${factLines(facts) || '(no facts yet)'}\n`
    )
  }

  private writeMerged(slug: string, merged: Set<string>): Promise<void> {
    const list = [...merged].sort()
    return writeMd(path.join(this.dir(slug), 'merged.md'), { kind: 'factbase', part: 'merged', notes: list }, `\n# Merged research notes\n\nThe notes whose facts are in this fact base.\n\n${list.map((f) => `- ${f}`).join('\n')}\n`)
  }

  /** The fact base as it is now (merge first with `mergeNotes`). */
  async get(slug: string): Promise<FactBaseView> {
    const [facts, sources, merged, notes] = await Promise.all([this.facts(slug), this.sources(slug), this.merged(slug), this.store.list(slug)])
    return { facts, sources, merged: [...merged].sort(), notes: notes.length, pendingNotes: notes.filter((n) => !merged.has(n.file)).map((n) => n.file) }
  }

  /**
   * The facts as the course pack wants them: `pack.factbase` entries `{id, claim: 'fact.<id>.claim', source, url}` and the catalog strings
   * of the claims. The pack allows one source per fact: the first one (the other source numbers stay in `facts.md`).
   */
  async toPack(slug: string): Promise<FactPack> {
    const [facts, sources] = await Promise.all([this.facts(slug), this.sources(slug)])
    const byN = new Map(sources.map((s) => [s.n, s]))
    const out: FactPack = { factbase: [], strings: {} }
    for (const f of facts) {
      const src = f.sources.map((n) => byN.get(n)).find(Boolean)
      const key = `fact.${f.id}.claim`
      out.factbase.push({ id: f.id, claim: key, source: src ? src.title || hostOf(src.url) : 'unverified (the researcher\'s own knowledge)', ...(src && /^https?:\/\//.test(src.url) ? { url: src.url } : {}) })
      out.strings[key] = f.fact
    }
    return out
  }
}
