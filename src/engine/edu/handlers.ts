import sharp from 'sharp'
import type { Scheduler } from '../queue/scheduler'
import { EduService } from './service'
import type { EduDeps } from './service'

export type { EduDeps } from './service'

// sharp keeps the files it read open (a cache); on Windows that blocks replacing and deleting an asset or a course.
sharp.cache(false)

/**
 * The hook for the course pipeline: the job handlers are registered here. The researcher's `research` job is registered now (EGS-06);
 * EGS-08 adds the content pipeline's handlers, EGS-03 the build and lint ones.
 */
export function registerEduHandlers(scheduler: Scheduler, deps: EduDeps): EduService {
  const svc = new EduService(deps)
  svc.registerHandlers(scheduler)
  return svc
}
