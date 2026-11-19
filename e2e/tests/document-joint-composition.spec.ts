import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { SYSTEM_DOCUMENT_TYPES } from '../../src/lib/system-document-types'
import { loadSystemDocumentSummaries, loadIndexedSystemDocumentHistoryGrid, loadIndexedSystemDocumentHistoryFilterOptions } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest, normalizeSystemDocumentHistoryFilterOptionsRequest } from '../../src/server/system-documents'
import { invalidateDerivedCalculationCache } from '../../src/server/dispatcher-task-index-dirty'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { openDocumentGridFilter, openDocumentGridColumnMenu, revealDocumentColumn } from '../document-grid'

import { buildWeldColumnValueFilter } from '../../src/lib/weld-table-filtering'
import { loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest, loadRemoteGeneratedDocumentHistoryFilterOptions, normalizeGeneratedDocumentHistoryFilterOptionsRequest } from '../../src/server/generated-documents'

const project = 'E2E document composition'
const expected = 'F1 S2 F1'
const documents = [
  ['system:lnkRequest', 'ВИК'], ['system:lnkConclusionVik', 'ВИК'],
  ['system:lnkConclusionRk', 'РК'], ['system:lnkConclusionUzk', 'УЗК'], ['system:lnkConclusionPvk', 'ПВК'],
  ['system:pstoRequest', ''], ['system:pstoConclusion', ''],
  ['system:tvmtRequest', 'ТВМТ'], ['system:tvmtConclusion', 'ТВМТ'],
  ['layeredVikEdges', 'ВИК'], ['layeredVikLayers', 'ВИК'], ['layeredPvkEdges', 'ПВК'], ['layeredPvkLayers', 'ПВК'],
]

