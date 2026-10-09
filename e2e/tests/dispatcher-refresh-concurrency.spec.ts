import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../database'

test('полный диспетчер атомарно догоняет параллельные записи, но не принимает устаревшие глобальные правила', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-dispatcher-refresh-concurrency.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ scopedCatchUp: true, createMoveDelete: true, matchesFullRebuild: true,
    globalChangeRetried: true, atomicPublication: true, rollbackAndRetry: true })
})
