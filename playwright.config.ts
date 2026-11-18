import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:43124',
  },
  webServer: {
    command: 'npx tsx src/commands/fixture-only.ts',
    url: 'http://127.0.0.1:43124/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
