import { expect, test, type Locator, type Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import pg from 'pg'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-table-filtering'
import { isDocumentHistoryGroupRow, type DocumentHistoryGridRequest } from '../../src/lib/document-history-grid'
import { loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest, loadRemoteGeneratedDocumentHistoryFilterOptions, normalizeGeneratedDocumentHistoryFilterOptionsRequest } from '../../src/server/generated-documents'
import { loadIndexedSystemDocumentHistoryGrid, loadIndexedSystemDocumentHistoryFilterOptions, loadSystemDocumentSummaries, rebuildSystemDocumentIndexInTransaction, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { normalizeSystemDocumentHistoryGridRequest, normalizeSystemDocumentHistoryFilterOptionsRequest } from '../../src/server/system-documents'
import { assertSafeE2eDatabaseUrl, withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { openDocumentGridColumnMenu, openDocumentGridFilter, revealDocumentColumn as revealGridColumn } from '../document-grid'

const project = 'E2E document grid blocks'
const defaults: DocumentHistoryGridRequest = { startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
type Kind = 'generated' | 'system'
const columnFilters = { project: buildWeldColumnValueFilter([project]) }

test.beforeEach(async () => {
  assertSafeE2eDatabaseUrl(process.env.DATABASE_URL ?? '')
  await cleanupLineProgramProjects([project])
  await loadSystemDocumentSummaries('lnkRequest')
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'GRID',case when n=250 then '' when n=249 then case when position=1 then 'LINE-A' else 'LINE-B' end
        when n%2=1 then 'LINE-A' else 'LINE-B' end,
        'F'||n||'-'||position,n::text,'2026-10-01','действующий','актуальная','да','GRID-REQ-'||lpad(n::text,3,'0'),'2026-10-02'
      from generate_series(1,250) n
      cross join lateral generate_series(1,case when n=1 then 10 when n in (2,249) then 2 else 1 end) position`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','GRID-DOC-'||lpad(n::text,3,'0'),'grid.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',0
      from generate_series(1,250) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w on d.title='GRID-DOC-'||lpad(w.isometry,3,'0')
      where d.type='weldingJournal' and w.project_title=$1`, [project])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async () => { await cleanupLineProgramProjects([project]) })

async function read(kind: Kind, request: Partial<DocumentHistoryGridRequest> = {}) {
  return kind === 'generated'
    ? loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...defaults, ...request, type: 'weldingJournal', columnFilters }))
    : loadIndexedSystemDocumentHistoryGrid(normalizeSystemDocumentHistoryGridRequest({ ...defaults, ...request, type: 'lnkRequest', columnFilters }))
}

function observeDocumentRequests(page: Page) {
  const calls: string[] = [], blocks: DocumentHistoryGridRequest[] = []
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/')) return
    const name = rpcName(request.url())
    calls.push(name)
    if (name.includes('DocumentHistoryGrid')) {
      const payload = deserializeRpcPayload(request.postData()!) as { data: DocumentHistoryGridRequest }
      blocks.push(payload.data)
    }
  })
  return { calls, blocks, dataCalls: () => calls.filter(name => name.includes('DocumentHistoryGrid') || name.includes('DocumentHistoryFilterOptions')) }
}

async function checkboxPaint(checkbox: Locator) {
  await checkbox.focus()
  return checkbox.evaluate(element => {
    const wrapper = element.closest('.ag-checkbox-input-wrapper')
    if (!wrapper) throw new Error('Checkbox is missing the native AG wrapper')
    const style = getComputedStyle(wrapper), icon = getComputedStyle(wrapper, '::after')
    return {
      width: style.width, height: style.height, borderRadius: style.borderRadius,
      borderWidth: style.borderWidth, color: style.color, background: style.backgroundColor, boxShadow: style.boxShadow,
      icon: { content: icon.content, color: icon.color, mask: icon.maskImage, background: icon.backgroundColor },
      inputOpacity: getComputedStyle(element).opacity,
    }
  })
}

test('document grid: full-query groups, bounded blocks, typed sorting and literal searches for generated/system documents', async () => {
  for (const kind of ['generated', 'system'] as const) {
    const first = await read(kind, { sortModel: [{ colId: 'title', sort: 'asc' }] })
    const second = await read(kind, { startRow: 100, endRow: 200, sortModel: [{ colId: 'title', sort: 'asc' }] })
    expect(first.rows).toHaveLength(100)
    expect(second.rows).toHaveLength(100)
    expect(first.total).toBe(250)
    expect(first.rowCount).toBe(250)
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(200)
    const groups = await read(kind, { rowGroupCols: ['line'], endRow: 2 })
    expect(groups.rows).toHaveLength(2)
    expect(groups.rowCount).toBe(4)
    expect(groups.total).toBe(250)
    const allGroups = await read(kind, { rowGroupCols: ['line'] })
    expect(allGroups.rows.every(isDocumentHistoryGroupRow)).toBe(true)
    expect(Object.fromEntries(allGroups.rows.filter(isDocumentHistoryGroupRow).map(row => [row.groupLabel, row.childCount]))).toEqual({
      '(пусто)': 1, 'LINE-A': 124, 'LINE-B': 124, 'Несколько линий': 1,
    })
    const multi = allGroups.rows.find(row => isDocumentHistoryGroupRow(row) && row.groupLabel === 'Несколько линий')!
    expect(isDocumentHistoryGroupRow(multi)).toBe(true)
    if (!isDocumentHistoryGroupRow(multi)) throw new Error('Missing multi-value group')
    const members = await read(kind, { rowGroupCols: ['line'], groupKeys: [multi.groupKey] })
    expect(members.rows).toHaveLength(1)
    expect(members.rows[0]).toMatchObject({ title: kind === 'generated' ? 'GRID-DOC-249' : 'GRID-REQ-249', lines: ['LINE-A', 'LINE-B'] })
    expect(members.total).toBe(250)
    const counts = await read(kind, { sortModel: [{ colId: 'rowCount', sort: 'desc' }], endRow: 3 })
    expect(counts.rows.map(row => row.rowCount)).toEqual([10, 2, 2])
    const last = await read(kind, { search: kind === 'generated' ? 'DOC-250' : 'REQ-250' })
    expect(last.total).toBe(1)
    expect(last.rows[0]).toMatchObject({ title: kind === 'generated' ? 'GRID-DOC-250' : 'GRID-REQ-250' })
  }
})

