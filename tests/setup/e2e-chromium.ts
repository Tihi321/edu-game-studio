import { beforeAll } from 'vitest'
import { requireChromium } from '../bot-helpers'

/** e2e setup file: every e2e test file fails (never skips) when Chromium cannot be launched. One launch per file. */
beforeAll(async () => {
  await requireChromium()
}, 60_000)
