import { z } from 'zod'
import type { ChatMessage } from '../models/types'
import { chatJson } from '../pipeline/llm'
import { buildMessages } from '../pipeline/prompts'
import type { JobContext, Scheduler } from '../queue/scheduler'
import { notesFor } from './notes'
import type { NoteExcerpt, NoteFact } from './notes'
import type { ResearchService, SearchService } from './service'
import { excerptFor, searchTerms } from './web'
import type { SearchResult } from './web'

const isAbort = (err: unknown) => ['AbortError', 'BudgetError'].includes((err as Error)?.name)

/** Page text goes into the prompt only between these lines, and the text itself may not contain the delimiter characters. */
export function wrapUntrusted(pages: { n: number; url: string; title: string; text: string }[]): string {
  return pages
    .map((p) => {
      const clean = p.text.replace(/<{2,}|>{2,}/g, ' ').replace(/[ \t]+/g, ' ')
      const title = p.title.replace(/[<>\r\n]+/g, ' ').slice(0, 120)
      return `<<<WEB_PAGE ${p.n} | ${p.url} | ${title}>>>\n${clean}\n<<<END_WEB_PAGE ${p.n}>>>`
    })
    .join('\n\n')
}

/** True when a fact repeats a run of twelve or more words of the page word for word (the notes must be in the researcher's own words). */
export function copiesPage(fact: string, page: string, run = 12): boolean {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  const f = words(fact)
  if (f.length < run) return false
  const p = ` ${words(page).join(' ')} `
  for (let i = 0; i + run <= f.length; i++) if (p.includes(` ${f.slice(i, i + run).join(' ')} `)) return true
  return false
}

/** The most facts one note keeps. */
export const MAX_NOTE_FACTS = 16

/** A figure on a page that the notes do not have: the page, the figure and the sentence it stands in. */
export interface MissingFigure {
  page: number
  figure: string
  sentence: string
}

/**
 * Years (1800 to 2100) and numbers of two or more digits that stand in a sentence of a page about the question (the sentence or the one
 * next to it shares a word with the question) and in none of the facts. At most 10, each figure once.
 */
export function missingFigures(pages: { n: number; text: string }[], facts: string[], question: string): MissingFigure[] {
  const terms = searchTerms(question, 8).map((t) => t.toLowerCase())
  const plain = (s: string) => s.replace(/(?<=\d)[,\s](?=\d{3}\b)/g, '')
  const have = new Set(plain(facts.join(' ')).match(/\d+(?:\.\d+)?/g) ?? [])
  const out: MissingFigure[] = []
  const seen = new Set<string>()
  for (const p of pages) {
    const sentences = p.text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)
    sentences.forEach((s, i) => {
      const near = [sentences[i - 1], s, sentences[i + 1]].filter(Boolean).join(' ').toLowerCase()
      if (terms.length && !terms.some((t) => near.includes(t))) return
      for (const m of plain(s).matchAll(/\b\d+(?:\.\d+)?\b/g)) {
        const figure = m[0]
        if (figure.replace(/\D/g, '').length < 2 || have.has(figure) || seen.has(figure)) continue
        seen.add(figure)
        if (out.length < 10) out.push({ page: p.n, figure, sentence: s.slice(0, 240) })
      }
    })
  }
  return out
}

export interface ResearchHandlerDeps {
  dataDir: string
  log: (message: string) => void
  search: SearchService
  research: ResearchService
}

