import sharp from 'sharp'
import type { Scheduler } from '../queue/scheduler'
import { EduService } from './service'
import type { EduDeps } from './service'

export type { EduDeps } from './service'

// sharp keeps the files it read open (a cache); on Windows that blocks replacing and deleting an asset or a course.
sharp.cache(false)

/**
 * The hook for the course pipeline: later tickets register their job handlers here (`scheduler.register('edu.<task>', ...)`), EGS-08 the
 * content pipeline and EGS-03 the build and lint. Nothing is registered yet, so the engine only serves its queue, models and MCP tools.
 */
export function registerEduHandlers(_scheduler: Scheduler, deps: EduDeps): EduService {
  return new EduService(deps)
}
