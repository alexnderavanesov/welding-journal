import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'
import { captureReportExcel } from '../report-excel-capture'
import { rpcName } from '../rpc'
import { readSchemeLines } from '../../src/server/line-scheme-read'
import { computeStatisticsServerResult } from '../../src/server/statistics'

const trackProject = schemeFixtureCleanup(test)

async function filterValue(page: Page, grid: Locator, column: string, value: string) {
  await grid.locator(`.ag-header-cell[col-id="${column}"] .ag-header-cell-filter-button`).click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('textbox').fill(value)
  await filter.getByRole('checkbox', { name: value, exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
}

test('полинейная сводка: ОП, состав, схемы, фильтры, Excel, один ряд и обновление редакций', async ({ page }, info) => {
  const project = `E2E line summary schemes ${info.project.name}`
  trackProject(info, project)
  const fixture = await withE2eDatabase(async db => {
    const lines = (await db.query("insert into line_programs(project_title,subtitle_code,line) select $1,'SUMMARY',n from unnest(array['A','B','C']) n returning id,line", [project])).rows
    const ids = new Map(lines.map(line => [line.line, line.id]))
    const active = randomUUID(), archive = randomUUID()
    const bundles = new Map<string, number>()
    for (const [line, revision] of [['A', active], ['C', archive]]) {
      const bundle = (await db.query("insert into line_scheme_bundles(line_program_id,project_title,subtitle_code,line) values($1,$2,'SUMMARY',$3) returning id", [ids.get(line), project, line])).rows[0].id
      bundles.set(line, bundle)
      const key = randomUUID()
      await db.query("insert into line_scheme_files(key,state) values($1,'ready')", [key])
      await db.query("insert into line_scheme_revisions(id,bundle_id,file_key,file_name,size,page_count,author_id,author_name) values($1,$2,$3,'Summary.pdf',100,2,'fixture','Fixture')", [revision, bundle, key])
      if (line === 'A') await db.query('update line_scheme_bundles set active_revision_id=$1 where id=$2', [revision, bundle])
    }
    const joints = [
      ['A', 'F1', 'С17', '2026-11-01', 'I'], ['A', 'S1', 'С17', null, 'I'],
      ['A', 'ОП1', 'Т1', '2026-11-01', 'II'], ['A', 'ОП1R1', 'Т1', '2026-11-02', 'II'],
      ['A', 'ОП2', 'Т1', null, 'II'], ['A', 'S9', 'С17', null, 'I'],
      ...Array.from({ length: 6 }, (_, i) => ['B', `S${i + 1}`, 'С17', null, 'I']),
      ['C', 'ОП1', 'Т1', '2026-11-01', 'I'],
    ]
    let supportRoot = 0, supportPhysical = 0, activePoint = ''
    for (const [line, joint, type, date, category] of joints) {
      const id = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,category,officiality,revision_actuality,wdi,d1)
        values($1,$2,'SUMMARY',$3,$4,$5,$6,$7,'действующий',$8,$9,50.8) returning id`,
      [ids.get(line), project, line, joint, type, date, category, joint === 'S9' ? 'не актуален' : 'актуальная', type === 'Т1' ? null : 2])).rows[0].id
      const repair = joint === 'ОП1R1'
      await db.query('insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values($1,$2,$3,$4)', [id, repair ? 'repair' : 'primary', repair ? supportRoot : id, repair ? supportRoot : null])
      const physical = repair ? supportPhysical : (await db.query('insert into line_scheme_physicals(seed_node_id,last_label,last_line_program_id) values($1,$2,$3) returning id', [id, joint, ids.get(line)])).rows[0].id
      await db.query('insert into line_scheme_members(weld_joint_id,physical_id) values($1,$2)', [id, physical])
      if (line === 'A' && joint === 'ОП1') { supportRoot = id; supportPhysical = physical }
      if (line === 'A' && ['F1', 'ОП1', 'S9'].includes(joint!) || line === 'C') {
        const point = randomUUID()
        await db.query('insert into line_scheme_points(id,revision_id,physical_id,page,x,y) values($1,$2,$3,2,.4,.4)', [point, line === 'A' ? active : archive, physical])
        if (joint === 'F1') activePoint = point
      }
    }
    await db.query('delete from derived_calculation_cache')
    return { active, archive, activePoint, archiveBundle: bundles.get('C')! }
  })
  const direct = await computeStatisticsServerResult({ tab: 'lineSummary', unit: 'joints', projectFilter: project.toLowerCase() })
  expect(direct.lineSummary).toMatchObject({ total: 11, completed: 3, remaining: 8 })
  const registry = await readSchemeLines({ filters: { projectTitle: [project] } })
  expect(registry.rows.find(row => row.line === 'A')).toMatchObject({ total: 4, placedCount: 3, placedPercent: 50 })
  expect(direct.lineSummary.rows.filter(row => row.line === 'A').map(row => row.scheme)).toEqual([
    { total: 4, placed: 2, hasPdf: true }, { total: 4, placed: 2, hasPdf: true },
  ])
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.setViewportSize({ width: 1904, height: 960 })
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Полинейная сводка', exact: true }).click()
  const grid = page.getByRole('grid', { name: 'Полинейная сводка', exact: true })
  await expect(grid.getByRole('columnheader', { name: 'Состав', exact: true })).toBeVisible()
  await filterValue(page, grid, 'projectTitle', project)
  const cards = page.getByLabel('Итоги полинейной сводки', { exact: true })
  const card = (label: string) => cards.locator(':scope > *').filter({ has: page.getByText(label, { exact: true }) })
  await expect(card('Линий всего')).toContainText('3')
  await expect(card('Линий с PDF')).toContainText('33,3%')
  await expect(card('Линий с PDF')).toContainText('1 из 3 линий')
  await expect(card('Стыков на схемах')).toContainText('18,2%')
  await expect(card('Стыков на схемах')).toContainText('2 из 11 стыков')
  await expect(card('Выполнено')).toContainText('3 из 11')
  await expect(grid.locator('.ag-row [col-id="composition"]').filter({ hasText: 'ОП 1/2' })).toHaveCount(1)
  await expect(grid.locator('.ag-row [col-id="schemePercent"]').filter({ hasText: /^50%$/ })).toHaveCount(2)
  await expect(grid.locator('.ag-row [col-id="completed"]')).not.toContainText(['F ', 'S ', 'ОП '])
  const count = () => calls.filter(call => call.startsWith('getStatisticsServerResult_')).length
  const before = count()
  await filterValue(page, grid, 'line', 'A')
  await expect(card('Линий с PDF')).toContainText('1 из 1 линий')
  await expect(card('Стыков на схемах')).toContainText('2 из 4 стыков')
  await expect(card('Выполнено')).toContainText('2 из 4')
  expect(count()).toBe(before)
  await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  await expect(preview.frameLocator('iframe').getByRole('columnheader', { name: '% на схеме', exact: true })).toBeVisible()
  const workbook = await captureReportExcel(page, preview, info.outputPath('line-summary.xlsx'))
  const cells = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' }))
  const exported = cells.filter(row => row[0] === project)
  expect(exported).toHaveLength(2)
  const compositionIndex = cells.find(row => row[0] === 'Проект' && row[2] === 'Линия')!.indexOf('Состав, сварено/всего (стыки)')
  expect(exported.map(row => row[compositionIndex])).toContain('ОП 1/2')
  expect(exported.map(row => row[10])).toEqual([0.5, 0.5])
  await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
  for (const width of [1904, 1280, 760]) {
    await page.setViewportSize({ width, height: 960 })
    const tops = await cards.locator(':scope > *').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
    expect(tops).toHaveLength(7)
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 1904, height: 960 })
  await page.screenshot({ path: info.outputPath('line-summary.png') })
  // Only scheme versions change: a warmed joint-statistics cache must not hide
  // a new main PDF or saved point removal on the next request.
  await withE2eDatabase(async db => {
    await db.query('update line_scheme_bundles set active_revision_id=$1,version=version+1 where id=$2', [fixture.archive, fixture.archiveBundle])
    await db.query('delete from line_scheme_points where id=$1', [fixture.activePoint])
    await db.query('update line_scheme_revisions set version=version+1 where id=$1', [fixture.active])
  })
  await page.reload()
  await page.getByRole('button', { name: 'Полинейная сводка', exact: true }).click()
  await filterValue(page, grid, 'projectTitle', project)
  await expect(card('Линий с PDF')).toContainText('2 из 3 линий')
  await expect(card('Стыков на схемах')).toContainText('2 из 11 стыков')
  await expect(grid.locator('.ag-row [col-id="schemePercent"]').filter({ hasText: /^25%$/ })).toHaveCount(2)
  await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
  await page.getByRole('button', { name: 'WDI', exact: true }).click()
  await expect(card('Стыков на схемах')).toContainText('2 из 11 стыков')
  await expect(grid.locator('.ag-row [col-id="composition"]').filter({ hasText: 'ОП 1/1' })).toHaveCount(1)
  expect(errors).toEqual([])
})
