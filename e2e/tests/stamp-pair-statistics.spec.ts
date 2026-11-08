import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { computeStatisticsServerResult, normalizeStatisticsServerRequest } from '../../src/server/statistics'
import { buildDerivedCalculationCacheKey } from '../../src/lib/derived-calculation-cache-key'
import { withE2eDatabase } from '../database'

const project = 'E2E two stamp contributions'
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

test('server, table, details and downloaded Excel preserve half-joints; missing facts retain general volume', async ({ page }) => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,
    has_vik,vik_result,psto_required,stamp_1_k_fact,stamp_1_z_fact)
    select $1,'PAIR','PAIR-L',case when n=8 then 'ОП8' else 'F'||n end,'2026-07-01',case when n=8 then 'Т1' else 'С17' end,'да','годен','нет',
      case when n in (1,3,4) then 'PAIR-A' when n=6 then 'pair-a' when n in (7,8) then ' Пусто ' end,
      case when n in (2,3) then 'PAIR-A' when n=4 then 'PAIR-B' end
    from generate_series(1,8) n`, [project]))
  const request = { projectFilter: project.toLowerCase(), from: '', to: '', unit: 'joints' as const }
  const welders = (await computeStatisticsServerResult({ ...request, tab: 'welders' })).welderSummary
  expect(welders.rows.map(row => [row.stamp, row.total])).toEqual([['PAIR-A', 4.5], ['PAIR-B', 0.5]])
  expect(welders.total).toBe(5)
  expect((await computeStatisticsServerResult({ ...request, tab: 'general' })).weldingDynamics)
    .toMatchObject({ totalValue: 7, totalWelders: 2, welderShiftCount: 2 })
  expect((await computeStatisticsServerResult({ ...request, tab: 'supports' })).supportSummary)
    .toMatchObject({ physical: 1, produced: 1, welders: [] })
  // A persisted pre-transition payload must not survive the rule change, even
  // when its data revision is already above the new rule's revision floor.
  const welderRequest = normalizeStatisticsServerRequest({ ...request, tab: 'welders' })
  const newKey = buildDerivedCalculationCacheKey('statistics:v36', welderRequest)
  const oldKey = newKey.replace(/^rules:v\d+:/, 'rules:v11:')
  await withE2eDatabase(async db => {
    await db.query('update derived_calculation_state set source_revision=500000000 where id=1')
    await db.query(`insert into derived_calculation_cache(cache_key,source_revision,payload)
      values($1,500000000,$2)`, [oldKey, JSON.stringify({ welderSummary: { total: 999, rows: [] } })])
  })
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
  await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('all')
  const grid = page.locator('[data-statistics-grid="welders"]')
  await expect(grid.locator('.ag-row[row-id="PAIR-B"] [col-id="total"]')).toContainText('0,5')
  const refreshed = await withE2eDatabase(async db => JSON.parse((await db.query(
    'select payload from derived_calculation_cache where cache_key=$1', [newKey],
  )).rows[0].payload))
  expect(refreshed.welderSummary.total).toBe(5)
  expect(refreshed.welderSummary.rows.map((row: { stamp: string; total: number }) => [row.stamp, row.total])).toEqual([['PAIR-A', 4.5], ['PAIR-B', 0.5]])
  await grid.getByRole('button', { name: 'Подробности сварщика PAIR-B', exact: true }).click()
  await expect(grid.getByTitle(/01.07.2026: 0,5 /)).toBeVisible()
  await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
  const preview = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Скачать Excel', exact: true }) })
  const download = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const book = XLSX.read(await readFile((await (await download).path())!), { type: 'buffer' })
  const rows = book.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1 }))
  for (const [stamp, expected] of [['PAIR-A', 4.5], ['PAIR-B', 0.5]] as const) {
    const row = rows.find(row => row[0] === stamp && row.length >= 9)!
    expect(row).toBeTruthy()
    expect(Number(String(row[2]).replace(',', '.'))).toBe(expected)
  }
})