test.beforeEach(async () => {
  for (const type of SYSTEM_DOCUMENT_TYPES) await loadSystemDocumentSummaries(type)
  await withE2eDatabase(async db => {
    // Equal names on different lines are distinct members; historical rows
    // stay in the document. A fourth unlinked joint must never leak into it.
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,revision_actuality)
      values ($1,'COMP','L1','F1','актуальная'), ($1,'COMP','L1','S2','не актуальная'),
      ($1,'COMP','L2','F1','актуальная'), ($1,'COMP','L2','UNLINKED','актуальная')`, [project])
    for (const [type, method] of documents) {
      const result = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata,period_from)
        values ($1,$2,'composition.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',3,$3,'2026-11-19') returning id`,
      [type, `COMPOSITION-${type}`, JSON.stringify({ label: type, methodCode: method, methodCodes: method ? [method] : [],
        projects: [project], subtitleCodes: ['COMP'], lines: ['L1', 'L2'], positionCount: 3 })])
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select $1,id from weld_joints where project_title=$2 and joint <> 'UNLINKED'`, [result.rows[0].id, project])
    }
  })
})
test.afterEach(async ({ page }) => { await page.close(); await cleanupLineProgramProjects([project]) })

test('composition uses exact document membership in every automatic registry, clipboard and list Excel', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  else await page.addInitScript(() => {
    let text = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { text = value }, readText: async () => text,
    } })
  })
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/documents')
  const tabs = ['Заявка ЛНК', 'Заключения ЛНК', 'Заявка ПСТО', 'Заключение ПСТО', 'Заявка ТВМТ', 'Заключение ТВМТ', 'Послойный ВИК', 'Послойный ПВК']
  for (const tab of tabs) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    const grid = page.locator('[data-document-history-grid]')
    await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('COMPOSITION-')
    const count = tab === 'Заключения ЛНК' ? 4 : tab.startsWith('Послойный') ? 2 : 1
    await expect(grid.getByText(`Найдено: ${count}`, { exact: true })).toBeVisible()
    await revealDocumentColumn(page, 'jointComposition')
    const headers = await grid.locator('.ag-header-cell:not(.ag-hidden)').evaluateAll(elements => elements.map(element => element.getAttribute('col-id')))
    expect(headers.indexOf('jointComposition')).toBe(headers.indexOf('rowCount') + 1)
    const cells = grid.locator('.ag-row:not(.ag-opacity-zero) [col-id="jointComposition"]')
    await expect(cells).toHaveText(Array.from({ length: count }, () => expected))
    await cells.first().click()
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
  }
  const grid = page.locator('[data-document-history-grid]')
  await grid.getByRole('button', { name: 'Показать', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  await expect(preview.frameLocator('iframe').getByText('Состав стыков', { exact: true })).toBeVisible()
  await expect(preview.frameLocator('iframe').getByText(expected, { exact: true })).toHaveCount(2)
  const download = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const path = await (await download).path()
  const workbook = XLSX.read(await readFile(path!), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
  expect(rows.flat().filter(value => value === expected)).toHaveLength(2)
})

test('bounded copy and summaries preserve names and reject a joint rename during a pinned read', async () => {
  const request = normalizeSystemDocumentHistoryGridRequest({ type: 'lnkRequest', search: 'COMPOSITION-', startRow: 0, endRow: 1, rowGroupCols: [], groupKeys: [], sortModel: [] })
  const result = await loadIndexedSystemDocumentHistoryGrid(request)
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({ jointComposition: expected, rowCount: 3 })
  const copy = await loadIndexedSystemDocumentHistoryGrid({ ...request, revision: result.revision, cells: { columns: ['jointComposition'] } })
  expect(copy.cells).toEqual([[expected]])
  const summary = await loadIndexedSystemDocumentHistoryGrid({ ...request, cells: { columns: ['jointComposition'], summary: true } })
  expect(summary.summary).toMatchObject({ count: 1, numericCount: 0 })
  await requireDb().transaction(async tx => {
    await tx.execute(sql`update weld_joints set joint='S20' where project_title=${project} and joint='S2'`)
    await invalidateDerivedCalculationCache(tx)
  })
  await expect(loadIndexedSystemDocumentHistoryGrid({ ...request, revision: result.revision, cells: { columns: ['jointComposition'] } })).rejects.toThrow('Данные реестра изменились')
  expect((await loadIndexedSystemDocumentHistoryGrid(request)).rows[0]).toMatchObject({ jointComposition: 'F1 S20 F1' })
})


async function seedCompositionSearchDocuments() {
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint)
      values ($1,'COMP','L1','A10'), ($1,'COMP','L1','Z99'), ($1,'COMP','L1','')`, [project])
    for (const type of ['system:lnkRequest', 'layeredVikLayers']) {
      const result = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata)
        select $1, 'COMPOSITION-EXTRA-' || lpad(n::text,3,'0'), 'composition.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,$2
        from generate_series(1,121) n returning id,title`,
      [type, JSON.stringify({ methodCode: 'ВИК', methodCodes: ['ВИК'], projects: [project], lines: ['L1'] })])
      for (const row of result.rows) {
        const n = Number(row.title.slice(-3))
        await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
          select $1,id from weld_joints where project_title=$2 and joint=$3`, [row.id, project, n <= 118 ? 'A10' : n <= 120 ? 'Z99' : ''])
      }
    }
  })
}

