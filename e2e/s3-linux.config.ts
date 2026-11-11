import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

assert.equal(process.env.E2E_S3_LINUX, '1')
assert.equal(process.env.E2E_DATABASE_PROFILE, 'line-scheme-s3')
assert.equal(process.env.E2E_PORT, '3107')
// run-s3 owns the container for both browsers, including failure cleanup.
export default defineConfig({ ...base, testDir: resolve('e2e/tests'), webServer: undefined })
