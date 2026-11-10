import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { E2E_DATABASE_URL } from '../database'

test('схемы: 200000 стыков, 20 архивов, 500 точек на листе и сохранение одной точки', async () => {
  test.skip(process.env.E2E_SCHEME_SCALE !== '1', 'Explicit isolated scale fixture')
  test.setTimeout(180_000)
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/benchmark-line-schemes.ts'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 150_000,
  })
  const result = JSON.parse(stdout.trim()); expect(result.scale.joints).toBe(200000); console.log(JSON.stringify(result))
})