for (const kind of ['system', 'layered'] as const) {
  test(`composition ${kind}: token search, cross-member phrases, empty values and full Excel agree`, async ({ page }) => {
    await seedCompositionSearchDocuments()
    const source = kind === 'system'
      ? { kind: 'system' as const, type: 'lnkRequest' as const }
      : { kind: 'generated' as const, types: ['layeredVikLayers' as const] }
    const load = (search: string, columnFilters: Record<string, string>) => {
      const request = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [], search, columnFilters }
      return kind === 'system'
        ? loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...request, type: 'lnkRequest' }))
        : loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...request, type: 'layeredVikLayers' }))
    }
    const extra = { title: 'COMPOSITION-EXTRA-' }
    const original = { title: `COMPOSITION-${kind === 'system' ? 'system:lnkRequest' : 'layeredVikLayers'}` }
    const cases = [
      { search: 'z99', columnFilters: extra, count: 2, text: 'Z99' },
      { search: 'a10', columnFilters: extra, count: 118, text: 'A10' },
      { search: 'S2 F1', columnFilters: original, count: 1, text: expected },
      { search: 'COMPOSITION-EXTRA-121', columnFilters: extra, count: 1, text: '' },
    ]
    for (const { search, columnFilters, count, text } of cases) {
      const found = await load(search, columnFilters)
      expect(found.total).toBe(count)
      expect(found.rows).toHaveLength(Math.min(count, 100))
      expect(found.rows.every(row => 'jointComposition' in row && row.jointComposition === text)).toBe(true)
      const response = await page.request.post('/api/document-history-report', { data: {
        format: 'excel', source: { ...source, columnFilters }, title: 'Проверка поиска состава',
        columns: [{ key: 'jointComposition', label: 'Состав стыков' }], search, rowGroupCols: [], sortModel: [],
      } })
      expect(response.ok(), response.ok() ? response.statusText() : await response.text()).toBe(true)
      const workbook = XLSX.read(await response.body(), { type: 'buffer' })
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', blankrows: true })
      expect(rows.slice(1)).toEqual(Array.from({ length: count }, () => [text]))
    }
    expect((await load('z99', { ...extra, jointComposition: buildWeldColumnValueFilter(['A10']) })).total).toBe(0)
    expect((await load('z99', { ...extra, jointComposition: buildWeldColumnValueFilter(['']) })).total).toBe(0)
    expect((await load('UNLINKED', original)).total).toBe(0)
    expect((await load('F1 F1', original)).total).toBe(0)
    expect((await load('unmatched-token', extra)).total).toBe(0)
    const facetRequest = { fieldKey: 'title', gridSearch: 'z99', columnFilters: extra }
    const facet = kind === 'system'
      ? await loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({ ...facetRequest, type: 'lnkRequest' }))
      : await loadRemoteGeneratedDocumentHistoryFilterOptions(normalizeGeneratedDocumentHistoryFilterOptionsRequest({ ...facetRequest, type: 'layeredVikLayers' }))
    expect(facet.options).toHaveLength(2)
    expect(facet.options.every(option => /COMPOSITION-EXTRA-(119|120)$/.test(option.value))).toBe(true)
  })

  test(`composition ${kind}: full-registry filters, options, search, sorting, groups and selection`, async () => {
    await seedCompositionSearchDocuments()
    const load = (overrides: Record<string, unknown> = {}) => {
      const request = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [{ colId: 'title', sort: 'asc' as const }],
        columnFilters: { title: 'COMPOSITION-EXTRA-' }, ...overrides }
      return kind === 'system'
        ? loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...request, type: 'lnkRequest' }))
        : loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...request, type: 'layeredVikLayers' }))
    }
    const options = (overrides: Record<string, unknown> = {}) => {
      const request = { fieldKey: 'jointComposition', columnFilters: { title: 'COMPOSITION-EXTRA-' }, ...overrides }
      return kind === 'system'
        ? loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({ ...request, type: 'lnkRequest' }))
        : loadRemoteGeneratedDocumentHistoryFilterOptions(normalizeGeneratedDocumentHistoryFilterOptionsRequest({ ...request, type: 'layeredVikLayers' }))
    }
    const first = await load()
    expect(first.total).toBe(121)
    expect(first.rows).toHaveLength(100)
    expect(first.rows.every(row => 'jointComposition' in row && row.jointComposition === 'A10')).toBe(true)
    const searched = await load({ search: 'z99' })
    expect(searched.total).toBe(2)
    const chosen = { title: 'COMPOSITION-EXTRA-', jointComposition: buildWeldColumnValueFilter(['Z99']) }
    expect((await load({ columnFilters: chosen })).total).toBe(2)
    expect((await load({ columnFilters: { ...chosen, jointComposition: 'z9' } })).total).toBe(2)
    expect((await load({ columnFilters: { ...chosen, jointComposition: buildWeldColumnValueFilter(['Z99', '']) } })).total).toBe(3)
    expect((await load({ columnFilters: { ...chosen, jointComposition: buildWeldColumnValueFilter(['']) } })).total).toBe(1)
    expect((await load({ columnFilters: { ...chosen, jointComposition: 'missing' } })).total).toBe(0)
    expect((await options({ search: 'z9', columnFilters: { ...chosen, jointComposition: 'A10' } })).options)
      .toEqual([{ value: 'Z99', label: 'Z99', count: 2 }])
    expect((await options({ fieldKey: 'title', gridSearch: 'z99' })).options).toHaveLength(2)
    const sorted = await load({ endRow: 1, sortModel: [{ colId: 'jointComposition', sort: 'desc' }] })
    expect(sorted.rows[0]).toMatchObject({ jointComposition: 'Z99' })
    // Like other text columns, ascending order places empty text first.
    const asc = await load({ endRow: 2, sortModel: [{ colId: 'jointComposition', sort: 'asc' }] })
    expect(asc.rows).toMatchObject([{ jointComposition: '' }, { jointComposition: 'A10' }])
    const copied = await load({ columnFilters: chosen, revision: (await load({ columnFilters: chosen })).revision, cells: { columns: ['jointComposition'] } })
    expect(copied.cells).toEqual([['Z99'], ['Z99']])
    const ids = await load({ columnFilters: chosen, idsOnly: true })
    expect(ids.ids).toHaveLength(2)
    const groups = await load({ rowGroupCols: ['jointComposition'], sortModel: [] })
    expect(groups.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupLabel: 'A10', childCount: 118 }),
      expect.objectContaining({ groupLabel: 'Z99', childCount: 2 }),
      expect.objectContaining({ groupLabel: '(пусто)', childCount: 1 }),
    ]))
    expect(groups.rows).toHaveLength(3)
    expect((await load({ rowGroupCols: ['jointComposition'], groupKeys: ['["value","Z99"]'] })).rows).toHaveLength(2)
  })

  test(`composition ${kind}: column menu filter, saved settings, sorting and filtered Excel`, async ({ page }, testInfo) => {
    await seedCompositionSearchDocuments()
    await page.setViewportSize({ width: 1900, height: 1000 })
    await page.goto('/documents')
    const tab = kind === 'system' ? 'Заявка ЛНК' : 'Послойный ВИК'
    await page.getByRole('button', { name: tab, exact: true }).click()
    const grid = page.locator('[data-document-history-grid]')
    await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill('COMPOSITION-EXTRA-')
    await expect(grid.getByText('Найдено: 121', { exact: true })).toBeVisible()
    await openDocumentGridColumnMenu(page, 'jointComposition')
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
    const cells = grid.locator('.ag-row:not(.ag-opacity-zero) [col-id="jointComposition"]')
    await expect(cells.first()).toHaveText('Z99')
    let filter = await openDocumentGridFilter(page, 'jointComposition', 'Состав стыков')
    await filter.getByRole('textbox', { name: 'Найти значение фильтра', exact: true }).fill('z9')
    await filter.getByRole('checkbox', { name: /Z99/ }).check()
    await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
    await expect(grid.getByText('Найдено: 2', { exact: true })).toBeVisible()
    await expect(cells).toHaveText(['Z99', 'Z99'])
    // Position/search persistence follows the rendered grid on an animation
    // frame. Do not reload before this snapshot exists, especially in WebKit.
    const viewId = await grid.getAttribute('data-document-history-grid')
    try {
      await expect.poll(() => page.evaluate(id => {
        const key = Object.keys(sessionStorage).find(key => key.endsWith(`welding-journal:documents:grid-session:v1:${id}`))
        const saved = key ? JSON.parse(sessionStorage.getItem(key)!) : null
        return saved?.search === 'COMPOSITION-EXTRA-' && JSON.parse(saved.scope)[0].some(([field]: [string, string]) => field === 'jointComposition')
      }, viewId)).toBe(true)
    } catch (failure) {
      // Inspect only after failure so diagnostics cannot change capture/RAF timing.
      const state = await page.evaluate(id => {
        const frame = document.querySelector<HTMLElement>('[data-document-history-grid]')
        const viewport = frame?.querySelector<HTMLElement>('.ag-grid-viewport')
        const rect = (element: Element | null | undefined) => element?.getBoundingClientRect().toJSON() ?? null
        return {
          viewId: id,
          sessions: Object.fromEntries(Object.keys(sessionStorage)
            .filter(key => key.endsWith(`welding-journal:documents:grid-session:v1:${id}`))
            .map(key => [key, JSON.parse(sessionStorage.getItem(key)!)])),
          window: { scrollX, scrollY, innerWidth, innerHeight },
          frame: rect(frame), viewport: { rect: rect(viewport), top: viewport?.scrollTop, left: viewport?.scrollLeft },
          header: rect(frame?.querySelector('.ag-header')),
          navigation: rect(document.querySelector('[data-documents-navigation]')),
          rows: Array.from(frame?.querySelectorAll<HTMLElement>('.ag-row[row-id]') ?? []).map(row => ({
            id: row.getAttribute('row-id'), index: row.getAttribute('row-index'), classes: row.className,
            rect: rect(row), text: row.textContent,
          })),
        }
      }, viewId)
      await testInfo.attach('document-grid-session-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' })
      throw failure
    }
    await grid.getByRole('button', { name: 'Показать', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    await expect(preview.frameLocator('iframe').getByText('Z99', { exact: true })).toHaveCount(2)
    const download = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const path = await (await download).path()
    const book = XLSX.read(await readFile(path!), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1 })
    expect(rows.flat().filter(value => value === 'Z99')).toHaveLength(2)
    expect(rows.flat()).not.toContain('A10')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await page.reload()
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(grid.getByText('Найдено: 2', { exact: true })).toBeVisible()
    await revealDocumentColumn(page, 'jointComposition')
    await expect(grid.locator('.ag-header-cell[col-id="jointComposition"]')).toHaveAttribute('aria-sort', 'descending')
    filter = await openDocumentGridFilter(page, 'jointComposition', 'Состав стыков')
    await filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click()
    await filter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
    await expect(grid.getByText('Найдено: 121', { exact: true })).toBeVisible()
    await openDocumentGridColumnMenu(page, 'jointComposition')
    await page.getByRole('menuitem', { name: 'Сгруппировать по «Состав стыков»', exact: true }).click()
    await expect(grid.locator('.ag-full-width-row.ag-row-group')).toHaveCount(3)
  })
}


