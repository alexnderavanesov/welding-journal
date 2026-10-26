import { defineConfig } from '@playwright/test'
// No app imports, database or browser. This fixture tests real Playwright-owned
// web-server processes, including termination through our normal runner.
export default defineConfig({
  testDir: './lifecycle', timeout: 30_000, workers: 1, retries: 0, reporter: 'list',
  outputDir: '../outputs/e2e-lifecycle-results',
  webServer: {
    cwd: process.cwd(),
    command: 'node e2e/lifecycle/server.mjs',
    url: `http://127.0.0.1:${process.env.LIFECYCLE_PORT}`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    timeout: 10_000,
  },
})
