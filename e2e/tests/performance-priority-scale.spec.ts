import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { seedAgGridScaleFixture, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { auditSqlCount, auditSqlDetails } from '../audit-sql'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { STATISTICS_TRANSPORT } from '../../src/lib/statistics-result-payload'
import { prioritySemanticDigest } from '../priority-speed-comparison'
import { withE2eDatabase } from '../database'

// Paired production-bundle comparison, same owned fixture and explicit requests.
// UI acceptance remains in the ordinary grouping/statistics/registry scenarios.
test('priority speed comparison: 250k joints, 750k documents, grouping and six statistics tabs', async ({ page, baseURL }, info) => {
  test.skip(process.env.AUDIT_PRIORITY_SPEED !== '1', 'Explicit isolated before/after measurement only')
  test.setTimeout(900_000)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  const fixture = await seedAgGridScaleFixture(250000)
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Пользователи и права', exact: true })).toBeVisible()
  expect(observed).toBeTruthy()
  const measures: Record<string, unknown>[] = []
  const semanticValues: Record<string, unknown> = {}
  let dispatcherStorage: Record<string, unknown> | undefined
  // Volatile version/timestamp tokens differ between fresh fixtures. All other
  // fields, identifiers, counts, summaries and row order stay in the digest.
  const digest = prioritySemanticDigest
  const call = async (label: string, name: string, data: unknown) => {
    const url = siblingRpcUrl(observed, name + '_createServerFn_handler')
    const sqlBefore = await auditSqlCount(url)
    const started = performance.now()
    const profileLabel = process.env.AUDIT_HEAVY_CALCULATIONS === '1'
      && ['journal:initial', 'heatTreatment:root:1:0', 'heatTreatment:child:0', 'statistics:general:0', 'statistics:lnk:0', 'statistics:welders:0'].includes(label)
      ? label.replaceAll(':', '-') : undefined
    const response = await page.request.post(url, { data: await serializeRpcData(data), timeout: 240_000,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true',
        ...(profileLabel ? { 'x-e2e-heavy-profile': profileLabel } : {}) } })
    const body = await response.text(), ms = Math.round(performance.now() - started)
    if (profileLabel) {
      const path = join(dirname(process.env.AUDIT_SQL_COUNTS_FILE!), `heavy-${profileLabel}`)
      await expect.poll(async () => readFile(path + '.json', 'utf8').then(value => Boolean(JSON.parse(value))).catch(() => false), { timeout: 10000 }).toBe(true)
      const diagnostic = await readFile(path + '.json', 'utf8')
      await writeFile(info.outputPath(`heavy-${profileLabel}.json`), diagnostic)
      expect(JSON.parse(diagnostic).error).toBeUndefined()
      await writeFile(info.outputPath(`heavy-${profileLabel}.cpuprofile`), await readFile(path + '.cpuprofile'))
    }
    expect(response.ok(), body.slice(0, 300)).toBe(true)
    const decoded = await deserializeRpcResponse(body) as { result?: any; error?: unknown }
    expect(decoded.error).toBeUndefined()
    expect(decoded.result).toBeDefined()
    semanticValues[label] = decoded.result
    measures.push({ label, ms, sql: (await auditSqlCount(url))! - sqlBefore!, bytes: Buffer.byteLength(body), digest: digest(decoded.result) })
    console.log('PRIORITY_SPEED', JSON.stringify(measures.at(-1)))
    return decoded.result
  }
  try {
    // First read includes the one-time dispatcher calculation, kept separate.
    const filters = { projectTitle: '=' + AG_GRID_SCALE_PROJECT }
    await call('journal:initial', 'readJournalGrid', { report: 'weldingJournal', columnFilters: filters, groupBy: [], route: [], start: 0, end: 100 })
    // Outside request timing. Verify complete persisted codes/statuses and
    // measure page size without transferring every JSON page to the test.
    dispatcherStorage = await withE2eDatabase(async db => (await db.query(`select
      (select md5(string_agg(id||':'||coalesce(final_status,''),'|' order by id)) from weld_joints) statuses,
      (select md5(string_agg(weld_joint_id||':'||code||':'||task_key,'|' order by weld_joint_id,code,task_key)) from dispatcher_row_tasks) codes,
      count(*)::int pages, sum(task_count)::int tasks, sum(octet_length(tasks)::bigint)::text as bytes
      from dispatcher_task_pages`)).rows[0])
    for (const report of ['lnk', 'heatTreatment'] as const) {
      for (let round = 0; round < 2; round++) {
        let result: any
        for (const groupBy of [['projectTitle'], ['projectTitle', 'subtitleCode'], ['projectTitle', 'subtitleCode', 'line']]) {
          result = await call(`${report}:root:${groupBy.length}:${round}`, 'readJournalGrid',
            { report, columnFilters: filters, groupBy, route: [], start: 0, end: 100 })
          expect(result.rows).toHaveLength(1)
          expect(result.rows[0].journalGroup.recordCount).toBe(250000)
        }
        await call(`${report}:child:${round}`, 'readJournalGrid', { report, columnFilters: filters,
          groupBy: ['projectTitle', 'subtitleCode', 'line'], route: [result.rows[0].journalGroup.key], start: 0, end: 100 })
      }
    }
    for (const tab of ['general', 'lnk', 'psto', 'supports', 'welders', 'lineSummary']) {
      for (let round = 0; round < 2; round++) await call(`statistics:${tab}:${round}`, 'getStatisticsServerResult',
        { tab, projectFilter: AG_GRID_SCALE_PROJECT, from: '', to: '', unit: 'joints', jointFilter: 'all', controlDynamicsScale: 'auto', weldingDynamicsScale: 'auto', transport: STATISTICS_TRANSPORT })
    }
    for (let round = 0; round < 3; round++) {
      const result = await call(`documents:leaf:${round}`, 'listRemoteGeneratedDocumentHistoryGrid',
        { types: ['weldingJournal'], columnFilters: {}, startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] })
      expect(result.rows).toHaveLength(100)
      expect(result.total).toBe(150000)
    }
    for (const rowGroupCols of [['project'], ['project', 'subtitle']]) await call(`documents:groups:${rowGroupCols.length}`, 'listRemoteGeneratedDocumentHistoryGrid',
      { types: ['weldingJournal'], columnFilters: {}, startRow: 0, endRow: 100, rowGroupCols, groupKeys: [], sortModel: [] })
    if (process.env.AUDIT_PRIORITY_COMPARE) {
      const before = JSON.parse(await readFile(process.env.AUDIT_PRIORITY_COMPARE, 'utf8'))
      const beforeValues = JSON.parse(await readFile(join(dirname(process.env.AUDIT_PRIORITY_COMPARE), 'semantic-values.json'), 'utf8'))
      expect(measures.map(({ label, digest }) => ({ label, digest }))).toEqual(
        before.measures.map(({ label }: any) => ({ label, digest: prioritySemanticDigest(beforeValues[label]) })))
      if (before.dispatcherStorage) {
        const { bytes: _beforeBytes, ...beforeStorage } = before.dispatcherStorage
        const { bytes: _afterBytes, ...afterStorage } = dispatcherStorage!
        expect(afterStorage).toEqual(beforeStorage)
      }
    }
  } finally {
    await writeFile(info.outputPath('priority-speed.json'), JSON.stringify({ fixture, measures, dispatcherStorage, resources: await auditSqlDetails() }, null, 2))
    await writeFile(info.outputPath('semantic-values.json'), JSON.stringify(semanticValues))
  }
})
