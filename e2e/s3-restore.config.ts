import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'
import base from '../playwright.config'

assert.equal(process.env.E2E_DATABASE_PROFILE, 'line-scheme-s3-restore')
assert.equal(process.env.E2E_PORT, '3109')
assert.equal(process.env.E2E_S3_LINUX, '1')
export default defineConfig({ ...base, testDir: resolve('e2e/tests'), webServer: undefined })
