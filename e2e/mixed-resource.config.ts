import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

// Rebuild before every acceptance run:
// pnpm build
// docker build --pull=false -f e2e/Dockerfile.resource -t welding-journal:mixed-audit-20261009 .output
// AUDIT_MIXED_LOAD=1 AUDIT_SQL_COUNTS=1 E2E_USE_PRODUCTION_BUILD=1 pnpm exec tsx e2e/run.ts --config=e2e/mixed-resource.config.ts
// AUDIT_MIXED_DIAGNOSTIC=reports-only is isolation only, never full acceptance.
if (process.env.AUDIT_MIXED_LOAD !== '1') throw new Error('Opt in to the local 200k / five-client resource audit')
export default defineConfig({
  ...base, testDir: resolve('e2e/tests'), testMatch: 'mixed-resource-load.spec.ts',
  timeout: 900_000, expect: { timeout: 90_000 },
  use: { ...base.use, actionTimeout: 90_000, navigationTimeout: 90_000 },
  webServer: { ...base.webServer, cwd: resolve('.'), command: 'node e2e/mixed-resource-server.mjs',
    reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 } },
})
