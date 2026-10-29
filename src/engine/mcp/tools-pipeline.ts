import { z } from 'zod'
import { briefSchema } from '../../shared/brief'
import { STAGES } from '../edu/pipeline'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/**
 * The pipeline tool (EGS-08): `edu_run_pipeline` makes a course from a brief. The roles' model calls go through the usual model providers; with
 * the model `client/claude-code` (the brief's `model`) they wait for you as tasks (`edu_get_task`), see the guide.
 */
export function pipelineTools(svc: EduService, def: ToolDef): Tool[] {
  return [
    def(
      'edu_run_pipeline',
      `Make a course from a brief, as file jobs in the queue: plan, research, fact base, curriculum, per unit articles -> items -> wrong choices -> fact-check (must pass, with revise rounds) -> feedback, game design, the pictures (art plan, generators, art-critic), assemble, accessibility and child-safety reviews, build, lint, the autoplay bot, publish. Pass \`brief\` to create the course (its slug defaults to the topic's) and start the run in one call; with \`slug\` of an existing course it resumes the run in progress (finished steps are not redone). \`retry: true\` puts the failed jobs of the run back in the queue. \`restart: true\` starts run n+1 and clears the outputs from the stage \`from\` on (stages: ${STAGES.join(', ')}; default plan; research notes are kept). Returns {slug, run, enqueued, stage, steps}. Then edu_wait {slug} until it ends; edu_status {slug} shows the steps, what failed and why a run is blocked.`,
      z.object({
        slug: z.string().optional().describe('An existing course, or the slug for the new one (default: made from the topic)'),
        brief: briefSchema.optional().describe('{topic, audience, age?, level?, cefr?, sourceLang (en), languages?, targetLang?, shells?, format? (quick, standard, deep, language-a1), units?, objectivesPerUnit?, itemsPerObjective?, kids?, story: none|frame|scriptorium, model?: provider/model for every role (client/claude-code), media?: {art: {enabled, style, provider: comfy|flow|hand, review, palette ...}} (the media settings, written to course.md), notes?}'),
        restart: z.boolean().optional().describe('Start run n+1'),
        from: z.string().optional().describe(`With restart: the stage to start from (${STAGES.join(', ')})`),
        retry: z.boolean().optional().describe('Put the failed jobs of the current run back in the queue')
      }),
      (a) => svc.runPipeline(a)
    )
  ]
}
