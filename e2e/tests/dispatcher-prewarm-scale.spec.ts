import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { seedDispatcherLargeLineFixture, LARGE_LINE_PROJECT } from '../dispatcher-large-line-fixture'
import { withE2eDatabase } from '../database'
import { auditSqlCount } from '../audit-sql'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { prioritySemanticDigest } from '../priority-speed-comparison'

test('conditional prewarm: 250k joints, identical reports and bounded fresh checks', async ({ request, baseURL }, info) => {
  const mode = process.env.PREWARM_COMPARISON_MODE
  test.skip(!mode, 'Explicit isolated before/after measurement')
  expect(['before', 'after']).toContain(mode)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  test.setTimeout(480000)
  const fixture = await seedDispatcherLargeLineFixture(250000)
  const directory = resolve(process.env.E2E_AUDIT_OUTPUT_DIR ?? '.output', 'server')
  const manifest = readFileSync(resolve(directory, readdirSync(directory).find(name => name.includes('tanstack-start-server-fn-resolver'))!), 'utf8')
  const observed = `${baseURL}/_serverFn/${manifest.match(/"([a-f0-9]{64})":/)![1]}`
  const measures: { label: string; ms: number; sql: number; digest?: string }[] = []
  const prewarm = async (label: string) => {
    const before = await auditSqlCount()
    const start = performance.now()
    const response = await request.post(`${baseURL}/api/maintenance/dispatcher-prewarm`, {
      timeout: 240000, headers: { authorization: `Bearer ${process.env.MAINTENANCE_TOKEN}` },
    })
    const result = await response.json()
    const ms = performance.now() - start
    expect(response.status()).toBe(200)
    expect(result.ready).toBe(true)
    measures.push({ label, ms, sql: (await auditSqlCount())! - before! })
    return result
  }
  if (mode === 'after') await prewarm('prepare-before-users')
  for (const report of ['weldingJournal', 'lnk', 'heatTreatment']) {
    for (let round = 0; round < 3; round++) {
      const url = siblingRpcUrl(observed, 'readJournalGrid_createServerFn_handler')
      const before = await auditSqlCount(url)
      const start = performance.now()
      const response = await request.post(url, { timeout: 240000,
        data: await serializeRpcData({ report, columnFilters: { projectTitle: '=' + LARGE_LINE_PROJECT }, groupBy: [], route: [], start: 0, end: 100 }),
        headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
      })
      const body = await response.text()
      const ms = performance.now() - start
      expect(response.ok()).toBe(true)
      const decoded = await deserializeRpcResponse(body) as { result?: { rows: unknown[]; rowCount: number }; error?: unknown }
      expect(decoded.error).toBeUndefined()
      expect(decoded.result!.rowCount).toBe(250000)
      expect(decoded.result!.rows).toHaveLength(100)
      measures.push({ label: `${report}:${round}`, ms, sql: (await auditSqlCount(url))! - before!, digest: prioritySemanticDigest(decoded.result) })
    }
  }
  const storage = await withE2eDatabase(async db => (await db.query(`select
    (select md5(string_agg(id||':'||coalesce(final_status,''),'|' order by id)) from weld_joints) statuses,
    (select md5(string_agg(weld_joint_id||':'||code||':'||task_key,'|' order by weld_joint_id,code,task_key)) from dispatcher_row_tasks) codes,
    (select computed_at from dispatcher_task_index_state where id=1) computed_at,
    count(*)::int pages, sum(task_count)::int tasks from dispatcher_task_pages`)).rows[0])
  if (mode === 'after') {
    const fresh = await prewarm('fresh-check')
    expect(fresh.computedAt).toBe(storage.computed_at.toISOString())
    expect(measures.at(-1)!.sql).toBeLessThanOrEqual(15)
    const replies = await Promise.all([prewarm('fresh-concurrent-1'), prewarm('fresh-concurrent-2')])
    expect(replies[0]).toEqual(fresh)
    expect(replies[1]).toEqual(fresh)
  }
  const result = { mode, fixture, measures, storage: { ...storage, computed_at: undefined } }
  await writeFile(info.outputPath('prewarm-scale.json'), JSON.stringify(result, null, 2))
  if (process.env.PREWARM_COMPARE_FILE) {
    const before = JSON.parse(await readFile(process.env.PREWARM_COMPARE_FILE, 'utf8'))
    expect(result.storage).toEqual(before.storage)
    expect(measures.filter(item => item.digest).map(({ label, digest }) => ({ label, digest })))
      .toEqual(before.measures.filter((item: { digest?: string }) => item.digest).map(({ label, digest }: { label: string; digest: string }) => ({ label, digest })))
  }
})