test('document grid: exact selections survive unrelated blocks/groups; hydration and facet search stay scoped with constant SQL', async ({}, info) => {
  const measurements: Array<{ kind: Kind; selected: number; statements: number; bytes: number }> = []
  for (const kind of ['generated', 'system'] as const) {
    const whole = await read(kind, { endRow: 300, sortModel: [{ colId: 'title', sort: 'asc' }] })
    const selectedIds = [whole.rows[0].id, whole.rows[249].id]
    const grouped = await read(kind, { rowGroupCols: ['line'], groupKeys: ['["value","LINE-B"]'], selectedIds })
    expect(grouped.matchingSelectedIds).toEqual(selectedIds)
    expect(grouped.rows.some(row => row.id === selectedIds[0])).toBe(false)
    const restored = await read(kind, { rowGroupCols: ['line'], groupKeys: ['["value","no longer exists"]'], selectedIds, selectionOnly: true, startRow: 100, endRow: 200 })
    expect(new Set(restored.rows.map(row => row.id))).toEqual(new Set(selectedIds))
    const narrowed = await read(kind, { selectedIds, search: kind === 'generated' ? 'DOC-250' : 'REQ-250' })
    expect(narrowed.matchingSelectedIds).toEqual([selectedIds[1]])
    const facetRequest = { fieldKey: 'line', gridSearch: kind === 'generated' ? 'DOC-249' : 'REQ-249', columnFilters }
    const facets = kind === 'generated'
      ? await loadRemoteGeneratedDocumentHistoryFilterOptions(normalizeGeneratedDocumentHistoryFilterOptionsRequest({ ...facetRequest, type: 'weldingJournal' }))
      : await loadIndexedSystemDocumentHistoryFilterOptions(normalizeSystemDocumentHistoryFilterOptionsRequest({ ...facetRequest, type: 'lnkRequest' }))
    expect(facets.options.map(option => [option.value, option.count])).toEqual([['LINE-A', 1], ['LINE-B', 1]])
    const original = pg.Client.prototype.query
    let statements: string[] = []
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const statement = args[0] as string | { text?: string }
      statements.push(typeof statement === 'string' ? statement : statement.text ?? '')
      return (original as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof original
    try {
      let baseline: number | undefined
      for (const count of [2, 100, 250]) {
        statements = []
        const result = await read(kind, { selectedIds: whole.rows.slice(0, count).map(row => row.id), selectionOnly: true })
        expect(result.rows).toHaveLength(count)
        baseline ??= statements.length
        expect(statements).toHaveLength(baseline)
        // Settings + aggregate, or transaction + index lock/state + aggregate.
        expect(statements.length).toBe(kind === 'generated' ? 2 : 5)
        expect(statements.filter(statement => statement.includes('"block_rows" as materialized'))).toHaveLength(1)
        measurements.push({ kind, selected: count, statements: statements.length, bytes: Buffer.byteLength(JSON.stringify(result)) })
      }
    } finally { pg.Client.prototype.query = original }
  }
  await info.attach('document-grid-query-counts', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})

test('document registries keep plain joint counts and their document actions without inline details', async ({ page }) => {
  const observed = observeDocumentRequests(page)
  await page.goto('/documents')
  for (const [view, selector, action] of [
    ['ЖСР', '[data-document-history-grid="generated:weldingJournal"]', 'Показать стыки в журнале'],
    ['Заявка ЛНК', '[data-document-history-grid^="system:lnkRequest:"]', 'Показать стыки в отчете'],
  ]) {
    await page.getByRole('button', { name: view, exact: true }).click()
    const grid = page.locator(selector)
    await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
    await revealGridColumn(page, 'rowCount')
    const row = grid.locator('.ag-row[row-id^="document:"]').first()
    await row.getByRole('checkbox').check()
    const count = row.locator('.ag-cell[col-id="rowCount"]')
    await expect(count).toContainText(/\d+/)
    await expect(count.getByRole('button')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    const reads = observed.calls.length
    await count.click()
    await count.press('Enter')
    await count.press('F2')
    await expect(grid.locator('.ag-full-width-row')).toHaveCount(0)
    await expect(row.getByRole('checkbox')).toBeChecked()
    await page.waitForLoadState('networkidle')
    expect(observed.calls).toHaveLength(reads)
    await count.click({ button: 'right' })
    await expect(page.getByRole('button', { name: 'Состав документа', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(row.getByRole('checkbox')).toBeChecked()
  }
})

test('document grid browser: sticky header, selection across blocks/groups, hidden filters and bounded focus requests', async ({ page }, info) => {
  const diagnostics: string[] = [], calls: string[] = []
  page.on('pageerror', error => diagnostics.push(error.message))
  // Match the journal's AG Grid diagnostics gate. The standalone Enterprise
  // licence banner is not an AG Grid runtime/module warning and is tracked separately.
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && /AG Grid:/.test(message.text())) diagnostics.push(message.text()) })
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.setViewportSize({ width: 1600, height: 1000 })
  const documents = await read('generated', { endRow: 300, sortModel: [{ colId: 'title', sort: 'asc' }] })
  const firstId = documents.rows[0].id, lastId = documents.rows[249].id
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const projectHeader = await revealGridColumn(page, 'project')
  await projectHeader.locator('.ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.locator('label').filter({ hasText: project }).getByRole('checkbox').check()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await expect(projectHeader.locator('.ag-header-cell-filter-button')).toHaveClass(/ag-filter-active/)
  await expect(grid.locator('.document-grid-filter-chips')).toHaveCount(0)
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  const firstRow = grid.locator(`.ag-row[row-id="document:${firstId}"]`)
  await expect(firstRow).toBeVisible()
  await firstRow.getByRole('checkbox').check()
  await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  const viewport = grid.locator('.ag-grid-viewport')
  const point = await viewport.boundingBox()
  if (!point) throw new Error('Document viewport is missing')
  await page.mouse.move(point.x + point.width / 2, Math.min(850, point.y + 180))
  await page.mouse.wheel(0, 1200)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  const header = grid.locator('.ag-header')
  await expect.poll(() => header.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const navigation = document.querySelector('[data-documents-navigation]')!.getBoundingClientRect()
    return rect.top >= navigation.bottom - 1 && rect.bottom <= window.innerHeight
  })).toBe(true)
  await page.mouse.wheel(0, 25_000)
  const lastRow = grid.locator(`.ag-row[row-id="document:${lastId}"]`)
  await expect(lastRow).toBeVisible()
  await lastRow.getByRole('checkbox').check()
  await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
  await lastRow.getByRole('button', { name: 'GRID-DOC-250', exact: true }).click({ button: 'right' })
  await expect(page.getByRole('button', { name: 'Скачать выбранные архивом (2)', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  const titleCell = lastRow.locator('.ag-cell[col-id="title"]')
  await titleCell.focus()
  await titleCell.press('Shift+F10')
  await expect(page.getByRole('button', { name: 'Скачать выбранные архивом (2)', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(titleCell).toBeFocused()
  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
  await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
  const lineGroup = grid.locator('.ag-row-group').filter({ hasText: 'LINE-A' }).first()
  await expect(lineGroup).toContainText('124')
  await lineGroup.locator('.ag-group-contracted').click()
  await expect(grid.getByRole('button', { name: 'GRID-DOC-001', exact: true })).toBeVisible()
  await lineGroup.locator('.ag-group-expanded').click()
  await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов' })
  await settings.getByRole('checkbox', { name: 'Проект', exact: true }).uncheck()
  await expect(settings.getByLabel('Активный фильтр: Проект', { exact: true })).toHaveAttribute('title', 'Фильтр действует и для скрытого столбца')
  await settings.getByRole('button', { name: 'Закрыть настройки вида' }).click()
  await expect(grid.locator('.document-grid-filter-chips')).toHaveCount(0)
  await expect(grid.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible()
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const beforeFocus = calls.filter(name => name.includes('DocumentHistoryGrid') || name.includes('DocumentHistoryFilterOptions')).length
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(400)
  expect(calls.filter(name => name.includes('DocumentHistoryGrid') || name.includes('DocumentHistoryFilterOptions'))).toHaveLength(beforeFocus)
  await page.screenshot({ path: info.outputPath('document-groups-hidden-filter.png') })
  expect(diagnostics).toEqual([])
})

test('document grid browser: registry return restores a distant position, explicit selection and expanded groups with bounded reloads', async ({ page }) => {

  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.setViewportSize({ width: 1600, height: 1000 })
  const documents = await read('generated', { endRow: 300, sortModel: [{ colId: 'title', sort: 'asc' }] })
  const firstId = documents.rows[0].id, lastId = documents.rows[249].id
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const projectHeader = await revealGridColumn(page, 'project')
  await projectHeader.locator('.ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.locator('label').filter({ hasText: project }).getByRole('checkbox').check()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  await grid.locator(`.ag-row[row-id="document:${firstId}"]`).getByRole('checkbox').check()
  const viewport = grid.locator('.ag-grid-viewport')
  const scrollViewport = async (delta = 25_000) => {
    const box = await viewport.boundingBox()
    if (!box) throw new Error('Document viewport is missing')
    await page.mouse.move(box.x + box.width / 2, Math.min(850, box.y + 180))
    await page.mouse.wheel(0, delta)
  }
  // Read the first actually visible row, excluding AG Grid's buffered DOM rows.
  const firstVisible = () => grid.evaluate(element => {
    const viewport = element.querySelector('.ag-grid-viewport')!.getBoundingClientRect()
    const header = element.querySelector('.ag-header')!.getBoundingClientRect()
    const top = Math.max(viewport.top, header.bottom), bottom = Math.min(viewport.bottom, window.innerHeight)
    return Array.from(element.querySelectorAll<HTMLElement>('.ag-row[row-id]'))
      .map(row => ({ id: row.getAttribute('row-id'), index: Number(row.getAttribute('row-index')), rect: row.getBoundingClientRect() }))
      .filter(row => row.rect.bottom > top + 1 && row.rect.top < bottom - 1)
      .sort((left, right) => left.rect.top - right.rect.top)
      .map(row => ({ id: row.id, index: row.index }))[0] ?? null
  })
  const returnToRegistry = async (grouped = false) => {
    const position = await firstVisible()
    expect(position).not.toBeNull()
    expect(position!.index).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
    await expect(page.locator('[data-document-history-grid^="system:lnkRequest:"]')).toBeVisible()
    const beforeReturn = calls.filter(name => name.includes('GeneratedDocumentHistoryGrid')).length
    // Register before remounting: a previously reached SPA networkidle state
    // does not wait for SSRM's debounced native requests after a new view opens.
    const expectedBlocks = grouped
      ? [{ route: ['["value","LINE-A"]'], start: 0 }, { route: ['["value","LINE-A"]'], start: 100 }]
      : [{ route: [], start: 0 }, { route: [], start: 200 }]
    const responses = expectedBlocks.map(block => page.waitForResponse(response => {
      if (!rpcName(response.url()).includes('GeneratedDocumentHistoryGrid')) return false
      const payload = deserializeRpcPayload(response.request().postData()!) as { data: DocumentHistoryGridRequest }
      return !payload.data.selectionOnly && payload.data.startRow === block.start && JSON.stringify(payload.data.groupKeys) === JSON.stringify(block.route)
    }))
    await page.getByRole('button', { name: 'ЖСР', exact: true }).click()
    await Promise.all((await Promise.all(responses)).map(response => response.finished()))
    await expect(grid.locator('.document-grid-footer').getByText('Загрузка…', { exact: true })).toBeHidden()
    await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect.poll(firstVisible).toEqual(position)
    await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
    const restoredProjectHeader = await revealGridColumn(page, 'project')
    await expect(restoredProjectHeader.locator('.ag-header-cell-filter-button')).toHaveClass(/ag-filter-active/)
    await expect(grid.locator('.document-grid-filter-chips')).toHaveCount(0)
    // First block, the saved position/group blocks, and exact-selection hydration
    // may reload. Returning must not enumerate all documents one by one.
    const reloads = calls.filter(name => name.includes('GeneratedDocumentHistoryGrid')).length - beforeReturn
    expect(reloads).toBeGreaterThan(0)
    expect(reloads).toBeLessThanOrEqual(6)
  }
  await scrollViewport()
  const lastRow = grid.locator(`.ag-row[row-id="document:${lastId}"]`)
  await expect(lastRow).toBeVisible()
  await lastRow.getByRole('checkbox').check()
  await returnToRegistry()
  await expect(lastRow.getByRole('checkbox')).toBeChecked()

  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
  const lineGroup = grid.locator('.ag-row-group').filter({ hasText: 'LINE-A' }).first()
  await lineGroup.locator('.ag-group-contracted').click()
  await expect(grid.getByRole('button', { name: 'GRID-DOC-001', exact: true })).toBeVisible()
  await scrollViewport()
  await expect(grid.getByRole('button', { name: 'GRID-DOC-247', exact: true })).toBeVisible()
  await returnToRegistry(true)
  await expect(grid.getByRole('button', { name: 'GRID-DOC-247', exact: true })).toBeVisible()
  // A new operator gesture must cancel any remaining restore work. A bare
  // scrollTop assignment is indistinguishable from the restore's own writes.
  await scrollViewport(-25_000)
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(0)
  await expect(lineGroup.locator('.ag-group-expanded')).toBeVisible()
  await expect(grid.locator(`.ag-row[row-id="document:${firstId}"]`).getByRole('checkbox')).toBeChecked()
})

test('document grid browser: restores a child block beneath a distant root group without enumerating earlier groups', async ({ page }, info) => {
  // 250 distinct root groups, with 126 children in the last group. Neither the
  // ancestor nor the target child belongs to its store's first block.
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set line='LINE-'||lpad(isometry,3,'0') where project_title=$1", [project])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'GRID','LINE-250','RESTORE-F'||n,n::text,'2026-10-01','действующий','актуальная','да',
        'GRID-REQ-'||n,'2026-10-02' from generate_series(251,375) n`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','GRID-DOC-'||n,'grid.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
      from generate_series(251,375) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w on d.title='GRID-DOC-'||w.isometry
      where d.type='weldingJournal' and w.project_title=$1 and w.joint like 'RESTORE-F%'`, [project])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const groups = await read('generated', { rowGroupCols: ['line'], startRow: 200, endRow: 300 })
  expect(groups.rowCount).toBe(250)
  expect(groups.rows.at(-1)).toMatchObject({ __group: true, groupLabel: 'LINE-250', childCount: 126 })
  const documents = await read('generated', { endRow: 400, sortModel: [{ colId: 'title', sort: 'asc' }] })
  const firstId = documents.rows[0].id, lastId = documents.rows[374].id
  const requests: DocumentHistoryGridRequest[] = [], diagnostics: string[] = []
  page.on('pageerror', error => diagnostics.push(error.message))
  page.on('console', message => { if (['warning', 'error'].includes(message.type()) && /AG Grid:/.test(message.text())) diagnostics.push(message.text()) })
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/')) return
    const name = rpcName(request.url()), base = 'listRemoteGeneratedDocumentHistoryGrid'
    if (name !== base && !name.startsWith(`${base}_`)) return
    const payload = deserializeRpcPayload(request.postData()!) as { data: DocumentHistoryGridRequest }
    requests.push(payload.data)
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 375', { exact: true })).toBeVisible()
  const projectHeader = await revealGridColumn(page, 'project')
  await projectHeader.locator('.ag-header-cell-filter-button').click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.locator('label').filter({ hasText: project }).getByRole('checkbox').check()
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  await grid.locator(`.ag-row[row-id="document:${firstId}"]`).getByRole('checkbox').check()
  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
  const viewport = grid.locator('.ag-grid-viewport')
  const wheelToBottom = async () => {
    const box = await viewport.boundingBox()
    if (!box) throw new Error('Document viewport is missing')
    await page.mouse.move(box.x + box.width / 2, Math.min(850, box.y + 180))
    await page.mouse.wheel(0, 30_000)
  }
  // The initial SSRM store has a provisional scroll range until its first
  // response supplies the full root count (250 groups plus the header).
  await expect(grid.getByRole('treegrid')).toHaveAttribute('aria-rowcount', '251')
  await expect(grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: 'LINE-001' })).toBeVisible()
  await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
  await wheelToBottom()
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(10_000)
  const farGroup = grid.locator('.ag-row-group').filter({ hasText: 'LINE-250' }).first()
  await expect(farGroup).toBeInViewport()
  await expect(farGroup).toContainText('126')
  await farGroup.locator('.ag-group-contracted').click()
  const ancestorScroll = await viewport.evaluate(element => element.scrollTop)
  // The child store initially has one loading stub. Wait for its server count
  // to create the actual scroll range before sending the next wheel gesture.
  await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(ancestorScroll + 5_000)
  await wheelToBottom()
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(ancestorScroll + 5_000)
  const lastRow = grid.locator(`.ag-row[row-id="document:${lastId}"]`)
  await expect(lastRow).toBeInViewport()
  await lastRow.getByRole('checkbox').check()
  await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
  const firstVisibleDocument = () => grid.evaluate(element => {
    const viewport = element.querySelector('.ag-grid-viewport')!.getBoundingClientRect()
    const header = element.querySelector('.ag-header')!.getBoundingClientRect()
    const top = Math.max(viewport.top, header.bottom), bottom = Math.min(viewport.bottom, window.innerHeight)
    return Array.from(element.querySelectorAll<HTMLElement>('.ag-row[row-id^="document:"]'))
      .map(row => ({ id: row.getAttribute('row-id'), index: Number(row.getAttribute('row-index')), rect: row.getBoundingClientRect() }))
      .filter(row => row.rect.bottom > top + 1 && row.rect.top < bottom - 1)
      .sort((left, right) => left.rect.top - right.rect.top)
      .map(row => ({ id: row.id, index: row.index }))[0] ?? null
  })
  await page.waitForLoadState('networkidle')
  const savedPosition = await firstVisibleDocument()
  expect(savedPosition).not.toBeNull()
  expect(savedPosition!.index).toBeGreaterThanOrEqual(350)
  const savedScroll = await viewport.evaluate(element => element.scrollTop)
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await expect(page.locator('[data-document-history-grid^="system:lnkRequest:"]')).toBeVisible()
  const beforeReturn = requests.length
  await page.getByRole('button', { name: 'ЖСР', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await expect.poll(firstVisibleDocument).toEqual(savedPosition)
  await expect.poll(async () => Math.abs(await viewport.evaluate(element => element.scrollTop) - savedScroll)).toBeLessThanOrEqual(1)
  await expect(lastRow.getByRole('checkbox')).toBeChecked()
  await expect(grid.getByText('Выбрано: 2', { exact: true })).toBeVisible()
  const restoredIds: Array<string | number> = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-journal:documents:session:v1:generated:weldingJournal')) ?? 'welding-journal:documents:session:v1:generated:weldingJournal')!).selectedDocumentIds)
  // Hydration returns server-ordered snapshots; explicit selection is an exact
  // set of documents, independent of the order in which its checkboxes were set.
  expect(restoredIds.map(String).sort()).toEqual([firstId, lastId].map(String).sort())
  await page.waitForLoadState('networkidle')
  const reloaded = requests.slice(beforeReturn)
  expect(reloaded.filter(request => request.selectionOnly)).toHaveLength(0)
  expect(reloaded.some(request => !request.selectionOnly && request.groupKeys.length === 0 && request.startRow === 200)).toBe(true)
  expect(reloaded.some(request => !request.selectionOnly && request.groupKeys[0] === '["value","LINE-250"]' && request.startRow === 100)).toBe(true)
  const blocks = reloaded.filter(request => !request.selectionOnly && !request.countRoutes)
  expect(blocks.length).toBeGreaterThan(0)
  const allowedBlocks = new Set([
    JSON.stringify([[], 0]), JSON.stringify([[], 200]),
    JSON.stringify([['["value","LINE-250"]'], 0]), JSON.stringify([['["value","LINE-250"]'], 100]),
  ])
  for (const request of blocks) {
    expect(allowedBlocks.has(JSON.stringify([request.groupKeys, request.startRow]))).toBe(true)
    expect(request.endRow - request.startRow).toBeLessThanOrEqual(100)
  }
  // Native AG stores load root0 and may start child0 when the distant ancestor
  // opens; explicit restoration loads root200 and child100, plus one selection
  // hydration. Their scheduling/coalescing must not determine test success.
  // The O(depth) bound allows 2*depth+4 calls, while the block whitelist forbids
  // intermediate root100 or any traversal of the preceding registry prefix.
  const groupDepth = 1
  expect(reloaded.length).toBeLessThanOrEqual(2 * groupDepth + 4)
  expect(diagnostics).toEqual([])
  await info.attach('distant-document-group-restoration', { body: JSON.stringify({ savedPosition, savedScroll, requests: reloaded }, null, 2), contentType: 'application/json' })
})

for (const kind of ['generated', 'system'] as const) test(`document grid browser: ${kind} recovers a failed filter and ignores a late previous search without reviving selection`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  if (kind === 'system') await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const grid = page.locator(kind === 'generated'
    ? '[data-document-history-grid="generated:weldingJournal"]'
    : '[data-document-history-grid^="system:lnkRequest:"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await grid.locator('.ag-row[row-id^="document:"]').first().getByRole('checkbox').check()
  await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  const prefix = kind === 'generated' ? 'GRID-DOC-' : 'GRID-REQ-'
  const search = grid.getByRole('textbox', { name: 'Поиск документов', exact: true })
  let first = true, held = false, release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    const request = route.request()
    if (!rpcName(request.url()).includes('DocumentHistoryGrid')) return route.continue()
    const payload = deserializeRpcPayload(request.postData()!) as { data: DocumentHistoryGridRequest }
    if (payload.data.selectionOnly || payload.data.search !== `${prefix}001`) return route.continue()
    if (first) { first = false; return route.abort('failed') }
    held = true
    await pending
    await route.continue()
  })
  try {
    await search.fill(`${prefix}001`)
    await expect(grid.locator('.document-grid-error')).toBeVisible()
    await expect(grid.locator('.document-grid-toolbar-actions')).toHaveAttribute('disabled', '')
    await grid.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect.poll(() => held).toBe(true)
    await expect(grid.locator('.document-grid-toolbar-actions')).toHaveAttribute('disabled', '')
    // A newer search completes while the retried old response is still pending.
    await search.fill(`${prefix}002`)
    await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
    const row = grid.locator('.ag-row[row-id^="document:"]')
    await expect(row).toHaveCount(1)
    await expect(row.locator('.ag-cell[col-id="title"]')).toHaveText(`${prefix}002`)
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
    await expect(grid.locator('.document-grid-toolbar-actions')).not.toHaveAttribute('disabled', '')
    await row.getByRole('checkbox').check()
    release()
    await page.waitForLoadState('networkidle')
    await expect(row.locator('.ag-cell[col-id="title"]')).toHaveText(`${prefix}002`)
    await expect(row.getByRole('checkbox')).toBeChecked()
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await expect(grid.locator('.document-grid-error')).toBeHidden()
    expect(errors).toEqual([])
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

const scaleTest = process.env.AUDIT_DOCUMENT_GRID_SCALE === '1' ? test : test.skip
scaleTest('document grid real 200k: bounded SQL, browser blocks, DOM and memory diagnostics for 2000 documents', async ({ page }, info) => {
  test.setTimeout(180_000)
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'GRID-SCALE','SCALE-LINE-'||lpad((((n-1)/100)%50+1)::text,2,'0'),
        'SCALE-F'||n,((n-1)/100+1)::text,'2026-10-01','действующий','актуальная','да',
        'SCALE-REQ-'||lpad(((n-1)/100+1)::text,4,'0'),'2026-10-02'
      from generate_series(1,200000) n`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','SCALE-DOC-'||lpad(n::text,4,'0'),'scale.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100
      from generate_series(1,2000) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w on d.title='SCALE-DOC-'||lpad(w.isometry,4,'0')
      where d.type='weldingJournal' and w.project_title=$1 and w.subtitle_code='GRID-SCALE'`, [project])
  })
  // SQL fixture setup follows the existing indexed reader; no 200k-row hydration
  // is needed to prepare the system summary index.
  await requireDb().transaction(tx => rebuildSystemDocumentIndexInTransaction(tx, 'lnkRequest'))
  await withE2eDatabase(async db => {
    expect((await db.query('select count(*)::int n from weld_joints where project_title=$1 and subtitle_code=$2', [project, 'GRID-SCALE'])).rows[0].n).toBe(200_000)
    for (const table of ['weld_joints', 'generated_documents', 'generated_document_weld_joints']) await db.query(`analyze ${table}`)
  })
  const measurements: Array<{ kind: Kind; path: string; sql: number; milliseconds: number; bytes: number; returned: number; total: number }> = []
  for (const kind of ['generated', 'system'] as const) {
    const search = kind === 'generated' ? 'SCALE-DOC-' : 'SCALE-REQ-'
    const first = await read(kind, { search, endRow: 500, sortModel: [{ colId: 'title', sort: 'asc' }] })
    expect(first.total).toBe(2000)
    expect(first.rows).toHaveLength(500)
    const original = pg.Client.prototype.query
    let statements: string[] = []
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const statement = args[0] as string | { text?: string }
      statements.push(typeof statement === 'string' ? statement : statement.text ?? '')
      return (original as (...values: unknown[]) => unknown).apply(this, args)
    } as typeof original
    try {
      const scenarios: Array<{ path: string; request: Partial<DocumentHistoryGridRequest>; expected: number }> = [
        { path: 'groups', request: { rowGroupCols: ['line'], endRow: 20 }, expected: 20 },
        { path: 'one-group', request: { rowGroupCols: ['line'], groupKeys: ['["value","SCALE-LINE-01"]'] }, expected: 40 },
        { path: 'sorted-block', request: { startRow: 1000, endRow: 1100, sortModel: [{ colId: 'rowCount', sort: 'desc' }] }, expected: 100 },
        ...[10, 100, 500].map(count => ({ path: `selection-${count}`, request: { selectionOnly: true, selectedIds: first.rows.slice(0, count).map(row => row.id) }, expected: count })),
      ]
      for (const scenario of scenarios) {
        statements = []
        const start = performance.now(), result = await read(kind, { ...scenario.request, search })
        const bytes = Buffer.byteLength(JSON.stringify(result))
        // Selected-only reads use explicit IDs independently of the current
        // search. Their registry total includes the 250 ordinary fixture
        // documents; only the returned selection must remain exactly scoped.
        expect(result.total).toBe(scenario.request.selectionOnly ? 2250 : 2000)
        expect(result.rows).toHaveLength(scenario.expected)
        if (scenario.request.selectionOnly) {
          expect(new Set(result.rows.map(row => row.id))).toEqual(new Set(scenario.request.selectedIds))
          expect(result.rowCount).toBe(scenario.expected)
        }
        expect(statements).toHaveLength(kind === 'generated' ? 2 : 5)
        expect(statements.filter(statement => statement.includes('"block_rows" as materialized'))).toHaveLength(1)
        expect(bytes).toBeLessThan(1_000_000)
        if (scenario.path === 'groups') {
          expect(result.rowCount).toBe(50)
          expect(result.rows.every(row => isDocumentHistoryGroupRow(row) && row.childCount === 40)).toBe(true)
        }
        measurements.push({ kind, path: scenario.path, sql: statements.length, milliseconds: Math.round(performance.now() - start), bytes, returned: result.rows.length, total: result.total })
      }
    } finally { pg.Client.prototype.query = original }
  }
  console.info('Document grid 200k:', JSON.stringify(measurements))
  await info.attach('document-grid-200k', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })

  // This opt-in browser measurement uses the same 200k-joint fixture. Heap
  // values are diagnostics after GC, not a timing/heap threshold or a leak proof.
  const requests: Array<{ kind: Kind; data: DocumentHistoryGridRequest }> = []
  const browserMeasurements: Array<{
    kind: Kind; phase: string; renderedRows: number; cells: number; loaded: number; scrollTop: number
    rowLimit: number; gridRequests: number; heapUsedBytes: number; heapTotalBytes: number
    domNodes: number; documents: number; jsEventListeners: number
  }> = []
  const diagnostics: string[] = []
  const scrollMeasurements: Array<{ kind: Kind; frames: number; p50: number; p95: number; max: number; longTasks: number[] }> = []
  page.on('pageerror', error => diagnostics.push(error.message))
  page.on('request', request => {
    if (!request.url().includes('/_serverFn/')) return
    const name = rpcName(request.url())
    const generated = 'listRemoteGeneratedDocumentHistoryGrid', system = 'listSystemDocumentHistoryGrid'
    const kind = name === generated || name.startsWith(`${generated}_`) ? 'generated'
      : name === system || name.startsWith(`${system}_`) ? 'system' : null
    if (kind) requests.push({ kind, data: (deserializeRpcPayload(request.postData()!) as { data: DocumentHistoryGridRequest }).data })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const cdp = await page.context().newCDPSession(page)
  try {
    for (const kind of ['generated', 'system'] as const) {
      if (kind === 'system') await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
      const grid = page.locator(kind === 'generated'
        ? '[data-document-history-grid="generated:weldingJournal"]'
        : '[data-document-history-grid^="system:lnkRequest:"]')
      await grid.getByRole('textbox', { name: 'Поиск документов', exact: true }).fill(kind === 'generated' ? 'SCALE-DOC-' : 'SCALE-REQ-')
      await expect(grid.getByText('Найдено: 2000', { exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      const viewport = grid.locator('.ag-grid-viewport')
      const rowHeight = await grid.locator('.ag-row[row-id^="document:"]').first().evaluate(element => element.getBoundingClientRect().height)
      expect(rowHeight).toBeGreaterThan(0)
      const checkpoint = async (phase: string) => {
        await expect(grid.locator('.document-grid-footer').getByText('Загрузка…', { exact: true })).toBeHidden()
        await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
        await page.waitForLoadState('networkidle')
        // Network idle can precede AG's outgoing-row teardown. Require those
        // hidden rows to be removed, then measure the steady viewport/cache.
        await expect(grid.locator('.ag-row.ag-opacity-zero[row-id^="document:"]')).toHaveCount(0)
        await cdp.send('HeapProfiler.collectGarbage')
        const heap = await cdp.send('Runtime.getHeapUsage')
        const dom = await cdp.send('Memory.getDOMCounters')
        const rendered = await grid.evaluate((element, height) => {
          const viewport = element.querySelector<HTMLElement>('.ag-grid-viewport')!
          const loadedText = Array.from(element.querySelectorAll('.document-grid-footer span'))
            .map(span => span.textContent ?? '').find(text => text.startsWith('Загружено:')) ?? ''
          return {
            renderedRows: element.querySelectorAll('.ag-row[row-id^="document:"]').length,
            cells: element.querySelectorAll('.ag-row[row-id^="document:"] .ag-cell').length,
            loaded: Number(loadedText.replace('Загружено:', '').trim()), scrollTop: viewport.scrollTop,
            // Visible rows + two 6-row buffers + boundary rounding allowance.
            rowLimit: Math.ceil(viewport.clientHeight / height) + 16,
          }
        }, rowHeight)
        browserMeasurements.push({ kind, phase, ...rendered,
          gridRequests: requests.filter(request => request.kind === kind).length,
          heapUsedBytes: heap.usedSize, heapTotalBytes: heap.totalSize,
          domNodes: dom.nodes, documents: dom.documents, jsEventListeners: dom.jsEventListeners,
        })
        expect(rendered.renderedRows).toBeGreaterThan(0)
        expect(rendered.renderedRows).toBeLessThanOrEqual(rendered.rowLimit)
        expect(rendered.loaded).toBeGreaterThan(0)
        expect(rendered.loaded).toBeLessThanOrEqual(500)
      }
      await checkpoint('initial')
      expect(requests.filter(request => request.kind === kind).length).toBeGreaterThan(0)
      // Six nonadjacent blocks exceed the five-block cache, then revisit the
      // beginning. None of these jumps should enumerate the preceding prefix.
      for (const index of [650, 1250, 1850, 350, 1550, 0]) {
        const before = requests.length
        await viewport.evaluate((element, top) => { element.scrollTop = top }, index * rowHeight)
        await expect(grid.locator(`.ag-row[row-index="${index}"][row-id^="document:"]`)).toBeVisible()
        await checkpoint(`row-${index}`)
        const blockRequests = requests.slice(before).filter(request => request.kind === kind)
        expect(blockRequests.length).toBeGreaterThan(0)
        expect(blockRequests.length).toBeLessThanOrEqual(3)
        for (const { data } of blockRequests) {
          expect(data.selectionOnly).not.toBe(true)
          expect(data.endRow - data.startRow).toBe(100)
          expect(data.groupKeys).toEqual([])
        }
      }
      // Measure the same two-axis movement in both registries on this fixture.
      // These are diagnostics for the current host, not a production FPS promise.
      const scroll = await viewport.evaluate(async element => {
        const frames: number[] = [], longTasks: number[] = []
        const observer = new PerformanceObserver(list => {
          longTasks.push(...list.getEntries().map(entry => entry.duration))
        })
        observer.observe({ type: 'longtask' })
        const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))
        let previous = await frame()
        try {
          for (let i = 0; i < 120; i++) {
            element.scrollTop += i < 60 ? 24 : -24
            element.scrollLeft += i < 60 ? 12 : -12
            const now = await frame()
            frames.push(now - previous); previous = now
          }
          await frame()
          longTasks.push(...observer.takeRecords().map(entry => entry.duration))
        } finally { observer.disconnect() }
        frames.sort((a, b) => a - b)
        return { frames: frames.length, p50: frames[Math.floor(frames.length * .5)],
          p95: frames[Math.floor(frames.length * .95)], max: frames.at(-1)!, longTasks }
      })
      scrollMeasurements.push({ kind, ...scroll })
    }
    expect(diagnostics).toEqual([])
  } finally {
    await cdp.detach()
    const result = { fixture: { joints: 200_000, documentsPerRegistry: 2000 }, checkpoints: browserMeasurements, scrollMeasurements, requests, diagnostics }
    console.info('Document grid 200k browser:', JSON.stringify(result))
    await info.attach('document-grid-200k-browser-memory', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  }
})

test('document checkbox at a clipped lower row responds to the first pointer click', async ({ page }, info) => {
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }))
  const row = grid.locator('.ag-row[row-index="30"]')
  await expect(row).toBeVisible()
  const checkbox = row.getByRole('checkbox')
  const measurements: unknown[] = []
  try {
    // Larger offsets cover the checkbox itself with the scrollbar gutter;
    // here only the row edge is hidden, and the actual input remains clickable.
    for (const clipped of [4, 10]) {
      await row.evaluate((element, clipped) => {
        const viewport = element.closest('[data-document-history-grid]')!.querySelector('.ag-grid-viewport')!
        const bottom = viewport.getBoundingClientRect().top + viewport.clientHeight
        window.scrollBy({ top: element.getBoundingClientRect().bottom - bottom - clipped, behavior: 'instant' })
      }, clipped)
      await expect.poll(() => row.evaluate(element => {
        const viewport = element.closest('[data-document-history-grid]')!.querySelector('.ag-grid-viewport')!
        return Math.round(element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - viewport.clientHeight)
      })).toBe(clipped)
      const rect = (await checkbox.boundingBox())!
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      expect(await checkbox.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, point)).toBe(true)
      const before = await checkbox.isChecked()
      measurements.push({ clipped, point, before })
      await page.mouse.click(point.x, point.y)
      measurements.push({ clipped, after: await checkbox.boundingBox(), checked: await checkbox.isChecked() })
      await expect(checkbox).toBeChecked({ checked: !before })
      await expect(grid.getByText(`Выбрано: ${before ? 0 : 1}`, { exact: true })).toBeVisible()
    }
  } finally {
    await info.attach('clipped-checkbox-clicks', { body: JSON.stringify(measurements), contentType: 'application/json' })
  }
})

test('document actions column supports resizing, unpinning, hiding, saved views and reset without data requests', async ({ page }) => {
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const requests = observeDocumentRequests(page)
  const actions = grid.locator('.ag-header-cell[col-id="__actions"]')
  const width = () => actions.evaluate(e => e.getBoundingClientRect().width)
  const handle = await actions.locator('.ag-header-cell-resize').boundingBox()
  if (!handle) throw Error('Actions resize handle is missing')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 - 70, handle.y + handle.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(width).toBeGreaterThan(250)
  const savedWidth = await width()
  await openDocumentGridColumnMenu(page, '__actions')
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Не закреплять', exact: true }).click()
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-journal:documents:grid:v1:generated:weldingJournal')) ?? 'welding-journal:documents:grid:v1:generated:weldingJournal')!).columns.find((c: { colId: string }) => c.colId === '__actions'))
  await expect.poll(async () => (await state()).pinned).toBeNull()
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  await settings.getByRole('checkbox', { name: 'Действия', exact: true }).uncheck()
  await expect(actions).toHaveCount(0)
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Название вида документов' }).fill('Без кнопок')
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(requests.dataCalls()).toEqual([])
  await page.reload()
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect(actions).toHaveCount(0)
  expect(await state()).toMatchObject({ hide: true, pinned: null, width: savedWidth })
  await openDocumentGridColumnMenu(page, 'title')
  await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
  await expect(actions).toBeVisible()
  expect(await state()).toMatchObject({ hide: false, pinned: 'right', width: 205 })
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: /Без кнопок Фильтров/ }).click()
  await expect(actions).toHaveCount(0)
  expect(await state()).toMatchObject({ hide: true, pinned: null, width: savedWidth })
})

test('document grid browser: resized and hidden columns survive appearance, selection, reload and a saved view without appearance RPCs', async ({ page }, info) => {
  const calls: string[] = []
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const dataCalls = () => calls.filter(name => name.includes('DocumentHistoryGrid') || name.includes('DocumentHistoryFilterOptions')).length
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const titleHeader = grid.locator('.ag-header-cell[col-id="title"]')
  const titleWidth = () => titleHeader.evaluate(element => element.getBoundingClientRect().width)
  const originalWidth = await titleWidth()
  const handle = await titleHeader.locator('.ag-header-cell-resize').boundingBox()
  if (!handle) throw new Error('Document title resize handle is missing')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 84, handle.y + handle.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(titleWidth).toBeGreaterThan(originalWidth + 60)
  const savedWidth = await titleWidth()
  const firstRowId = await grid.locator('.ag-row[row-id^="document:"]').first().getAttribute('row-id')
  expect(firstRowId).not.toBeNull()
  const row = grid.locator(`.ag-row[row-id="${firstRowId}"]`)
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  const openSettings = async () => {
    await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await expect(settings).toBeVisible()
  }
  const closeSettings = async () => {
    await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
    await expect(settings).toBeHidden()
  }
  const selectDensity = async (name: 'Компактно' | 'Просторно') => {
    await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
    await settings.getByRole('combobox', { name: 'Плотность строк документов', exact: true }).click()
    await settings.getByRole('option', { name: new RegExp(`^${name}`) }).click()
  }
  const selectTheme = async (name: 'Классическая' | 'Нейтральная') => {
    await settings.getByRole('tab', { name: 'Темы', exact: true }).click()
    await settings.getByRole('radiogroup', { name: 'Тема таблицы документов', exact: true }).getByRole('radio', { name: new RegExp(`^${name}`) }).click()
  }
  const assertSavedColumns = async () => {
    await expect.poll(async () => Math.abs(await titleWidth() - savedWidth)).toBeLessThanOrEqual(1)
    await expect(grid.locator('.ag-header-cell[col-id="project"]')).toHaveCount(0)
  }
  await page.waitForLoadState('networkidle')
  const beforeAppearance = dataCalls()
  await openSettings()
  await expect(settings.getByRole('tab')).toHaveText(['Столбцы', 'Оформление', 'Темы', 'Мои виды'])
  await settings.getByRole('textbox', { name: 'Найти столбец', exact: true }).fill('Проект')
  await settings.getByRole('checkbox', { name: 'Проект', exact: true }).uncheck()
  await settings.getByRole('textbox', { name: 'Найти столбец', exact: true }).clear()
  await selectTheme('Классическая')
  await selectDensity('Компактно')
  await settings.getByRole('switch', { name: 'Перенос текста', exact: true }).uncheck()
  await settings.getByRole('switch', { name: 'Чередование строк', exact: true }).uncheck()
  await settings.getByRole('switch', { name: 'Вертикальная сетка', exact: true }).check()
  await closeSettings()
  await assertSavedColumns()
  await expect.poll(() => row.evaluate(element => element.getBoundingClientRect().height)).toBe(36)
  await row.getByRole('checkbox').check()
  await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  await assertSavedColumns()
  await page.waitForLoadState('networkidle')
  expect(dataCalls()).toBe(beforeAppearance)

  const viewName = 'Узкий реестр без проекта'
  await openSettings()
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Название вида документов', exact: true }).fill(viewName)
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(settings.getByRole('button', { name: new RegExp(`^${viewName} Фильтров:`) })).toBeVisible()
  await closeSettings()
  await assertSavedColumns()

  // Persist a different current view, then reload. Applying the saved view must
  // restore its own columns and appearance, rather than merely the latest state.
  await openSettings()
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await settings.getByRole('button', { name: 'Сбросить столбцы', exact: true }).click()
  await selectTheme('Нейтральная')
  await selectDensity('Просторно')
  await settings.getByRole('switch', { name: 'Перенос текста', exact: true }).check()
  await settings.getByRole('switch', { name: 'Чередование строк', exact: true }).check()
  await settings.getByRole('switch', { name: 'Вертикальная сетка', exact: true }).uncheck()
  await closeSettings()
  await expect.poll(async () => Math.abs(await titleWidth() - originalWidth)).toBeLessThanOrEqual(1)
  await page.reload()
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect(row.getByRole('checkbox')).toBeChecked()
  await openSettings()
  await expect(settings.getByRole('checkbox', { name: 'Проект', exact: true })).toBeChecked()
  await settings.getByRole('tab', { name: 'Темы', exact: true }).click()
  await expect(settings.getByRole('radio', { name: /^Нейтральная/ })).toBeChecked()
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await expect(settings.getByRole('combobox', { name: 'Плотность строк документов', exact: true })).toHaveText('Просторно')
  await settings.getByRole('tab', { name: 'Мои виды', exact: true }).click()
  await settings.getByRole('button', { name: new RegExp(`^${viewName} Фильтров:`) }).click()
  await expect(settings).toBeHidden()
  await assertSavedColumns()
  await expect.poll(() => row.evaluate(element => element.getBoundingClientRect().height)).toBe(36)
  await expect(row.getByRole('checkbox')).toBeChecked()
  await openSettings()
  await settings.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  await expect(settings.getByRole('checkbox', { name: 'Проект', exact: true })).not.toBeChecked()
  await settings.getByRole('tab', { name: 'Темы', exact: true }).click()
  await expect(settings.getByRole('radio', { name: /^Классическая/ })).toBeChecked()
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: info.outputPath('documents-theme-controls.png') })
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await expect(settings.getByRole('combobox', { name: 'Плотность строк документов', exact: true })).toHaveText('Компактно')
  await expect(settings.getByRole('switch', { name: 'Перенос текста', exact: true })).not.toBeChecked()
  await expect(settings.getByRole('switch', { name: 'Чередование строк', exact: true })).not.toBeChecked()
  await expect(settings.getByRole('switch', { name: 'Вертикальная сетка', exact: true })).toBeChecked()
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: info.outputPath('documents-appearance-controls.png') })
  // Escape closes the nested density choice before its containing settings panel.
  await settings.getByRole('combobox', { name: 'Плотность строк документов', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(settings.getByRole('listbox')).toHaveCount(0)
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(grid.getByRole('button', { name: 'Настроить вид', exact: true })).toBeFocused()
})

test('document grid parity: F2/Enter toggle row and full-header selection once; keyboard and column menus restore focus without layout RPCs', async ({ page }) => {
  const requests = observeDocumentRequests(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await expect(grid.locator('.ag-header-cell-menu-button')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(requests.blocks.length).toBeGreaterThan(0)
  const beforeLocalActions = requests.dataCalls().length
  const row = grid.locator('.ag-row[row-index="0"]')
  const selectionCell = row.locator('.ag-cell[col-id^="ag-Grid-SelectionColumn"]')
  const checkbox = selectionCell.getByRole('checkbox')
  // Test both the focused cell and its native input: keydown plus the browser's
  // default activation must never toggle the same checkbox twice.
  for (const target of [selectionCell, checkbox]) {
    await target.focus()
    await target.press('F2')
    await expect(checkbox).toBeChecked()
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
    await target.press('Enter')
    await expect(checkbox).not.toBeChecked()
    await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
  }
  const all = grid.getByRole('checkbox', { name: 'Выбрать все документы', exact: true })
  const selectionHeader = grid.locator('.ag-header-cell[col-id^="ag-Grid-SelectionColumn"]')
  expect(await checkboxPaint(all)).toEqual(await checkboxPaint(checkbox))
  for (const target of [selectionHeader, all]) {
    await target.focus()
    await target.press('F2')
    await expect(all).toBeChecked()
    await expect(grid.getByText('Выбрано: 250', { exact: true })).toBeVisible()
    expect(await checkboxPaint(all)).toEqual(await checkboxPaint(checkbox))
    // Presentation checks focus both inputs; restore the intended key target.
    await target.focus()
    await target.press('Enter')
    await expect(all).not.toBeChecked()
    await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
  }
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()

  const titleCell = row.locator('.ag-cell[col-id="title"]')
  await titleCell.focus()
  await titleCell.press('Shift+F10')
  await expect(page.getByRole('button', { name: 'Показать стыки в журнале', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(titleCell).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(grid.locator('.ag-cell-focus').locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('row-index', '1')

  const projectHeader = await openDocumentGridColumnMenu(page, 'project', true)
  await expect(page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(projectHeader).toBeFocused()
  await openDocumentGridColumnMenu(page, 'project')
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Слева', exact: true }).click()
  await expect(projectHeader.locator('.journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
  await openDocumentGridColumnMenu(page, 'project')
  await page.getByRole('menuitem', { name: 'Закрепить столбец', exact: true }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Не закреплять', exact: true }).click()
  await expect(projectHeader.locator('.journal-column-pin')).toHaveCount(0)
  await openDocumentGridColumnMenu(page, 'project')
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await expect(projectHeader).toHaveCount(0)
  await openDocumentGridColumnMenu(page, 'title')
  await page.getByRole('menuitem', { name: 'Выбрать столбцы', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  await expect(settings.getByRole('tab', { name: 'Столбцы', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(settings.getByRole('checkbox', { name: 'Проект', exact: true })).not.toBeChecked()
  await settings.getByRole('button', { name: 'Показать все', exact: true }).click()
  await expect(settings.getByRole('checkbox', { name: 'Проект', exact: true })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(grid.getByRole('button', { name: 'Настроить вид', exact: true })).toBeFocused()
  await openDocumentGridColumnMenu(page, 'project')
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await openDocumentGridColumnMenu(page, 'title')
  await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
  await expect(projectHeader).toBeVisible()
  await expect(grid.locator('.ag-header-cell[col-id="title"] .journal-column-pin')).toHaveAttribute('title', /Закреплён слева/)
  await page.waitForLoadState('networkidle')
  expect(requests.dataCalls()).toHaveLength(beforeLocalActions + 1)
  expect(requests.blocks.every(request => !request.selectionOnly && request.endRow - request.startRow <= 100)).toBe(true)
})

test('document grid parity: group chips reorder by keyboard and drag, group menus preserve selection and clear restores the registry', async ({ page }, info) => {
  const requests = observeDocumentRequests(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await grid.locator('.ag-row[row-index="0"]').getByRole('checkbox').check()
  const selectedId = await grid.locator('.ag-row[row-index="0"]').getAttribute('row-id')
  expect(selectedId).not.toBeNull()
  const chips = grid.getByLabel('Группировка документов', { exact: true })
  const levels = chips.getByRole('button', { name: /^Группировка:/ })
  const settled = async (order: string[]) => {
    await expect.poll(() => requests.blocks.filter(request => !request.selectionOnly).at(-1)?.rowGroupCols).toEqual(order)
    await expect(grid.locator('.document-grid-footer').getByText('Загрузка…', { exact: true })).toBeHidden()
    await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
    await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  }
  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
  await settled(['line'])
  await openDocumentGridColumnMenu(page, 'project')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Проект»/ }).click()
  await settled(['line', 'project'])
  await expect(levels).toHaveText(['Линия', 'Проект'])
  const projectChip = chips.getByRole('button', { name: 'Группировка: Проект', exact: true })
  await projectChip.press('Alt+ArrowLeft')
  await expect(levels).toHaveText(['Проект', 'Линия'])
  await expect(projectChip).toBeFocused()
  await settled(['project', 'line'])
  const lineChip = chips.getByRole('button', { name: 'Группировка: Линия', exact: true })
  const from = (await projectChip.boundingBox())!, to = (await lineChip.boundingBox())!
  const beforeDrag = requests.blocks.filter(request => !request.countRoutes).length
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await expect(page.locator('.journal-grouping-drag-preview')).toContainText('Проект')
  await expect(levels).toHaveText(['Проект', 'Линия'])
  expect(requests.blocks.filter(request => !request.countRoutes)).toHaveLength(beforeDrag)
  await page.mouse.up()
  await expect(page.locator('.journal-grouping-drag-preview')).toHaveCount(0)
  await expect(levels).toHaveText(['Линия', 'Проект'])
  await expect(projectChip).toBeFocused()
  await settled(['line', 'project'])
  await projectChip.press('Alt+ArrowLeft')
  await settled(['project', 'line'])
  await expect(levels).toHaveText(['Проект', 'Линия'])
  await projectChip.press('Alt+ArrowRight')
  await settled(['line', 'project'])
  await expect(levels).toHaveText(['Линия', 'Проект'])

  const group = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: 'LINE-A' })
  await expect(group).toContainText('124')
  await expect(group.getByRole('checkbox', { name: 'Выбрать все документы группы LINE-A', exact: true })).toBeEnabled()
  await group.click({ button: 'right' })
  await expect(page.getByText('Группа: LINE-A', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Развернуть', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Показать стыки в журнале', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect.poll(() => group.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Shift+F10')
  await page.getByRole('button', { name: 'Развернуть', exact: true }).click()
  await expect(group.locator('.ag-group-expanded')).toBeVisible()
  const child = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: project })
  await expect(child).toBeVisible()
  await child.click({ button: 'right' })
  await page.getByRole('button', { name: 'Свернуть все', exact: true }).click()
  await expect(child).toHaveCount(0)
  await expect(group.locator('.ag-group-contracted')).toBeVisible()
  await expect(grid.getByText('Выбрано: 1', { exact: true })).toBeVisible()
  await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: info.outputPath('documents-grouping-parity.png') })
  await chips.getByRole('button', { name: 'Убрать группировку: Проект', exact: true }).click()
  await settled(['line'])
  await expect(levels).toHaveText(['Линия'])
  await chips.getByRole('button', { name: 'Снять все группировки', exact: true }).click()
  await settled([])
  await expect(levels).toHaveCount(0)
  await expect(grid.locator(`.ag-row[row-id="${selectedId}"]`).getByRole('checkbox')).toBeChecked()
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const blocks = requests.blocks.filter(request => !request.selectionOnly && !request.countRoutes)
  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks.length).toBeLessThanOrEqual(12)
  expect(blocks.every(request => request.startRow === 0 && request.endRow <= 100)).toBe(true)
  expect(blocks.filter(request => request.groupKeys.length > 0)).toHaveLength(1)
  expect(requests.calls.filter(name => name.includes('DocumentHistoryFilterOptions'))).toHaveLength(0)
  await info.attach('document-grid-group-controls-requests', { body: JSON.stringify(requests.blocks, null, 2), contentType: 'application/json' })
})

test('document grid parity: date filter exposes year/month/day with immediate exact choices, search and Escape focus', async ({ page }, info) => {
  await withLineProgramFixture(db => db.query(`update weld_joints set vik_request_date=case when isometry='249' then date '2026-09-30' else date '2025-10-03' end
    where project_title=$1 and isometry in ('249','250')`, [project]))
  await requireDb().transaction(tx => rebuildSystemDocumentIndexInTransaction(tx, 'lnkRequest'))
  const requests = observeDocumentRequests(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const grid = page.locator('[data-document-history-grid^="system:lnkRequest:"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const reloads: Array<{ action: string; blocks: number }> = []
  const oneReload = async (action: string, total: number, change: () => Promise<unknown>) => {
    await page.waitForLoadState('networkidle')
    const before = requests.blocks.filter(request => !request.selectionOnly).length
    await change()
    await expect(grid.getByText(`Найдено: ${total}`, { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const blocks = requests.blocks.filter(request => !request.selectionOnly).length - before
    expect(blocks, `${action}: exactly one server block reload`).toBe(1)
    reloads.push({ action, blocks })
  }
  const filter = await openDocumentGridFilter(page, 'date', 'Дата')
  const year = filter.getByRole('checkbox', { name: 'Год 2026', exact: true })
  await expect(year).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true })).toHaveCount(0)
  const facetCount = () => requests.calls.filter(name => name.includes('SystemDocumentHistoryFilterOptions')).length
  expect(facetCount()).toBeGreaterThan(0)
  const beforeExpand = requests.dataCalls().length, facets = facetCount()
  await filter.getByRole('button', { name: 'Развернуть Год 2026', exact: true }).click()
  await filter.getByRole('button', { name: 'Развернуть Октябрь 2026', exact: true }).click()
  await expect(filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true })).toBeVisible()
  expect(requests.dataCalls()).toHaveLength(beforeExpand)
  await oneReload('select day', 248, () => filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true }).check())
  await expect(filter).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: 'Октябрь 2026', exact: true })).toBeChecked()
  await expect(year).toBeChecked({ indeterminate: true })
  await oneReload('select year', 249, () => year.check())
  await expect(year).toBeChecked()
  expect(facetCount()).toBe(facets)
  await oneReload('reset date in popup', 250, () => filter.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click())
  await filter.getByRole('textbox', { name: 'Найти значение фильтра', exact: true }).fill('30.09.2026')
  const september = filter.getByRole('checkbox', { name: 'День 30.09.2026', exact: true })
  await expect(september).toBeVisible()
  await expect(filter.getByRole('checkbox', { name: 'День 02.10.2026', exact: true })).toHaveCount(0)
  await oneReload('select found date', 1, () => filter.getByRole('button', { name: 'Выбрать найденные', exact: true }).click())
  await expect(grid.getByRole('button', { name: 'GRID-REQ-249', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(filter).toBeHidden()
  await expect(grid.locator('.ag-header-cell[col-id="date"]')).toBeFocused()
  await expect(grid.locator('.ag-header-cell[col-id="date"] .ag-header-cell-filter-button')).toHaveClass(/ag-filter-active/)
  await expect(grid.locator('.document-grid-filter-chips')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('documents-active-date-filter.png') })

  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  const openSettings = async () => {
    await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    await settings.getByRole('tab', { name: 'Столбцы', exact: true }).click()
  }
  await openDocumentGridColumnMenu(page, 'date')
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await openSettings()
  await expect(settings.getByRole('checkbox', { name: 'Дата', exact: true })).not.toBeChecked()
  await expect(settings.getByLabel('Активный фильтр: Дата', { exact: true })).toHaveAttribute('title', 'Фильтр действует и для скрытого столбца')
  await settings.getByRole('checkbox', { name: 'Дата', exact: true }).check()
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  const dateHeader = await revealGridColumn(page, 'date')
  await expect(dateHeader.locator('.ag-header-cell-filter-button')).toHaveClass(/ag-filter-active/)
  await expect(grid.getByRole('button', { name: 'GRID-REQ-249', exact: true })).toBeVisible()
  await openDocumentGridColumnMenu(page, 'date')
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await page.getByRole('button', { name: 'ЖСР', exact: true }).click()
  await expect(page.locator('[data-document-history-grid="generated:weldingJournal"]')).toBeVisible()
  await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect(grid.getByRole('button', { name: 'GRID-REQ-249', exact: true })).toBeVisible()
  await expect(grid.locator('.ag-header-cell[col-id="date"]')).toHaveCount(0)
  await openSettings()
  await expect(settings.getByLabel('Активный фильтр: Дата', { exact: true })).toBeVisible()
  await expect(settings.getByRole('checkbox', { name: 'Дата', exact: true })).not.toBeChecked()
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  const reset = grid.getByRole('button', { name: 'Сбросить', exact: true })
  await expect(reset).toHaveAttribute('title', 'Сбросить все фильтры, включая поиск')
  await oneReload('reset hidden date from toolbar', 250, () => reset.click())
  await openSettings()
  await expect(settings.getByLabel('Активный фильтр: Дата', { exact: true })).toHaveCount(0)
  await settings.getByRole('checkbox', { name: 'Дата', exact: true }).check()
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  await revealGridColumn(page, 'date')
  await expect(dateHeader.locator('.ag-header-cell-filter-button')).not.toHaveClass(/ag-filter-active/)
  const search = grid.getByRole('textbox', { name: 'Поиск документов', exact: true })
  await oneReload('search registry', 1, () => search.fill('GRID-REQ-249'))
  await expect(grid.locator('.document-grid-filter-chips')).toHaveCount(0)
  await expect(grid.getByRole('button', { name: 'Сбросить поиск документов', exact: true })).toHaveCount(0)
  await oneReload('reset search from toolbar', 250, () => reset.click())
  await expect(search).toHaveValue('')
  expect(requests.blocks.filter(request => !request.selectionOnly).every(request => request.endRow - request.startRow <= 100)).toBe(true)
  await info.attach('document-date-filter-reloads', { body: JSON.stringify(reloads, null, 2), contentType: 'application/json' })
})

test('document grid parity: clipboard copies complete ranges from leaf, header and group focus in bounded requests', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const requests = observeDocumentRequests(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await revealGridColumn(page, 'project')
  const cell = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="project"]')
  const expected = `${project}\tGRID\n${project}\tGRID`
  const copy = async (text: string) => {
    // A sentinel makes a missing shortcut handler fail even after a previous
    // successful copy of the same range.
    await page.evaluate(() => navigator.clipboard.writeText('not copied'))
    await page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  }
  await page.waitForLoadState('networkidle')
  const beforeCopy = requests.dataCalls().length
  await cell.click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await copy(expected)
  await expect(grid.getByText('Количество: 4', { exact: true })).toBeVisible()
  const projectHeader = grid.locator('.ag-header-cell[col-id="project"]')
  await projectHeader.focus()
  await copy(expected)
  await cell.click({ button: 'right' })
  await page.evaluate(() => navigator.clipboard.writeText('not copied'))
  await page.getByRole('button', { name: 'Копировать ячейки', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
  await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()

  // Ctrl+A describes all 250 logical rows. Copying from a header includes
  // all 250 documents, with bounded cell requests and no extra cached cards.
  await cell.click()
  await page.keyboard.press('ControlOrMeta+a')
  await projectHeader.focus()
  await page.evaluate(() => navigator.clipboard.writeText('not copied'))
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).split('\n').length).toBe(250)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  const titles = [...copied.matchAll(/GRID-DOC-\d{3}/g)].map(match => match[0])
  expect(titles).toHaveLength(250)
  expect(new Set(titles).size).toBe(250)
  expect(copied).not.toContain('Скачать Excel')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(requests.blocks.slice(beforeCopy - 1).filter(request => request.cells && !request.cells.summary)).not.toHaveLength(0)
  expect(requests.blocks.every(request => request.cells?.summary || request.endRow - request.startRow <= 500)).toBe(true)

  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
  const group = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: 'LINE-A' })
  await expect(group).toContainText('124')
  await group.locator('.ag-group-contracted').click()
  const leaf = grid.locator('.ag-row[row-id^="document:"] .ag-cell[col-id="project"]').first()
  await expect(leaf).toBeVisible()
  await leaf.click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await page.waitForLoadState('networkidle')
  const beforeGroupCopy = requests.dataCalls().length
  await expect(grid.getByText('Количество: 4', { exact: true })).toBeVisible()
  await group.focus()
  await copy(expected)
  await expect(grid.getByText('Выбрано: 0', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(requests.dataCalls()).toHaveLength(beforeGroupCopy + 1)
})

test('document grid appearance: vertical separators preserve focus and range borders; unused row width carries stripes, selection and hover', async ({ page }, info) => {
  const requests = observeDocumentRequests(page)
  await page.setViewportSize({ width: 2400, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const beforeAppearance = requests.dataCalls().length
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  // Keep a real wide-viewport gap between the remaining data and pinned actions.
  // Change columns through the operator's controls, rather than injecting CSS.
  for (const checkbox of await settings.getByRole('checkbox').all()) {
    if (await checkbox.isEnabled() && !['Проект', 'Действия'].includes(await checkbox.getAttribute('aria-label') ?? '')) await checkbox.uncheck()
  }
  await settings.getByRole('checkbox', { name: 'Проект', exact: true }).check()
  await settings.getByRole('tab', { name: 'Оформление', exact: true }).click()
  await settings.getByRole('switch', { name: 'Вертикальная сетка', exact: true }).check()
  await settings.getByRole('switch', { name: 'Чередование строк', exact: true }).check()
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  const even = grid.locator('.ag-row[row-index="0"]'), odd = grid.locator('.ag-row[row-index="1"]')
  const selectionCell = even.locator('.ag-cell[col-id^="ag-Grid-SelectionColumn"]')
  const pinnedTitle = even.locator('.ag-cell[col-id="title"]')
  const borders = (cell: typeof selectionCell) => cell.evaluate(element => {
    const style = getComputedStyle(element)
    const probe = document.createElement('span')
    probe.style.color = 'var(--ag-range-selection-border-color)'
    element.append(probe)
    const focusColor = getComputedStyle(probe).color
    probe.remove()
    return {
      focusColor,
      colors: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
      widths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      styles: [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle],
    }
  })
  for (const cell of [selectionCell, pinnedTitle]) {
    await cell.click({ position: { x: 4, y: 4 } })
    if (cell === selectionCell) await even.getByRole('checkbox').focus()
    await expect(cell).toHaveClass(/ag-cell-focus/)
    await expect.poll(async () => {
      const value = await borders(cell)
      return value.colors.every(color => color === value.focusColor) && value.widths.every(width => width === '1px') && value.styles.every(style => style === 'solid')
    }).toBe(true)
  }
  const firstProject = even.locator('.ag-cell[col-id="project"]'), secondProject = odd.locator('.ag-cell[col-id="project"]')
  await firstProject.click()
  await firstProject.press('Shift+ArrowDown')
  await expect(firstProject).toHaveClass(/ag-cell-range-top/)
  await expect(secondProject).toHaveClass(/ag-cell-range-bottom/)
  const top = await borders(firstProject), bottom = await borders(secondProject)
  expect([top.colors[0], top.colors[1], top.colors[3], bottom.colors[1], bottom.colors[2], bottom.colors[3]]).toEqual(Array(6).fill(top.focusColor))

  const rowPaint = (row: typeof odd) => row.evaluate(element => {
    const rowStyle = getComputedStyle(element), gap = getComputedStyle(element, '::after')
    const cells = element.querySelector<HTMLElement>('.ag-grid-scrolling-cells')!
    const cellStyle = getComputedStyle(cells), overlay = getComputedStyle(cells, '::before')
    return {
      width: Number.parseFloat(gap.width), background: gap.backgroundColor, rowBackground: rowStyle.backgroundColor,
      image: gap.backgroundImage, overlayColor: overlay.backgroundColor, overlayImage: overlay.backgroundImage,
      border: [gap.borderBottomWidth, gap.borderBottomStyle, gap.borderBottomColor],
      cellBorder: [cellStyle.borderBottomWidth, cellStyle.borderBottomStyle, cellStyle.borderBottomColor],
    }
  })
  await page.mouse.move(5, 5)
  await expect(odd).not.toHaveClass(/ag-row-hover|ag-row-selected/)
  const stripe = await rowPaint(odd), plain = await rowPaint(even)
  expect(stripe.width).toBeGreaterThan(100)
  expect(stripe.border).toEqual(stripe.cellBorder)
  expect(stripe.border.slice(0, 2)).toEqual(['1px', 'solid'])
  expect(stripe.background).toBe(stripe.rowBackground)
  expect(stripe.background).not.toBe(plain.background)
  await odd.getByRole('checkbox').check()
  await page.mouse.move(5, 5)
  await expect(odd).toHaveClass(/ag-row-selected/)
  await expect(odd).not.toHaveClass(/ag-row-hover/)
  const selected = await rowPaint(odd)
  expect(selected.overlayColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(selected.image).toContain(selected.overlayColor)
  expect(selected.border).toEqual(selected.cellBorder)
  const gapPoint = await odd.evaluate(element => {
    const center = element.querySelector('.ag-grid-scrolling-cells')!.getBoundingClientRect()
    const right = element.querySelector('.ag-grid-pinned-right-cells')!.getBoundingClientRect()
    const row = element.getBoundingClientRect()
    return { x: (center.right + right.left) / 2, y: row.top + row.height / 2 }
  })
  await page.mouse.move(gapPoint.x, gapPoint.y)
  await expect(odd).toHaveClass(/ag-row-hover/)
  const hovered = await rowPaint(odd)
  expect(hovered.image).toContain(hovered.overlayColor)
  expect(hovered.overlayImage).not.toBe('none')
  expect(hovered.image).toContain(hovered.overlayImage)
  expect(hovered.border).toEqual(hovered.cellBorder)
  await page.waitForLoadState('networkidle')
  expect(requests.dataCalls()).toHaveLength(beforeAppearance)
  await info.attach('document-row-paint', { body: JSON.stringify({ stripe, plain, selected, hovered }, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('documents-row-gap-focus-and-selection.png') })
})

test('document grid groups: checkboxes select all descendants, preserve outside IDs and keyboard intent without loading future cards', async ({ page }, info) => {
  const documents = await read('generated', { endRow: 300, sortModel: [{ colId: 'title', sort: 'asc' }] })
  const outside = documents.rows.find(row => row.title === 'GRID-DOC-002')!
  const lineA = await read('generated', { rowGroupCols: ['line', 'project'], groupKeys: ['["value","LINE-A"]', JSON.stringify(['value', project])], sortModel: [{ colId: 'title', sort: 'asc' }] })
  expect(lineA.rows).toHaveLength(100)
  expect(lineA.rowCount).toBe(124)
  const allLineA = await read('generated', { rowGroupCols: ['line', 'project'], groupKeys: ['["value","LINE-A"]', JSON.stringify(['value', project])], endRow: 300 })
  const expected = [...allLineA.rows.map(row => String(row.id)), String(outside.id)].sort()
  const requests = observeDocumentRequests(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    const observations: Array<{ from: string | number | null; to: string | number | null }> = []
    Object.assign(window, { documentGridReveals: observations })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (this.matches('[data-document-history-grid] .ag-grid-scrolling-container')) {
        const animation = animate.apply(this, args)
        const frames = (animation.effect as KeyframeEffect).getKeyframes()
        observations.push({ from: frames[0]?.opacity ?? null, to: frames.at(-1)?.opacity ?? null })
        return animation
      }
      return animate.apply(this, args)
    }
  })
  const reveals = () => page.evaluate(() => (window as unknown as { documentGridReveals: Array<{ from: string | number | null; to: string | number | null }> }).documentGridReveals)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  expect(await reveals()).toEqual([])
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  const outsideRow = grid.locator(`.ag-row[row-id="document:${outside.id}"]`)
  await expect(outsideRow.getByRole('button', { name: String(outside.title), exact: true })).toBeVisible()
  await expect.poll(async () => (await reveals()).length).toBe(1)
  const reveal = (await reveals())[0]
  expect(Number(reveal.from)).toBeLessThan(1)
  expect(Number(reveal.to)).toBe(1)
  await outsideRow.getByRole('checkbox').check()
  const selectedIds = () => page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith('welding-user:') && key.endsWith(':welding-journal:documents:session:v1:generated:weldingJournal')) ?? 'welding-journal:documents:session:v1:generated:weldingJournal') ?? '{}') as { selectedDocumentIds?: Array<string | number> }
    return (state.selectedDocumentIds ?? []).map(String).sort()
  })
  const settled = async () => {
    await expect(grid.locator('.document-grid-footer').getByText('Загрузка…', { exact: true })).toBeHidden()
    await expect(grid.locator('.ag-row-loading')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
  }
  for (const [key, label] of [['line', 'Линия'], ['project', 'Проект']]) {
    await openDocumentGridColumnMenu(page, key)
    await page.getByRole('menuitem', { name: `Сгруппировать по «${label}»`, exact: true }).click()
    await expect.poll(() => requests.blocks.filter(request => !request.selectionOnly && !request.idsOnly && !request.countRoutes && !request.cells).at(-1)?.rowGroupCols).toContain(key)
    await settled()
  }
  await expect.poll(async () => (await reveals()).length).toBe(3)
  const parent = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: 'LINE-A' })
  const child = grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: project })
  const parentCheckbox = parent.getByRole('checkbox', { name: 'Выбрать все документы группы LINE-A', exact: true })
  const childCheckbox = child.getByRole('checkbox', { name: `Выбрать все документы группы ${project}`, exact: true })
  const allCheckbox = grid.getByRole('checkbox', { name: 'Выбрать все документы', exact: true })
  const wrapper = (checkbox: Locator) => checkbox.locator('xpath=ancestor::*[contains(@class,"ag-checkbox-input-wrapper")][1]')
  await expect(parentCheckbox).toBeEnabled()
  await expect(wrapper(parentCheckbox)).not.toHaveClass(/ag-disabled/)
  await expect(allCheckbox).toBeEnabled()
  await expect(wrapper(allCheckbox)).not.toHaveClass(/ag-disabled/)
  await parent.locator('.ag-group-contracted').click()
  await expect(childCheckbox).toBeEnabled()
  await expect(parentCheckbox).toBeEnabled()
  await child.locator('.ag-group-contracted').click()
  const firstLeaf = grid.locator(`.ag-row[row-id="document:${lineA.rows[0].id}"]`)
  await expect(firstLeaf).toBeVisible()
  await expect(parentCheckbox).toBeEnabled()
  await expect(childCheckbox).toBeEnabled()
  await expect(parent.locator('.ag-group-value')).toHaveCSS('overflow', 'visible')
  await expect(child.locator('.ag-group-value')).toHaveCSS('overflow', 'visible')
  await expect(parentCheckbox).toHaveAttribute('title', 'Все документы группы: 124, включая незагруженные')
  await settled()
  await firstLeaf.locator('.ag-cell[col-id="title"]').hover()
  await expect(page.getByRole('tooltip')).toHaveText(String(lineA.rows[0].title))
  await parent.locator('.ag-group-value').hover()
  await expect(page.locator('.ag-tooltip')).toHaveCount(0)
  // AG's default tooltip delay is two seconds. A negative assertion before
  // that delay would miss a newly scheduled tooltip with the encoded group key.
  await page.waitForTimeout(2300)
  await expect(page.locator('.ag-tooltip')).toHaveCount(0)
  await expect(grid.locator('.ag-full-width-row.ag-row-group').filter({ hasText: '(пусто)' })).toBeVisible()
  const groupTitles = await grid.locator('.ag-full-width-row.ag-row-group [title]').evaluateAll(elements => elements.map(element => element.getAttribute('title')))
  expect(groupTitles.join('\n')).not.toMatch(/\["(?:value|empty|multiple)"/)
  const beforeSelection = requests.dataCalls().length
  await parentCheckbox.click()
  await expect(parentCheckbox).toBeChecked()
  await expect(childCheckbox).toBeChecked()
  await expect.poll(selectedIds).toEqual(expected)
  const assertCheckedAppearance = async () => {
    const native = await checkboxPaint(firstLeaf.getByRole('checkbox'))
    expect(native.inputOpacity).toBe('0')
    for (const checkbox of [parentCheckbox, childCheckbox]) {
      await expect(wrapper(checkbox)).toHaveClass(/ag-checked/)
      expect(await checkboxPaint(checkbox)).toEqual(native)
    }
  }
  await assertCheckedAppearance()
  // The custom header/group inputs must inherit each selected AG theme just
  // like its own leaf checkbox, including focused, checked and mixed states.
  for (const theme of ['Классическая', 'Нейтральная']) {
    await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
    await settings.getByRole('tab', { name: 'Темы', exact: true }).click()
    await settings.getByRole('radio', { name: new RegExp(`^${theme}`) }).click()
    await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
    await assertCheckedAppearance()
  }
  await firstLeaf.getByRole('checkbox').uncheck()
  await expect(parentCheckbox).toHaveJSProperty('indeterminate', true)
  await expect(childCheckbox).toHaveJSProperty('indeterminate', true)
  await expect(wrapper(parentCheckbox)).toHaveClass(/ag-indeterminate/)
  await expect(wrapper(childCheckbox)).toHaveClass(/ag-indeterminate/)
  await expect(wrapper(allCheckbox)).toHaveClass(/ag-indeterminate/)
  expect(await checkboxPaint(parentCheckbox)).toEqual(await checkboxPaint(allCheckbox))
  expect(await checkboxPaint(childCheckbox)).toEqual(await checkboxPaint(allCheckbox))
  await expect.poll(selectedIds).toEqual(expected.filter(id => id !== String(lineA.rows[0].id)))
  // Keyboard activation changes only the checkbox, once. Neither key may
  // bubble to AG's full-width group expansion handler.
  for (const checkbox of [childCheckbox, parentCheckbox]) {
    await checkbox.focus()
    await checkbox.press('F2')
    await expect.poll(selectedIds).toEqual(expected)
    await expect(parent.locator('.ag-group-expanded')).toBeVisible()
    await expect(child.locator('.ag-group-expanded')).toBeVisible()
    await checkbox.press('Enter')
    await expect.poll(selectedIds).toEqual([String(outside.id)])
    await expect(parent.locator('.ag-group-expanded')).toBeVisible()
    await expect(child.locator('.ag-group-expanded')).toBeVisible()
  }
  await parentCheckbox.click()
  await expect.poll(selectedIds).toEqual(expected)
  await settled()
  expect(requests.blocks.filter(request => request.idsOnly).length).toBeGreaterThan(0)
  expect(requests.blocks.filter(request => !request.cells && !request.idsOnly && !request.countRoutes && !request.selectionOnly).every(request => request.endRow - request.startRow <= 100)).toBe(true)
  await parent.locator('.ag-group-expanded').click()
  await expect(child).toHaveCount(0)
  await expect(parentCheckbox).toBeEnabled()
  await expect.poll(selectedIds).toEqual(expected)
  await parent.locator('.ag-group-contracted').click()
  await expect(child).toBeVisible()
  if (await child.locator('.ag-group-contracted').isVisible()) await child.locator('.ag-group-contracted').click()
  await expect(firstLeaf.getByRole('checkbox')).toBeChecked()
  await expect(parentCheckbox).toBeChecked()
  await expect(childCheckbox).toBeChecked()
  await expect.poll(selectedIds).toEqual(expected)
  await settled()
  const beforeFurtherLoad = requests.blocks.length
  const viewport = grid.locator('.ag-grid-viewport'), bounds = await viewport.boundingBox()
  if (!bounds) throw new Error('Document viewport is missing')
  await page.mouse.move(bounds.x + bounds.width / 2, Math.min(850, bounds.y + 180))
  await page.mouse.wheel(0, 20_000)
  const lastLeaf = grid.locator('.ag-row[row-id^="document:"]').filter({ has: page.getByRole('button', { name: 'GRID-DOC-247', exact: true }) })
  await expect(lastLeaf).toBeInViewport()
  await expect(lastLeaf.getByRole('checkbox')).toBeChecked()
  await expect(parentCheckbox).toBeChecked()
  await expect(childCheckbox).toBeChecked()
  await expect(parentCheckbox).toHaveAttribute('title', 'Все документы группы: 124, включая незагруженные')
  await expect.poll(selectedIds).toEqual(expected)
  await settled()
  const furtherLoads = requests.blocks.slice(beforeFurtherLoad).filter(request => !request.selectionOnly && !request.idsOnly && !request.countRoutes && !request.cells)
  expect(furtherLoads).toHaveLength(1)
  expect(furtherLoads[0]).toMatchObject({ startRow: 100, endRow: 200, rowGroupCols: ['line', 'project'], groupKeys: ['["value","LINE-A"]', JSON.stringify(['value', project])] })
  expect(await reveals()).toHaveLength(3)
  await info.attach('document-group-loaded-selection', { body: JSON.stringify({ selectedIds: await selectedIds(), furtherLoads }, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('documents-group-loaded-checkboxes.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  await expect.poll(() => requests.blocks.filter(request => !request.selectionOnly && !request.idsOnly && !request.countRoutes && !request.cells).at(-1)?.sortModel).toContainEqual({ colId: 'title', sort: 'desc' })
  await settled()
  expect(await reveals()).toHaveLength(3)
  await expect.poll(selectedIds).toEqual(expected)
})

test('document result motion follows current sort/filter/search only and keeps pending facet choices stable and disabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    Object.assign(window, { documentResultReveals: 0 })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (this.matches('[data-document-history-grid] .ag-grid-scrolling-container')) {
        const state = window as unknown as { documentResultReveals: number }; state.documentResultReveals++
      }
      return animate.apply(this, args)
    }
  })
  let releaseSort!: () => void, releaseFacet!: () => void
  const sortGate = new Promise<void>(resolve => { releaseSort = resolve })
  const facetGate = new Promise<void>(resolve => { releaseFacet = resolve })
  let sortHeld = false, facetHeld = false, sortReleased = false
  await page.route('**/_serverFn/**', async route => {
    const name = rpcName(route.request().url())
    if (!name.includes('DocumentHistoryGrid') && !name.includes('DocumentHistoryFilterOptions')) return route.continue()
    const serialized = route.request().postData() ?? new URL(route.request().url()).searchParams.get('payload')
    if (!serialized) throw new Error(`Missing RPC payload for ${name}`)
    const payload = deserializeRpcPayload(serialized) as { data: DocumentHistoryGridRequest & { search?: string } }
    if (!sortHeld && name.includes('DocumentHistoryGrid') && payload.data.sortModel?.some(item => item.colId === 'title' && item.sort === 'asc')) {
      const response = await route.fetch(); sortHeld = true
      await sortGate; await route.fulfill({ response }); sortReleased = true
    } else if (!facetHeld && name.includes('DocumentHistoryFilterOptions') && payload.data.search === '249') {
      const response = await route.fetch(); facetHeld = true
      await facetGate; await route.fulfill({ response })
    } else await route.continue()
  })
  const reveals = () => page.evaluate(() => (window as unknown as { documentResultReveals: number }).documentResultReveals)
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  expect(await reveals()).toBe(0)
  const instance = await grid.locator('.ag-root').elementHandle()
  const sort = grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label')
  await sort.click(); await expect.poll(() => sortHeld).toBe(true)
  await sort.click()
  await expect.poll(reveals).toBe(1)
  await expect(grid.getByRole('button', { name: 'GRID-DOC-250', exact: true })).toBeVisible()
  await expect(grid.getByText('Загрузка…', { exact: true })).toBeHidden()
  releaseSort(); await expect.poll(() => sortReleased).toBe(true)
  await page.waitForLoadState('networkidle')
  expect(await reveals()).toBe(1)
  await expect(grid.getByRole('alert')).toHaveCount(0)

  const search = grid.getByRole('textbox', { name: 'Поиск документов', exact: true })
  await search.fill('GRID-DOC-249')
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect.poll(reveals).toBe(2)
  await search.fill('')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await expect.poll(reveals).toBe(3)
  const filter = await openDocumentGridFilter(page, 'title', 'Документ')
  await expect(filter.getByRole('checkbox').first()).toBeEnabled()
  const area = filter.locator('.journal-filter-values'), beforeHeight = (await area.boundingBox())!.height
  await filter.getByRole('textbox', { name: 'Найти значение фильтра' }).fill('249')
  await expect.poll(() => facetHeld).toBe(true)
  await expect(filter.getByRole('status')).toHaveText('Обновляем значения…')
  await expect(filter.getByRole('checkbox').first()).toBeDisabled()
  await expect(filter.getByRole('button', { name: 'Выбрать найденные' })).toBeDisabled()
  expect(Math.abs((await area.boundingBox())!.height - beforeHeight)).toBeLessThan(1)
  releaseFacet()
  const choice = filter.getByRole('checkbox', { name: /GRID-DOC-249/ })
  await expect(choice).toBeEnabled()
  await choice.check()
  await expect(grid.getByText('Найдено: 1', { exact: true })).toBeVisible()
  await expect.poll(reveals).toBe(4)
  await filter.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await grid.getByRole('button', { name: 'Сбросить', exact: true }).click()
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(await reveals()).toBe(4)
  expect(await instance!.evaluate(element => element.isConnected)).toBe(true)
})

test('document filter stays above the toolbar and unclipped on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  const filter = await openDocumentGridFilter(page, 'project', 'Проект')
  await expect(filter.getByRole('checkbox').first()).toBeEnabled()
  expect(await filter.evaluate(element => element.closest('.document-grid-popup-layer')?.parentElement === document.body)).toBe(true)
  const bounds = (await filter.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(10)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(710)
  const close = filter.getByRole('button', { name: 'Закрыть фильтр', exact: true })
  expect(await close.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit === element || element.contains(hit)
  })).toBe(true)
  await close.click()
  await expect(filter).toBeHidden()
  await expect(grid.locator('.ag-header-cell[col-id="project"]')).toBeFocused()
  await openDocumentGridColumnMenu(page, 'project')
  await expect(page.getByRole('menuitem', { name: 'По возрастанию', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'По возрастанию', exact: true })).toBeHidden()
  const reopened = await openDocumentGridFilter(page, 'project', 'Проект')
  await reopened.getByRole('textbox', { name: 'Найти значение фильтра' }).press('Escape')
  await expect(reopened).toBeHidden()
  await expect(grid.locator('.ag-header-cell[col-id="project"]')).toBeFocused()
})

