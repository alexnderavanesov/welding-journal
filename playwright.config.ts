import { defineConfig, devices } from '@playwright/test'

import { E2E_DATABASE_URL } from './e2e/database'

process.env.E2E_DATABASE_URL = E2E_DATABASE_URL

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: {
    command: 'pnpm exec vite dev --host 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/lnk',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      WELDING_ENV_LOADED: '1',
    },
  },
})
