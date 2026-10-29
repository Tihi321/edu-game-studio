import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // builds out/player/player.js + player.css once, for the tests that assemble a game folder
    globalSetup: ['tests/setup/player-bundle.ts'],
    environment: 'node',
    testTimeout: 15000,
    // no test may start a real app: the services are started by Edu Studio only when this is not 0
    env: { EDU_AUTOSTART: '0' }
  }
})
