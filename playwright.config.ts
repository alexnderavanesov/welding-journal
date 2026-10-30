import { defineConfig, devices } from '@playwright/test'

import { E2E_DATABASE_URL } from './e2e/database'

process.env.E2E_DATABASE_URL = E2E_DATABASE_URL
// Tests also import server helpers directly. Keep those imports on the same
// disposable database instead of allowing .env.local to initialize a user pool.
process.env.DATABASE_URL = E2E_DATABASE_URL
process.env.WELDING_ENV_LOADED = '1'
const E2E_PORT = Number(process.env.E2E_PORT || 3100)
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`
const useProductionBuild = process.env.E2E_USE_PRODUCTION_BUILD === '1'
if (process.env.E2E_AUDIT_OUTPUT_DIR && (!useProductionBuild || process.env.AUDIT_SQL_COUNTS !== '1')) {
  throw new Error('A saved comparison bundle requires the production audit runner.')
}
const browser = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium'

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    storageState: process.env.E2E_AUTH_STATE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: browser,
      use: { ...devices[browser === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'], viewport: { width: 1600, height: 1000 },
        ...(browser === 'chromium' && process.env.E2E_CHROME === '1' ? { channel: 'chrome' } : {}),
        ...(process.env.E2E_DEVICE_SCALE_FACTOR ? { deviceScaleFactor: Number(process.env.E2E_DEVICE_SCALE_FACTOR) } : {}) },
    },
  ],
  webServer: {
    command: useProductionBuild
      ? process.env.AUDIT_SQL_COUNTS === '1' ? 'node e2e/audit-server.mjs' : 'pnpm start'
      : `pnpm exec vite dev --host 127.0.0.1 --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/lnk`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      WELDING_ENV_LOADED: '1',
      PORT: String(E2E_PORT),
      HOST: '127.0.0.1',
    },
  },
})
