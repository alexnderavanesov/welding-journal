import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

if (process.env.AUDIT_CHAIN_SCALE !== '1') throw new Error('Opt in to the isolated 200k mixed-chain audit')
const server = base.webServer
if (!server || Array.isArray(server)) throw new Error('Expected one owned local test server')
// A full initial calculation is measured separately from the operator action.
// Larger wait budgets do not change functional expectations or SQL bounds.
export default defineConfig({
  ...base,
  testDir: resolve('e2e/tests'),
  timeout: 300_000,
  expect: { timeout: 90_000 },
  use: { ...base.use, actionTimeout: 90_000, navigationTimeout: 90_000 },
  webServer: { ...server, cwd: resolve('.') },
})
