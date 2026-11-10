import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL } from '../database'

test('схемы переживают реальные удаления журнала, откат, перенос и удаление линии', async () => {
  test.setTimeout(120_000)
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-line-scheme-journal.ts'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 90_000,
  })
  const result = JSON.parse(stdout.trim())
  expect(result.journalSchemeContracts).toBeGreaterThanOrEqual(19)
  expect(result).toMatchObject({ realJournalDeletes: true, lateAtomicRollback: true, namesakeIsolation: true,
    repairRestoration: true, deletedLineFiles: true, realRenameAndMove: true })
})
