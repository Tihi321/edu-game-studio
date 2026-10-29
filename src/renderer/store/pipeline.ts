/**
 * Pipeline data the studio shows but the engine does not produce yet. Each slot has a typed shape and a hook, and the ticket that fills it
 * is named here, so a page shows an empty state that says what is coming, and the later ticket only has to fill the slot (an event and a
 * reducer that writes `briefs`, `research`, `curriculumNotes` or `playtests`), not touch the pages. Until then every hook says "not available".
 */

/** The ticket that fills each slot (see ROADMAP.md). */
export const PIPELINE_TICKETS = {
  /** The director's brief: topic, audience, level, languages, shells, length. */
  brief: 'EGS-08',
  /** Researcher notes and the fact base around a course. */
  research: 'EGS-06',
  /** The curriculum designer's notes (why the units are ordered this way). */
  curriculum: 'EGS-07',
  /** Runs of the playtester role through the autoplay bot. */
  playtest: 'EGS-08'
} as const

/** The brief of a course (EGS-08: the director keeps it). */
export interface CourseBriefView {
  topic: string
  audience: string
  level?: string
  languages: string[]
  shells: string[]
  /** How long the game should take, in minutes. */
  lengthMinutes?: number
  notes?: string
}

/** One sourced note of the researcher (EGS-06). */
export interface ResearchNoteView {
  id: string
  title: string
  source: string
  url?: string
  summary: string
}

/** One run of the autoplay bot (EGS-08: the playtester role). `mode` is the bot's mode. */
export interface PlaytestRunView {
  id: string
  mode: 'perfect' | 'wrong' | 'random' | 'keyboard'
  at: string
  ok: boolean
  steps: number
  correct: number
  wrong: number
  failures: string[]
  /** Screenshots, as paths relative to the data folder (served by the file protocol). */
  screenshots: string[]
}

export interface PipelineData {
  briefs: Record<string, CourseBriefView>
  research: Record<string, ResearchNoteView[]>
  curriculumNotes: Record<string, string[]>
  playtests: Record<string, PlaytestRunView[]>
}

export const initialPipeline = (): PipelineData => ({ briefs: {}, research: {}, curriculumNotes: {}, playtests: {} })
