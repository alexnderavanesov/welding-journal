import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../database'

test('scoped duplicate publication and batched journal reads preserve complete identities and a coherent snapshot', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-journal-refresh.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toEqual({ scopedDuplicates: true, schemaDecoders: true, coherentBatch: true, staleRejected: true, groupCacheIsolation: true })
})
