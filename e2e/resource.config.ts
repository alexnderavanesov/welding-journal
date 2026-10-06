import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

// Opt-in local release rehearsal, not deployment configuration. The usual runner
// owns the disposable database; the container can see only the built output.
const memory = Number(process.env.AUDIT_CONTAINER_MEMORY_MIB)
if (![2048, 4096].includes(memory)) throw new Error('Choose an explicit 2048 or 4096 MiB local test limit')
if (process.env.E2E_USE_PRODUCTION_BUILD !== '1') throw new Error('Build locally before the container rehearsal')

export default defineConfig({
  ...base,
  testDir: resolve('e2e/tests'),
  webServer: { ...base.webServer, cwd: resolve('.'), command: 'node e2e/resource-server.mjs', url: 'http://127.0.0.1:3100/lnk',
    reuseExistingServer: false, timeout: 120_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 } },
})