for (const kind of ['system', 'layered'] as const) test(`composition ${kind}: long selected value keeps other facets and method counts available`, async ({ page }) => {
  const title = `COMPOSITION-LONG-${kind}`
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint)
      select $1,'COMP','LONG','LONGJOINT-' || lpad(n::text,5,'0') from generate_series(1,1600) n`, [project])
    const document = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,source_metadata)
      values ($1,$2,'long.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1600,$3) returning id`,
    [kind === 'system' ? 'system:lnkConclusionVik' : 'layeredVikLayers', title,
      JSON.stringify({ methodCode: 'ВИК', methodCodes: ['ВИК'], projects: [project], subtitleCodes: ['COMP'], lines: ['LONG'] })])
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select $1,id from weld_joints where project_title=$2 and line='LONG'`, [document.rows[0].id, project])
  })
  const calls: Array<{ field: string; length: number; method: string; status: number }> = []
  page.on('response', response => {
    const request = response.request()
    if (!rpcName(request.url()).includes('DocumentHistoryFilterOptions') || !request.postData()) return
    const data = (deserializeRpcPayload(request.postData()!) as { data: { fieldKey: string; columnFilters?: Record<string, string> } }).data
    calls.push({ field: data.fieldKey, length: data.columnFilters?.jointComposition?.length ?? 0, method: request.method(), status: response.status() })
  })
  await page.setViewportSize({ width: 1900, height: 1000 })
  await page.goto('/documents')
  await page.getByRole('button', { name: kind === 'system' ? 'Заключения ЛНК' : 'Послойный ВИК', exact: true }).click()
  const grid = page.locator('[data-document-history-grid]')
  await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(title)
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  const composition = await openDocumentGridFilter(page, 'jointComposition', 'Состав стыков')
  await composition.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await composition.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  // Other facets carry the selected full composition; GET would exceed Node's
  // request-header limit. Conclusions also refresh method counts automatically.
  const line = await openDocumentGridFilter(page, 'line', 'Линия')
  await expect(line.getByRole('checkbox', { name: /LONG/ })).toBeVisible()
  await expect(line.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => calls.some(call => call.field === 'line' && call.length > 16_384 && call.method === 'POST' && call.status === 200)).toBe(true)
  if (kind === 'system') await expect.poll(() => calls.some(call => call.field === 'method' && call.length > 16_384 && call.method === 'POST' && call.status === 200)).toBe(true)
})
