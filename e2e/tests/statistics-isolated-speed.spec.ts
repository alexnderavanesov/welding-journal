import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { seedAgGridScaleFixture, AG_GRID_SCALE_PROJECT } from '../ag-grid-scale-fixture'
import { auditSqlDetails, auditSqlSnapshot } from '../audit-sql'
import { withE2eDatabase } from '../database'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'
import { prioritySemanticDigest } from '../priority-speed-comparison'
import { STATISTICS_TRANSPORT } from '../../src/lib/statistics-result-payload'

// One tab per fresh server/database: no preceding dispatcher or other summary.
test('isolated statistics: unchanged answers, cold calculation and cached read', async ({ page, baseURL }, info) => {
  const tab = process.env.AUDIT_STATS_TAB
  test.skip(!tab, 'Explicit isolated before/after measurement')
  expect(['supports', 'welders', 'lineSummary']).toContain(tab)
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(process.env.AUDIT_SQL_COUNTS).toBe('1')
  expect(process.env.AUDIT_MEMORY).toBe('1')
  test.setTimeout(600_000)
  const fixture = await seedAgGridScaleFixture(250000)
  let observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/')) observed = request.url() })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Пользователи и права', exact: true })).toBeVisible()
  const url = siblingRpcUrl(observed, 'getStatisticsServerResult_createServerFn_handler')
  const baselinePath = process.env.AUDIT_STATS_COMPARE!
  expect(baselinePath).toBeTruthy()
  const baseline = JSON.parse(await readFile(join(dirname(baselinePath), 'semantic-values.json'), 'utf8'))
  const expected = prioritySemanticDigest(baseline[`statistics:${tab}:0`])
  const measures: unknown[] = []
  const snapshot = async () => { await auditSqlSnapshot(); return (await auditSqlDetails())! }
  try {
    for (let round = 0; round < 4; round++) {
      // This runner owns the exact disposable DB. Clear only calculated
      // statistics, never source facts, versions or other registry indexes.
      await withE2eDatabase(db => db.query("delete from derived_calculation_cache where cache_key like 'rules:%:statistics:%'"))
      for (const cached of [false, true]) {
        const before = await snapshot()
        const started = performance.now()
        const response = await page.request.post(url, {
          data: await serializeRpcData({ tab, projectFilter: AG_GRID_SCALE_PROJECT, from: '', to: '', unit: 'joints', jointFilter: 'all', controlDynamicsScale: 'auto', weldingDynamicsScale: 'auto', transport: STATISTICS_TRANSPORT }),
          timeout: 120_000, headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
        })
        const body = await response.text(), ms = Math.round(performance.now() - started)
        expect(response.ok()).toBe(true)
        const value = await deserializeRpcResponse(body) as { result: unknown; error?: unknown }
        expect(value.error).toBeUndefined()
        expect(prioritySemanticDigest(value.result)).toBe(expected)
        const after = await snapshot()
        const reads = Object.fromEntries(Object.entries(after.resources!.reads).map(([table, stats]) => {
          const prior = before.resources!.reads[table]
          return [table, { calls: stats.calls - (prior?.calls ?? 0), rows: stats.rows - (prior?.rows ?? 0), ms: Math.round(stats.totalMilliseconds - (prior?.totalMilliseconds ?? 0)) }]
        }).filter(([, value]) => (value as { calls: number }).calls > 0))
        const sample = { tab, round, cached, ms, sql: after.statements - before.statements, bytes: Buffer.byteLength(body), reads }
        measures.push(sample)
        console.log('ISOLATED_STATS', JSON.stringify(sample))
      }
    }
  } finally {
    await writeFile(info.outputPath('statistics-isolated.json'), JSON.stringify({ tab, fixture: fixture.counts, expected, measures, resources: await auditSqlDetails() }, null, 2))
  }
})