/** The `research` job: the researcher answers one question with sourced facts and writes them into the course's notes. */
export function registerResearchHandlers(sched: Scheduler, d: ResearchHandlerDeps): void {
  sched.register('research', async (ctx) => {
    const question = String(ctx.job.question ?? '').replace(/\s+/g, ' ').trim()
    if (!question) throw new Error('a research job without a question')
    const slug = ctx.job.book
    if (!slug) throw new Error('a research job without a course')
    const purpose = String(ctx.job.purpose ?? '')
    const askedBy = ctx.job.requested_by
    const news = ctx.job.news === true
    const context = [purpose ? `Why it is asked: ${purpose}` : '', `It is for the course "${slug}".`].filter(Boolean).join('\n')
    const store = d.research.store

    // 1. what the course already knows (its notes and the shared notes). A shared note that answers is copied into the course.
    const exact = await store.findExact(question, slug)
    if (exact) {
      const mine = exact.course ? exact : await store.adopt(slug, exact)
      ctx.log(`already answered by ${exact.file}`)
      return { result: `already in the notes (${exact.file})`, resultPath: mine.file }
    }
    const hits = await notesFor(store, slug, question, 4)
    if (hits.length > 0) {
      const { messages } = await buildMessages(d.dataDir, ctx, 'researcher', 'check_notes', { question, notes: hits.map((i) => i.text).join('\n\n') })
      ctx.context(hits.map((i) => ({ name: i.name, tokens: Math.round(i.text.length / 4) })))
      const r = await chatJson(ctx, messages, z.object({ covered: z.boolean(), missing: z.string().default('') }), { maxTokens: 5000, temperature: 0.1 })
      if (r.value.covered) {
        const first = hits[0]!.note
        const mine = first.course ? first : await store.adopt(slug, first)
        ctx.log(`covered by existing notes: ${hits.map((i) => i.file).join(', ')}`)
        return { result: `covered by existing notes (${first.file})`, resultPath: mine.file }
      }
      ctx.log(`the notes do not cover it${r.value.missing ? `: ${r.value.missing}` : ''}`)
    }

    // 2. search and read pages, 3. write facts from them (the only things the researcher can do besides writing a note).
    // When the pages answer nothing, the model suggests short search words and the search is tried again (once, with at most two new queries).
    let provider = ''
    let facts: NoteFact[] = []
    let excerpts: NoteExcerpt[] = []
    let unverified = false
    const seenUrls = new Set<string>()
    const triedQueries = new Set<string>()
    let queries = [question]
    for (let round = 0; round < 2 && facts.length === 0; round++) {
      for (const query of queries) {
        if (facts.length > 0 || triedQueries.has(query)) continue
        triedQueries.add(query)
        const pages = await gatherPages(ctx, slug, query, question, seenUrls, news)
        if (!pages) {
          ctx.log(`no search provider gave results for "${query}"`)
          continue
        }
        provider = pages.provider
        ctx.log(`search (${pages.provider}) "${query}": ${pages.list.map((p) => p.url).join(', ')}`)
        const got = await factsFrom(ctx, question, context, pages.list)
        facts = got.facts
        excerpts = got.excerpts
        if (facts.length === 0) ctx.log(`the pages for "${query}" did not answer the question`)
      }
      if (facts.length > 0 || round === 1) break
      // the pages said nothing useful: ask the model for better search words
      const { messages } = await buildMessages(d.dataDir, ctx, 'researcher', 'search_queries', { question, tried: [...triedQueries].map((q) => `- ${q}`).join('\n') })
      const r = await chatJson(ctx, messages, z.object({ queries: z.array(z.string()).default([]) }), { maxTokens: 4000, temperature: 0.3 })
      queries = r.value.queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter((q) => q.length >= 3 && q.length <= 80).slice(0, 2)
      ctx.log(`new search words: ${queries.join(' | ') || '(none)'}`)
      if (queries.length === 0) break
    }

    // 4. last resort: the model's own knowledge, marked unverified (the fact base drops these unless `allow_unverified_facts` is set)
    if (facts.length === 0) {
      const { messages } = await buildMessages(d.dataDir, ctx, 'researcher', 'from_knowledge', { question, context })
      const r = await chatJson(ctx, messages, z.object({ facts: z.array(z.object({ fact: z.string() })).default([]) }), { maxTokens: 6000, temperature: 0.2 })
      facts = r.value.facts
        .map((f) => ({ fact: f.fact.replace(/\s+/g, ' ').trim() }))
        .filter((f) => f.fact.length >= 10)
        .slice(0, 8)
      unverified = true
      provider = ''
    }
    if (facts.length === 0) {
      // nothing to write: finish the job without a note (retrying would search, and perhaps pay, again). The asker goes on without notes.
      ctx.log(`no facts found for "${question}": no source gave an answer and the model knew nothing reliable`)
      return { result: 'no facts found: no note written' }
    }

    // 5. write the note
    const note = await store.write({ question, course: slug, facts, unverified, askedBy, purpose, provider: provider || undefined, excerpts })
    return {
      result: `${facts.length} fact(s) ${unverified ? "from the model's own knowledge (unverified)" : `from ${provider}, ${new Set(facts.map((f) => f.source?.url)).size} source(s)`}`,
      resultPath: note.file
    }
  })

  async function pageText(question: string, res: SearchResult, signal: AbortSignal): Promise<string> {
    let text = res.content?.trim() ?? ''
    if (text.length < 300) {
      try {
        text = (await d.search.fetchPage(res.url, signal)).trim() || text
      } catch (err) {
        if (isAbort(err)) throw err
        d.log(`could not read ${res.url}: ${(err as Error).message}`)
      }
    }
    return excerptFor(question, text, 5000)
  }

  async function gatherPages(ctx: JobContext, slug: string, query: string, forQuestion: string, seen: Set<string>, news: boolean) {
    const found = await d.search.search(query, { signal: ctx.signal, book: slug, agent: ctx.agent.id, job: ctx.job.id, limit: 5, ...(news ? { news: true, days: 7 } : {}) })
    if (!found) return null
    // read the results (pages that need a download: only the first three), then keep the three that talk most about what was asked
    const terms = searchTerms(forQuestion, 8).map((t) => t.toLowerCase())
    const read: { url: string; title: string; text: string; score: number }[] = []
    let downloads = 0
    for (const res of found.results.slice(0, 5)) {
      if (seen.has(res.url)) continue
      if (!res.content && downloads >= 3) continue
      if (!res.content) downloads++
      const text = await pageText(forQuestion, res, ctx.signal)
      if (!text) continue
      const lower = text.toLowerCase()
      const title = res.title.toLowerCase()
      read.push({ url: res.url, title: res.title, text, score: terms.filter((t) => lower.includes(t)).length + 2 * terms.filter((t) => title.includes(t)).length })
    }
    read.sort((a, b) => b.score - a.score) // the sort is stable: the provider's own order breaks ties
    const list = read.slice(0, 3).map((p, i) => ({ n: i + 1, url: p.url, title: p.title, text: p.text }))
    for (const p of list) seen.add(p.url)
    return list.length ? { provider: found.provider, list } : null
  }

  async function factsFrom(ctx: JobContext, forQuestion: string, ctxText: string, pages: { n: number; url: string; title: string; text: string }[]): Promise<{ facts: NoteFact[]; excerpts: NoteExcerpt[] }> {
    const { messages } = await buildMessages(d.dataDir, ctx, 'researcher', 'write_notes', { question: forQuestion, context: ctxText, pages: wrapUntrusted(pages) })
    ctx.context(pages.map((p) => ({ name: `page ${p.n}: ${p.url}`, tokens: Math.round(p.text.length / 4) })))
    const schema = z.object({ facts: z.array(z.object({ fact: z.string(), source: z.number().optional() })).default([]) })
    const keep = (list: { fact: string; source?: number }[]): NoteFact[] => {
      const kept: NoteFact[] = []
      for (const f of list) {
        const page = pages.find((p) => p.n === Math.round(Number(f.source)))
        const text = f.fact.replace(/\s+/g, ' ').trim()
        if (!page || text.length < 10 || text.length > 600) continue
        if (copiesPage(text, page.text)) {
          ctx.log(`dropped a fact that copies page ${page.n}: "${text.slice(0, 60)}..."`)
          continue
        }
        kept.push({ fact: text, source: { url: page.url, title: page.title } })
      }
      return kept
    }
    const r = await chatJson(ctx, messages, schema, { maxTokens: 8000, temperature: 0.1 })
    let out = keep(r.value.facts)
    if (out.length === 0) return { facts: out, excerpts: [] }
    // the figures and dates of the pages that bear on the question must reach the note: ask once for the ones the facts lack
    let missing = missingFigures(pages, out.map((f) => f.fact), forQuestion)
    if (missing.length > 0) {
      ctx.log(`the pages have figures the notes lack (${missing.map((m) => m.figure).join(', ')}): asking for them`)
      const follow: ChatMessage[] = [
        ...messages,
        { role: 'assistant', content: JSON.stringify({ facts: r.value.facts }).slice(0, 6000) },
        {
          role: 'user',
          content: `The pages also give these figures and dates you did not note: ${missing.map((m) => `page ${m.page}, "${m.figure}": ${m.sentence}`).join(' | ')}. Add a fact for each one that bears on the question, in your own words, with its source. Reply with one JSON object like {"facts": [{"fact": "...", "source": 1}]} that holds only the new facts.`
        }
      ]
      try {
        const more = await chatJson(ctx, follow, schema, { maxTokens: 8000, temperature: 0.1 })
        const norm = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
        const have = new Set(out.map((f) => norm(f.fact)))
        for (const f of keep(more.value.facts)) if (!have.has(norm(f.fact))) out.push(f)
      } catch (err) {
        if (isAbort(err)) throw err
        ctx.log(`the follow-up for the missing figures failed (${(err as Error).message})`)
      }
      out = out.slice(0, MAX_NOTE_FACTS)
      missing = missingFigures(pages, out.map((f) => f.fact), forQuestion)
    }
    // what the model still left out is kept word for word (at most four sentences), so the figure is in front of the writers anyway
    const excerpts: NoteExcerpt[] = []
    for (const m of missing) {
      const page = pages.find((p) => p.n === m.page)
      if (page && excerpts.length < 4 && !excerpts.some((x) => x.text === m.sentence.slice(0, 300))) excerpts.push({ text: m.sentence.slice(0, 300), url: page.url })
    }
    return { facts: out.slice(0, MAX_NOTE_FACTS), excerpts }
  }
}
