import { useEdu } from './hooks'
import { PIPELINE_TICKETS, type CourseBriefView, type PlaytestRunView, type ResearchNoteView } from './pipeline'

export interface Slot<T> {
  /** True once the engine delivers this data (the ticket named in `ticket` is done). */
  available: boolean
  ticket: string
  data: T
}

// stable empty values, so a selector never returns a new array on every call
const NO_NOTES: ResearchNoteView[] = []
const NO_LINES: string[] = []
const NO_RUNS: PlaytestRunView[] = []

export function useCourseBrief(slug: string): Slot<CourseBriefView | null> {
  const brief = useEdu((s) => s.briefs[slug] ?? null)
  return { available: brief !== null, ticket: PIPELINE_TICKETS.brief, data: brief }
}

export function useResearchNotes(slug: string): Slot<ResearchNoteView[]> {
  const notes = useEdu((s) => s.research[slug])
  return { available: !!notes && notes.length > 0, ticket: PIPELINE_TICKETS.research, data: notes ?? NO_NOTES }
}

export function useCurriculumNotes(slug: string): Slot<string[]> {
  const notes = useEdu((s) => s.curriculumNotes[slug])
  return { available: !!notes && notes.length > 0, ticket: PIPELINE_TICKETS.curriculum, data: notes ?? NO_LINES }
}

export function usePlaytestRuns(slug: string): Slot<PlaytestRunView[]> {
  const runs = useEdu((s) => s.playtests[slug])
  return { available: !!runs && runs.length > 0, ticket: PIPELINE_TICKETS.playtest, data: runs ?? NO_RUNS }
}
