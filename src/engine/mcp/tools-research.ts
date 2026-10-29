import { z } from 'zod'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/**
 * The research tools (EGS-06): ask the researcher a question and read the course's fact base. The researcher searches the web
 * (`config/providers.md`, `search_order`); with the `client-search` provider the web search is a task for you (`edu_get_task {role: "searcher"}`).
 */

const slug = z.string().describe('The course slug (see edu_list_courses)')

export function researchTools(svc: EduService, def: ToolDef, opts: { waitTimeoutMs?: number } = {}): Tool[] {
  const maxWait = (opts.waitTimeoutMs ?? 10 * 60_000) / 1000
  return [
    def(
      'edu_ask_researcher',
      'Ask the researcher a question about the course topic. The researcher searches the web (or, with the client-search provider, you do: edu_get_task {role: "searcher"}), reads the pages and writes a note of short sourced facts into courses/<slug>/research/. The same question is never asked twice for a course (status "exists"), and a course may ask at most research_limit_per_course questions (config/factory.md; status "limit"). Without a researcher agent nothing is queued (status "no-researcher"). `wait`: seconds to wait for the answer; the call then returns the note\'s facts. It returns early with clientTasks > 0 when the research waits for you to answer a model call or a web search. Merge new notes into the fact base with edu_factbase_get {merge: true}.',
      z.object({
        slug,
        question: z.string().min(3).describe('A specific question, for example "When did the Western Roman Empire end, and who was its last emperor?"'),
        purpose: z.string().optional().describe('Why it is asked (shown to the researcher)'),
        wait: z.number().positive().optional().describe('Seconds to wait for the answer (default: do not wait)')
      }),
      (a) => svc.askResearcher(a.slug, a.question, { purpose: a.purpose, waitSeconds: a.wait === undefined ? undefined : Math.min(a.wait, maxWait) })
    ),
    def(
      'edu_factbase_get',
      'The fact base of a course: its facts with stable ids (f1, f2 ...) and the numbers of their sources, the numbered sources, and how many research notes there are. Writers cite a fact as [f3]. merge: true first merges the research notes that are not merged yet (new facts get new ids, ids already given never change; unverified facts from the researcher\'s own knowledge are only kept when allow_unverified_facts is true in config/factory.md).',
      z.object({ slug, merge: z.boolean().optional().describe('Merge the new research notes first') }),
      async (a) => {
        if (!(await svc.courseExists(a.slug))) throw new Error(`no course "${a.slug}"`)
        const merge = a.merge ? await svc.factbase.mergeNotes(a.slug) : undefined
        const view = await svc.factbase.get(a.slug)
        return {
          slug: a.slug,
          facts: view.facts,
          sources: view.sources,
          notes: view.notes,
          pendingNotes: view.pendingNotes,
          ...(merge ? { merge: { added: merge.added.map((f) => f.id), duplicates: merge.duplicates, skippedUnverified: merge.skippedUnverified, mergedNotes: merge.merged } } : {})
        }
      }
    )
  ]
}
