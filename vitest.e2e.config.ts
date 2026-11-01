import { defineConfig } from 'vitest/config'

/**
 * `yarn test:e2e`: the tests that start Chromium (the autoplay bot, the player in a browser). Slow, so they are not part of `yarn test`.
 * Without Chromium they FAIL (tests/setup/e2e-chromium.ts), they never skip. Run it whenever a game shell or the player changes.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.test.ts'],
    // builds out/player and out/live once; the e2e tests assemble game folders with the real bundle
    globalSetup: ['tests/setup/player-bundle.ts'],
    setupFiles: ['tests/setup/e2e-chromium.ts'],
    environment: 'node',
    // each file starts browsers and a bot: two at a time keep a laptop responsive
    maxWorkers: 2,
    fileParallelism: true,
    retry: 1,
    // long timeouts are local to this config; the fast suite keeps 15 s
    testTimeout: 120000,
    hookTimeout: 120000,
    env: { EDU_AUTOSTART: '0' }
  }
})
