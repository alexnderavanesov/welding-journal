import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL } from '../database'

test('размеры и Изм.: атомарность, архив, удаление, повторы, права и блокировка', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-scheme-dimensions.ts'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 45_000,
  })
  expect(JSON.parse(stdout.trim()).dimensionContracts).toBeGreaterThanOrEqual(12)
})

test('сервер схем: повторы, версии, блокировки, коллизия UUID и актуальный архив', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-schemes.ts'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 45_000,
  })
  const result = JSON.parse(stdout.trim()); expect(result.schemeContracts).toBeGreaterThanOrEqual(10); expect(result.crossBundleCollision).toBe(true)
})
