import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl } from '../rpc'

test('изменение действующего старого требования ДЛС инвалидирует диспетчер, а явная настройка и WDI — нет', async ({ request, baseURL }) => {
  test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Real production transport')
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const call = async (name: string, data: unknown) => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: unknown; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true)
    return payload.result
  }
  const save = async (key: string, value: object) => {
    const expectedUpdatedAt = await withE2eDatabase(async db => (await db.query('select updated_at from app_settings where key=$1', [key])).rows[0]?.updated_at.toISOString() ?? null)
    return call('saveAppSetting', { key, value, expectedUpdatedAt })
  }
  const state = () => withE2eDatabase(async db => (await db.query('select source_revision,computed_revision,full_rebuild from dispatcher_task_index_state where id=1')).rows[0])
  await withLineProgramFixture(async db => {
    await db.query(`update app_settings set value=(value::jsonb - 'officialDls')::text where key='save-check'`)
    await db.query(`insert into app_settings(key,value) values('other','{}') on conflict(key) do update set value=excluded.value`)
  })
  await call('refreshDispatcherTaskSnapshot', {})
  const before = await state()
  await save('other', { requireDlsForOfficialStamps: true })
  const after = await state()
  expect(after.source_revision, 'effective legacy DLS must invalidate previously computed tasks').toBeGreaterThan(before.source_revision)
  expect(after.full_rebuild).toBe(true)
  await call('refreshDispatcherTaskSnapshot', {})
  await save('save-check', { officialDls: false })
  await call('refreshDispatcherTaskSnapshot', {})
  const explicit = await state()
  await save('other', { requireDlsForOfficialStamps: false })
  expect(await state()).toEqual(explicit)
  await save('other', { requireDlsForOfficialStamps: true, unrelatedFixtureValue: 2 })
  expect(await state()).toEqual(explicit)
})
