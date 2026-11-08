import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../database'

test('большие линии: независимые записи, отбрасывание устаревшей попытки, атомарность и полное совпадение', async () => {
  test.setTimeout(180000)
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-dispatcher-large-lines.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, maxBuffer: 1024 * 1024,
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ largeScoped: true, boundedHydration: true, aliasesAndHistory: true, unrelatedPreserved: true,
    concurrentWriters: true, moveCreateDelete: true, coalesced: true, globalRetry: true, atomicRollback: true,
    boundedRetry: true, recovery: true, fullParity: true, registryRace: true, midnight: true })
})
