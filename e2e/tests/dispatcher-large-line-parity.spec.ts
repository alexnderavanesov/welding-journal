import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { seedDispatcherLargeLineFixture } from '../dispatcher-large-line-fixture'
import { withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl } from '../rpc'

test('250 тысяч: все страницы, коды и статусы двух больших линий точно совпадают с полным расчётом', async ({ request, baseURL }) => {
  test.skip(process.env.DISPATCHER_SCALE_PARITY !== '1', 'Explicit isolated 250k correctness check')
  test.setTimeout(600000)
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const call = async (name: string, data: unknown) => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), timeout: 300000,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: { isFresh?: boolean }; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true)
    return payload.result
  }
  const signature = () => withE2eDatabase(async db => {
    const { rows: [row] } = await db.query(`select
      (select md5(string_agg(id||':'||coalesce(final_status,''),'|' order by id)) from weld_joints) statuses,
      (select md5(string_agg(weld_joint_id||':'||code||':'||task_key,'|' order by weld_joint_id,code,task_key)) from dispatcher_row_tasks) codes,
      (select md5(string_agg(scope_key||':'||page_number||':'||md5(tasks),'|' order by scope_key,page_number)) from dispatcher_task_pages) pages,
      (select count(*)::int from dispatcher_task_pages) page_count,
      (select sum(task_count)::int from dispatcher_task_pages) task_count,
      (select repeated_tasks from dispatcher_task_index_state where id=1) payload`)
    const payload = JSON.parse(row.payload)
    payload.chainContinuations.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    payload.taskFilterOptions.sort((a: { value: string }, b: { value: string }) => a.value.localeCompare(b.value))
    return { ...row, payload }
  })
  const fixture = await seedDispatcherLargeLineFixture(250000)
  expect((await call('refreshDispatcherTaskSnapshot', {})).isFresh).toBe(true)
  for (const target of fixture.targets.slice(0, 2)) {
    const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [target.id])).rows[0].version)
    await call('updateWeldJoint', { id: target.id, expectedVersion: version, weldingJournalNote: `Same-source parity ${target.line}` })
  }
  expect((await call('refreshDispatcherTaskSnapshot', {})).isFresh).toBe(true)
  const scoped = await signature()
  await withLineProgramFixture(async () => {}) // full invalidation only; no source facts/timestamps changed
  expect((await call('refreshDispatcherTaskSnapshot', {})).isFresh).toBe(true)
  const full = await signature()
  expect(scoped).toEqual(full)
  const { payload: _payload, ...hashes } = full
  await writeFile(resolve('outputs/dispatcher-large-lines-2026-11-07/full-parity-250000.json'), JSON.stringify({
    rows: 250000, affectedRows: 26000, sameSourceFacts: true, allStoredPagesExactlyMatch: true, statusesAndCodesExactlyMatch: true,
    snapshotAndTotalsMatch: true, hashes,
  }, null, 2))
})