test('document grid numeric selection uses decimal commas and hide all preserves document identity and actions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await withLineProgramFixture(db => db.query('update weld_joints set wdi=45.6 where project_title=$1', [project]))
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов' })
  const show = settings.getByRole('button', { name: 'Показать все', exact: true })
  if (await show.count()) await show.click()
  await settings.getByRole('button', { name: 'Скрыть все', exact: true }).click()
  await expect(settings.getByRole('checkbox', { name: 'Документ', exact: true })).toBeChecked()
  await expect(settings.getByRole('checkbox', { name: 'Документ', exact: true })).toBeDisabled()
  await settings.getByRole('button', { name: 'Показать все', exact: true }).click()
  await settings.getByRole('button', { name: 'Закрыть настройки вида' }).click()
  await revealGridColumn(page, 'wdi')
  const cell = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="wdi"]')
  const before = await cell.innerText()
  await cell.click()
  await expect(grid.getByText('Количество: 1', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(',')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain(',')
  expect(text).not.toContain('.')
  expect(before).toContain(',')
})

test('document transfer: full IDs, selected group counts, complete range summaries and stale-read protection', async () => {
  for (const kind of ['generated', 'system'] as const) {
    const first = await read(kind)
    expect(first.revision).toMatch(/^[a-f0-9]{32}$/)
    const selected = await read(kind, { idsOnly: true, revision: first.revision })
    expect(selected.rows).toEqual([])
    expect(selected.ids).toHaveLength(250)
    const route = ['["value","LINE-A"]']
    const grouped = await read(kind, { idsOnly: true, rowGroupCols: ['line'], groupKeys: route, revision: first.revision })
    expect(grouped.ids).toHaveLength(124)
    expect(grouped.rows).toEqual([])
    const counted = await read(kind, { rowGroupCols: ['line'], selectedIds: grouped.ids, countRoutes: [[], route, ['["value","LINE-B"]']], revision: first.revision, cells: { columns: ['title'], summary: true } })
    expect(counted.counts).toEqual({ '[]': 124, [JSON.stringify(route)]: 124, '["[\\"value\\",\\"LINE-B\\"]"]': 0 })
    const summary = await read(kind, { startRow: 0, endRow: 250, cells: { columns: ['title', 'rowCount'], summary: true }, revision: first.revision })
    expect(summary.rows).toEqual([])
    expect(summary.summary).toEqual({ count: 500, numericCount: 250, sum: 261, average: 261 / 250 })
    // A filter hides the first selection but action hydration still resolves its exact identities.
    const hidden = await read(kind, { search: 'no matching document', selectionOnly: true, selectedIds: grouped.ids!.slice(0, 2) })
    expect(hidden.rows).toHaveLength(2)
    await expect(read(kind, { idsOnly: true, revision: '0'.repeat(32) })).rejects.toThrow('Данные реестра изменились')
    const id = Number(String(selected.ids![0]).replace('system-document:', ''))
    await withE2eDatabase(async db => { await db.query('update generated_documents set title=title || $1 where id=$2', [' changed', id]) })
    await expect(read(kind, { startRow: 100, endRow: 200, revision: first.revision })).rejects.toThrow('Данные реестра изменились')
  }
})

