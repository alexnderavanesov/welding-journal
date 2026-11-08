import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { seedDispatcherLargeLineFixture } from '../dispatcher-large-line-fixture'
import { withE2eDatabase } from '../database'
import { serializeRpcData, deserializeRpcResponse, siblingRpcUrl } from '../rpc'

const count = Number(process.env.DISPATCHER_SCALE_ROWS)
test.skip(![50000, 250000].includes(count), 'Explicit local before/after scale run')
test.use({ trace: 'off', video: 'off' })

test('one real joint save on 6000 / 20000-row lines with a prepared index', async ({ request, baseURL }) => {
  test.setTimeout(1800000)
  expect(process.env.DISPATCHER_LARGE_LINE_PROBE).toBe('1')
  const label = process.env.DISPATCHER_SCALE_LABEL!
  expect(label).toMatch(/^[a-z0-9-]+$/)
  const output = resolve('outputs/dispatcher-large-lines-2026-11-07', label)
  await mkdir(output, { recursive: true })
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const call = async <T,>(name: string, data: unknown): Promise<T> => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), timeout: 300000,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true)
    return payload.result
  }
  const fixture = await seedDispatcherLargeLineFixture(count as 50000 | 250000)
  const refresh = () => call<{ isFresh: boolean; sourceRevision: number; computedRevision: number }>('refreshDispatcherTaskSnapshot', {})
  const initial = performance.now()
  expect((await refresh()).isFresh).toBe(true)
  const initialMs = performance.now() - initial
  console.log(`LARGE_LINES_PREPARED ${label} ${Math.round(initialMs)}ms`)
  const samples: object[] = []
  const probeFile = process.env.AUDIT_SQL_COUNTS_FILE!.replace(/counts\.json$/, 'dispatcher-staging.json')
  const probe = async () => JSON.parse(await readFile(probeFile, 'utf8')) as { attempts: Array<Record<string, unknown>> }
  const save = () => writeFile(resolve(output, 'result.json'), JSON.stringify({ label, count, fixture, initialMs, samples }, null, 2))
  await save()
  for (const target of fixture.targets.slice(0, 2)) for (let round = 0; round < 3; round++) {
    const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [target.id])).rows[0].version)
    const before = (await probe()).attempts.length
    const start = performance.now()
    await call('updateWeldJoint', { id: target.id, expectedVersion: version, weldingJournalNote: `${target.line}:round-${round}` })
    const saveMs = performance.now() - start, refreshStart = performance.now()
    const result = await refresh()
    const refreshMs = performance.now() - refreshStart
    expect(result.isFresh).toBe(true)
    expect(result.computedRevision).toBe(result.sourceRevision)
    const attempts = (await probe()).attempts.slice(before)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].outcome).toBe('commit')
    samples.push({ line: target.line, round, saveMs, refreshMs, totalMs: performance.now() - start, attempts })
    await save()
    console.log(`LARGE_LINE_SAMPLE ${label} ${target.line} ${round} refresh=${Math.round(refreshMs)} lock=${Math.round(Number(attempts[0].lockHeldMs))} rows=${attempts[0].wideRows}`)
  }
  const signature = await withE2eDatabase(async db => (await db.query(`select
    (select md5(string_agg(id||':'||coalesce(final_status,''),'|' order by id)) from weld_joints) statuses,
    (select md5(string_agg(weld_joint_id||':'||code||':'||task_key,'|' order by weld_joint_id,code,task_key)) from dispatcher_row_tasks) codes,
    (select md5(string_agg(scope_key||':'||page_number||':'||md5(tasks),'|' order by scope_key,page_number)) from dispatcher_task_pages) pages,
    (select repeated_tasks from dispatcher_task_index_state where id=1) payload`)).rows[0])
  await writeFile(resolve(output, 'signature.json'), JSON.stringify(signature))
  await writeFile(resolve(output, 'probe.json'), await readFile(probeFile))
})
