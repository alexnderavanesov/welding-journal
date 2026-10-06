import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL } from '../database'

test('актуальность физической цепочки: атомарность, история, граница катушки и SQL на 200000 стыков', async () => {
  test.setTimeout(180_000)
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-chain-actuality.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  const result = JSON.parse(stdout.trim())
  expect(result).toMatchObject({ reversible: true, coilBoundary: true, staleRejected: true, preservedFacts: true, indexedEveryMember: true })
  expect(result.counts.map((row: { count: number }) => row.count)).toEqual([24, 1024, 200000])
  console.log('Physical actuality SQL:', result)
})
