import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../database'

test('все ДЗ: реальные правила → сервер → PostgreSQL → dispatcherTasks', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-dispatcher-rule-matrix.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  const result = JSON.parse(stdout.trim())
  expect(result).toMatchObject({ settings: 30, persistedRuleChains: 28, reminderRules: 2, mandatoryProgramRule: true, virtualFieldStatementsPerPage: 1, removedFactsCleared: true, actualityRestoresContinuations: true, actualityMismatchBothRecoveryPaths: true })
  console.log('Dispatcher PostgreSQL matrix:', result)
})