test('system registry revision covers metadata and parent touches outside the visible block', async () => {
  const all = await read('system', { idsOnly: true })
  const id = Number(String(all.ids!.at(-1)).replace('system-document:', ''))
  for (const assignment of [
    `source_metadata=jsonb_set(source_metadata::jsonb,'{label}',to_jsonb('Обновлённая подпись'::text))::text`,
    `specialists=jsonb_build_object('first',jsonb_build_object('name','Другой специалист'))`,
    // A parent touch also protects link-only changes; the visible fields and
    // the wall-clock timestamp need not differ for the editor token to change.
    'updated_at=updated_at',
  ]) {
    const snapshot = await read('system')
    await expect(read('system', { revision: snapshot.revision })).resolves.toMatchObject({ total: 250 })
    await withE2eDatabase(db => db.query(`update generated_documents set ${assignment} where id=$1`, [id]))
    await expect(read('system', { revision: snapshot.revision, selectedIds: [all.ids!.at(-1)!], selectionOnly: true })).rejects.toThrow('Данные реестра изменились')
  }
})

test('document transfer: full selection and clipboard include unloaded documents and retain hidden choices', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  else await page.addInitScript(() => {
    // WebKit's automation does not grant native clipboard permissions. Exercise
    // range loading/cancellation here; native clipboard remains Chrome coverage.
    let clipboard = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { clipboard = value }, readText: async () => clipboard,
    } })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  const requests = observeDocumentRequests(page)
  await page.goto('/documents')
  const grid = page.locator('[data-document-history-grid="generated:weldingJournal"]')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const checkbox = grid.getByRole('checkbox', { name: 'Выбрать все документы', exact: true })
  await checkbox.click()
  await expect(grid.getByText('Выбрано: 250', { exact: true })).toBeVisible()
  await expect(checkbox).toBeChecked()
  expect(requests.blocks.filter(request => request.idsOnly)).toHaveLength(1)
  const search = grid.getByRole('textbox', { name: 'Поиск документов', exact: true })
  await search.fill('no matching document')
  await expect(grid.getByText('Найдено: 0', { exact: true })).toBeVisible()
  await expect(grid.getByText('Выбрано: 250', { exact: true })).toBeVisible()
  await search.fill('')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  await grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="title"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).match(/GRID-DOC-\d{3}/g)?.length).toBe(250)
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text.split('\n')).toHaveLength(250)
  expect(text.split('\n')[0]).not.toContain('Документ')
  expect(text).not.toContain('Скачать Excel')
  await expect(grid.getByText('Загружено: 100', { exact: true })).toBeVisible()
})
