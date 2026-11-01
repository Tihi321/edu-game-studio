import { z } from 'zod'
import { CEFR_LEVELS } from './course'
import { courseMediaSchema, langSchema } from './media'
import type { FormatEntry } from './schemas'

/**
 * The brief of a course (EGS-08): what the person who asks for a course says. It is stored in `courses/<slug>/course.md` (`brief`) and the
 * pipeline sizes its jobs from it and from the format in `config/formats.md`.
 *
 *   topic        what the course is about (required)
 *   audience     who it is for (required), in a few words
 *   age          the learners' age in years; with it `kids` defaults to age < 13
 *   level        their level in the topic ("beginner"), free text
 *   cefr         a language course: the CEFR level taught
 *   sourceLang   the language the course is written in (default en)
 *   languages    the editions (default [sourceLang]); the step `editions` (the translator role) makes every other one, skipped with one language
 *   targetLang   a language course: the language that is taught
 *   shells       the game shells asked for (default [quiz-arena]); the player has only quiz-arena today
 *   format       an id of config/formats.md (default quick; language-a1 when targetLang is set)
 *   units, objectivesPerUnit, itemsPerObjective   override the format's numbers
 *   kids         a course for children: the child-safety reviewer must pass it (default: age < 13)
 *   story        none (default), frame (a frame story written by the narrative designer) or scriptorium (hand a story idea to Scriptorium)
 *   model        provider/model for every role of this course (written to course.md `models['*']`), e.g. client/claude-code
 *   media        the media settings (written to course.md `media`): {art: {enabled, style, provider (comfy|flow|hand), review, palette ...}, music, voice, sound}
 *   notes       anything else the roles should know
 */
export const STORY_MODES = ['none', 'frame', 'scriptorium'] as const

export const briefSchema = z.object({
  topic: z.string().trim().min(2, 'the topic is what the course is about'),
  audience: z.string().trim().min(2, 'the audience is who the course is for'),
  age: z.number().int().min(3).max(99).optional(),
  level: z.string().trim().min(1).optional(),
  cefr: z.enum(CEFR_LEVELS).optional(),
  sourceLang: langSchema.default('en'),
  languages: z.array(langSchema).min(1).optional(),
  targetLang: langSchema.optional(),
  shells: z.array(z.string().min(1)).min(1).default(['quiz-arena']),
  format: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  units: z.number().int().min(1).max(12).optional(),
  objectivesPerUnit: z.number().int().min(1).max(12).optional(),
  itemsPerObjective: z.number().int().min(2).max(12).optional(),
  kids: z.boolean().optional(),
  story: z.enum(STORY_MODES).default('none'),
  model: z.string().trim().regex(/^[^\s/]+\/\S+$/, 'a model is provider/model, for example client/claude-code').optional(),
  /** The media settings of the course (`art`, `music`, `voice`, `sound`; see `courseMediaSchema`): written to course.md `media`. Missing: the defaults. */
  media: z
    .record(z.string(), z.unknown())
    .superRefine((v, ctx) => {
      const r = courseMediaSchema.safeParse(v)
      if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: i.path, message: i.message })
    })
    .optional(),
  notes: z.string().optional()
})
export type Brief = z.output<typeof briefSchema>
export type BriefInput = z.input<typeof briefSchema>

/** The numbers and switches a run uses: the brief over the format. */
export interface ResolvedBrief {
  brief: Brief
  format: FormatEntry
  /** The editions; the source language is one of them. */
  languages: string[]
  units: number
  objectivesPerUnit: number
  itemsPerObjective: number
  articlesPerUnit: number
  researchQuestionsPerUnit: number
  itemKinds: string[]
  /** A language course: a language is taught. */
  language: boolean
  kids: boolean
  cefr?: string
}

/** Resolves a brief against the enabled formats. Throws an Error that names the formats when the brief names an unknown one. */
export function resolveBrief(input: BriefInput | Brief, formats: readonly FormatEntry[]): ResolvedBrief {
  const brief = briefSchema.parse(input)
  const id = brief.format ?? (brief.targetLang ? 'language-a1' : 'quick')
  const format = formats.find((f) => f.id === id)
  if (!format) throw new Error(`no course format "${id}" in config/formats.md (formats: ${formats.map((f) => f.id).join(', ') || 'none'})`)
  const languages = [...new Set([brief.sourceLang, ...(brief.languages ?? [])])]
  return {
    brief,
    format,
    languages,
    units: brief.units ?? format.units,
    objectivesPerUnit: brief.objectivesPerUnit ?? format.objectives_per_unit,
    itemsPerObjective: brief.itemsPerObjective ?? format.items_per_objective,
    articlesPerUnit: format.articles_per_unit,
    researchQuestionsPerUnit: format.research_questions_per_unit,
    itemKinds: format.item_kinds,
    language: !!brief.targetLang,
    kids: brief.kids ?? (brief.age !== undefined && brief.age < 13),
    cefr: brief.cefr ?? format.cefr
  }
}
