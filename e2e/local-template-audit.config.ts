import { defineConfig } from '@playwright/test'
import original from '../playwright.config'

// Uses only previously downloaded local files and the disposable E2E database.
const webServer = original.webServer
if (!webServer || Array.isArray(webServer)) throw new Error('Expected a single isolated E2E web server')
export default defineConfig({ ...original, testDir: './experiments', testMatch: 'production-template-copy.spec.ts',
  webServer: { ...webServer, cwd: process.cwd() },
})
