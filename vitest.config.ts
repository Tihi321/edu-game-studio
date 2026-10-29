import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    // no test may start a real app: the services are started by Edu Studio only when this is not 0
    env: { EDU_AUTOSTART: '0' }
  }
})
