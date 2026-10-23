import { editJournalJoint } from '../journal-grid'
import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { rpcName } from '../rpc'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { DISPATCHER_BACKGROUND_INDEX_LOCK_ID, DISPATCHER_REFRESH_LOCK_ID } from '../../src/server/dispatcher-task-index-constants'

const project = 'E2E independent summaries'
const first = 'F970101'
const second = 'F970202'
const editable = 'F970303'
const summary = (page: Page) => page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  .locator('xpath=../..').locator(':scope > span')

test.beforeAll(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,psto_required,officiality)
      values ($1,'SUMMARY','SUMMARY-LINE',$2,'2026-09-01','СШ','да','да','действующий'),
      ($1,'SUMMARY','SUMMARY-LINE',$3,'2026-09-01','СШ','да','да','действующий')`, [project, first, second])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,connection_type,officiality)
      values ($1,'SUMMARY','SUMMARY-LINE',$2,'СШ','действующий')`, [project, editable])
    await db.query("update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,dirty_scopes='[]'")
  })
})
test.afterAll(() => cleanupLineProgramProjects([project]))

for (const path of ['/journal', '/lnk', '/psto']) {
  test(`${path}: rows and their actions work while summary is pending`, async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    await page.route('**/_serverFn/**', async route => {
      if (rpcName(route.request().url()).startsWith('getJournalReportSummary_')) {
        requests++
        await gate
      }
      await route.continue()
    })
    try {
      await page.goto(path)
      await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(first)
      const row = page.getByRole('button', { name: first, exact: true }).locator('xpath=ancestor::*[@role="row"]')
      await expect(row).toBeVisible()
      await expect.poll(() => requests).toBeGreaterThan(0)
      await expect(summary(page)).toContainText(/Ид[её]т подсч[её]т/)
      if (path === '/journal') {
        await editJournalJoint(page, first)
        const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
        await expect(editor).toBeVisible()
        await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
      } else {
        // Dedicated control reports deliberately have no general edit button.
        const select = row.getByRole('checkbox')
        await select.check()
        await expect(select).toBeChecked()
        await row.getByRole('button', { name: first, exact: true }).click()
        const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${first}`, exact: true }) })
        await expect(picture).toBeVisible()
        await picture.getByRole('button', { name: 'Закрыть', exact: true }).click()
      }
      release()
      await expect(summary(page)).toContainText(/(?:Записей|Стыков на ЛНК|Стыков на ПСТО): 1(?:\s|·|$)/)
    } finally { release() }
  })
}

test('late search response cannot replace the newer selection or its summary', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let blocked = false
  await page.route('**/_serverFn/**', async route => {
    const request = route.request()
    if (rpcName(request.url()).startsWith('readJournalGrid_') &&
      request.postData()?.includes(first)) {
      blocked = true
      await gate
    }
    await route.continue()
  })
  try {
    await page.goto('/journal')
    const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
    await search.fill(first)
    await expect.poll(() => blocked).toBe(true)
    await search.fill(second)
    await expect(page.getByRole('button', { name: second, exact: true })).toBeVisible()
    await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
    release()
    await page.waitForLoadState('networkidle')
    await expect(search).toHaveValue(second)
    await expect(page.getByRole('button', { name: second, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: first, exact: true })).toBeHidden()
    await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
  } finally { release() }
})

test('summary failure does not hide the found rows or prevent opening their cards', async ({ page }) => {
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getJournalReportSummary_')) {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Summary temporarily unavailable' })
    } else await route.continue()
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(second)
  const row = page.getByRole('button', { name: second, exact: true }).locator('xpath=ancestor::*[@role="row"]')
  await expect(row).toBeVisible()
  await expect(summary(page)).toContainText(/Не удалось|Ошибка/)
  await editJournalJoint(page, second)
  await expect(page.getByRole('heading', { name: 'Редактирование стыка', exact: true })).toBeVisible()
})

test('fast typing is coalesced and does not request every intermediate search', async ({ page }) => {
  await page.goto('/journal')
  const search = page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })
  await search.fill(first)
  await expect(page.getByRole('button', { name: first, exact: true })).toBeVisible()
  await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
  await page.waitForLoadState('networkidle')
  const requests: string[] = []
  page.on('request', request => {
    if (rpcName(request.url()).startsWith('readJournalGrid_')) requests.push(request.postData() ?? '')
  })
  await search.fill('')
  await search.pressSequentially(second, { delay: 8 })
  // AG Grid retains the outgoing, transparent row until its animation ends.
  const result = page.locator('.ag-row:not(.ag-opacity-zero)').getByRole('button', { name: second, exact: true })
  await expect(result).toHaveCount(1)
  await expect(result).toBeVisible()
  await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain(second)
})

test('failed background refresh after saving shows an explicit retry and keeps the saved change', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(editable)
  await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
  await page.waitForLoadState('networkidle')
  await editJournalJoint(page, editable)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
  await editor.getByLabel('Изометрия', { exact: true }).fill('SUMMARY-SAVED')
  let blocked = true, failedReads = 0
  let release!: () => void
  const publicationGate = new Promise<void>(resolve => { release = resolve })
  let refreshRequests = 0
  const refreshStatuses: number[] = []
  await page.route('**/_serverFn/**', async route => {
    const name = rpcName(route.request().url())
    if (route.request().method() === 'POST' && name.startsWith('refreshDispatcherTaskSnapshot_')) {
      refreshRequests++
      // Finish the real server calculation; hold only its publication to this
      // client so it cannot race the first failed post-save rows refresh.
      const response = await route.fetch()
      refreshStatuses.push(response.status())
      await publicationGate
      await route.fulfill({ response })
    } else if (blocked && name.startsWith('readJournalGrid_')) {
      failedReads++
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Rows temporarily unavailable' })
    } else await route.continue()
  })
  try {
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
    await expect(summary(page)).toContainText('Не удалось обновить строки')
    const retry = page.getByRole('button', { name: 'Повторить загрузку строк', exact: true })
    await expect(retry).toBeVisible()
    await expect.poll(() => refreshStatuses).toEqual([200])
    expect(refreshRequests).toBe(1)
    expect(failedReads).toBe(1)
    // No error-driven retry before publication, even though the server has
    // already finished calculating the new dispatcher snapshot.
    await page.waitForTimeout(1100)
    expect(failedReads).toBe(1)
    expect(refreshRequests).toBe(1)

    release()
    // Fresh dispatcher publication legitimately invalidates rows once. It
    // must not turn the second failure into a timer/reconciliation loop.
    await expect.poll(() => failedReads).toBe(2)
    await expect(summary(page)).toContainText('Не удалось обновить строки')
    await expect(retry).toBeVisible()
    await page.waitForTimeout(1100)
    expect(failedReads).toBe(2)
    expect(refreshRequests).toBe(1)
    expect(await withE2eDatabase(async db => (await db.query(
      'select isometry from weld_joints where project_title=$1 and joint=$2', [project, editable],
    )).rows[0].isometry)).toBe('SUMMARY-SAVED')
    blocked = false
    await retry.click()
    await expect(summary(page)).toContainText(/Записей: 1(?:\s|·|$)/)
    await expect(retry).toBeHidden()
    await editJournalJoint(page, editable)
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Стык', exact: true }).first().click()
    await expect(editor.getByLabel('Изометрия', { exact: true })).toHaveValue('SUMMARY-SAVED')
    await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
  } finally { release() }
})

for (const path of ['/lnk', '/psto']) test(`${path}: current preview and real Excel preserve the selected descending order`, async ({ page }) => {
  await page.goto(path)
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F970')
  await expect(summary(page)).toContainText(/(?:Стыков на ЛНК|Стыков на ПСТО): 2(?:\s|·|$)/)
  const header = page.locator('[data-weld-report-grid] .ag-header-cell[col-id="joint"]')
  await header.locator('.ag-header-cell-text').click()
  await expect(header).toHaveAttribute('aria-sort', 'ascending')
  await header.locator('.ag-header-cell-text').click()
  await expect(header).toHaveAttribute('aria-sort', 'descending')
  // AG reuses DOM nodes and positions them by row-index; DOM insertion order
  // can remain unchanged after sorting. Assert the actual displayed order.
  for (const [index, joint] of [second, first].entries()) {
    await expect(page.locator(`[data-weld-report-grid] .ag-grid-scrolling-rows .ag-row[row-index="${index}"] [col-id="joint"]`)
      .getByRole('button', { name: /^F970\d{3}$/ })).toHaveText(joint)
  }
  await page.locator('header').getByRole('button', { name: 'Показать', exact: true }).click()
  await page.getByRole('button', { name: 'Текущая версия', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const previewRows = preview.frameLocator('iframe').locator('tbody tr')
  await expect(previewRows).toHaveCount(2)
  await expect(previewRows.nth(0)).toContainText(second)
  await expect(previewRows.nth(1)).toContainText(first)
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloading
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
  expect(rows.flatMap(row => row.filter(value => value === first || value === second))).toEqual([second, first])
})

async function withPausedDispatcherPublishers(run: () => Promise<void>) {
  const { ensureDispatcherTaskIndexFresh } = await import('../../src/server/dispatcher-task-index')
  await ensureDispatcherTaskIndexFresh()
  // Earlier browser scenarios may leave an already-started refresh running.
  // Freeze publishers, not reads: this test owns the synthetic publications and
  // must not race an unrelated rebuild while asserting unchanged fact revision.
  await withE2eDatabase(async publicationGuard => {
    const locks = [DISPATCHER_REFRESH_LOCK_ID, DISPATCHER_BACKGROUND_INDEX_LOCK_ID]
    for (const lock of locks) await publicationGuard.query('select pg_advisory_lock($1)', [lock])
    try { await run() }
    finally {
      for (const lock of [...locks].reverse()) await publicationGuard.query('select pg_advisory_unlock($1)', [lock])
    }
  })
}

test('task-filter totals follow active/background publications without a fact revision change', () => withPausedDispatcherPublishers(async () => {
  const { getWeldReportSummary } = await import('../../src/server/weld-read')
  const { readJournalGrid, countJournalGridSelection } = await import('../../src/server/journal-grid')
  const { summarizeJournalGridRange } = await import('../../src/server/journal-grid-range')
  const { readJournalFilterPage } = await import('../../src/server/journal-filter-options')
  const request = { report: 'lnk' as const, search: first,
    columnFilters: { __dispatcherTaskFilter: JSON.stringify({ mode: 'codes', codes: ['E2E-PUB'] }) } }
  const sourceRevision = () => withE2eDatabase(async db => (await db.query('select source_revision from derived_calculation_state where id=1')).rows[0].source_revision)
  const original = await withE2eDatabase(async db => {
    await db.query('insert into dispatcher_background_task_index_state(id) values(1) on conflict do nothing')
    return {
      id: (await db.query('select id from weld_joints where project_title=$1 and joint=$2', [project, first])).rows[0].id,
      active: (await db.query('select computed_at from dispatcher_task_index_state where id=1')).rows[0].computed_at,
      background: (await db.query('select computed_at from dispatcher_background_task_index_state where id=1')).rows[0].computed_at,
    }
  })
  try {
    expect((await getWeldReportSummary({ data: request })).total).toBe(0)
    const gridRequest = { columnFilters: { ...request.columnFilters, search: first }, groupBy: [], route: [], start: 0, end: 100 }
    const empty = await readJournalGrid(gridRequest)
    expect(empty.rowCount).toBe(0)
    const revision = await sourceRevision()
    for (const [tasks, state] of [
      ['dispatcher_row_tasks', 'dispatcher_task_index_state'],
      ['dispatcher_background_row_tasks', 'dispatcher_background_task_index_state'],
    ]) {
      // The task facet depends on publication even without a task row filter.
      const taskFacet = { fieldKey: 'dispatcherTasks' as const, search: first }
      const previousTaskOptions = await readJournalFilterPage(taskFacet)
      // Simulate atomic index publication, not a business-fact change. The
      // synthetic code isolates this test from actual missing-field warnings.
      await withE2eDatabase(async db => {
        await db.query('begin')
        await db.query(`insert into ${tasks}(weld_joint_id,task_key,code) values($1,'e2e-publication','E2E-PUB')`, [original.id])
        await db.query(`update ${state} set computed_at=clock_timestamp() where id=1`)
        await db.query('commit')
      })
      expect(await sourceRevision()).toBe(revision)
      expect((await readJournalFilterPage(taskFacet)).revision).not.toBe(previousTaskOptions.revision)
      await expect(readJournalFilterPage({ ...taskFacet, revision: previousTaskOptions.revision })).rejects.toThrow('Данные журнала изменились')
      expect((await getWeldReportSummary({ data: request })).total).toBe(1)
      const found = await readJournalGrid(gridRequest)
      expect(found.rowCount).toBe(1)
      expect(found.rows.map(row => row.id)).toEqual([original.id])
      const grouped = { ...gridRequest, groupBy: ['line' as const], revision: found.revision }
      expect((await readJournalGrid(grouped)).rows[0].journalGroup?.recordCount).toBe(1)
      const range = { ...gridRequest, revision: found.revision, anchor: 'line', parts: [{ route: [], start: 0, end: 1, columns: ['joint' as const] }] }
      expect((await summarizeJournalGridRange(range)).count).toBe(1)
      const facet = { columnFilters: gridRequest.columnFilters, fieldKey: 'joint' as const, revision: found.revision }
      expect((await readJournalFilterPage(facet)).total).toBe(1)
      await expect(readJournalGrid({ ...gridRequest, revision: empty.revision })).rejects.toThrow('Данные журнала изменились')
      const counts = await countJournalGridSelection({ ...gridRequest, ids: [original.id], routes: [], revision: found.revision })
      expect(counts.total).toBe(1)
      await withE2eDatabase(async db => {
        await db.query('begin')
        await db.query(`delete from ${tasks} where weld_joint_id=$1 and task_key='e2e-publication'`, [original.id])
        await db.query(`update ${state} set computed_at=clock_timestamp() where id=1`)
        await db.query('commit')
      })
      expect(await sourceRevision()).toBe(revision)
      expect((await getWeldReportSummary({ data: request })).total).toBe(0)
      expect((await readJournalGrid(gridRequest)).rowCount).toBe(0)
      await expect(readJournalGrid(grouped)).rejects.toThrow('Данные журнала изменились')
      await expect(summarizeJournalGridRange(range)).rejects.toThrow('Данные журнала изменились')
      await expect(readJournalFilterPage(facet)).rejects.toThrow('Данные журнала изменились')
      await expect(countJournalGridSelection({ ...gridRequest, snapshot: counts.snapshot, routes: [], revision: found.revision })).rejects.toThrow('Данные журнала изменились')
    }
  } finally {
    await withE2eDatabase(async db => {
      await db.query("delete from dispatcher_row_tasks where weld_joint_id=$1 and task_key='e2e-publication'", [original.id])
      await db.query("delete from dispatcher_background_row_tasks where weld_joint_id=$1 and task_key='e2e-publication'", [original.id])
      await db.query('update dispatcher_task_index_state set computed_at=$1 where id=1', [original.active])
      await db.query('update dispatcher_background_task_index_state set computed_at=$1 where id=1', [original.background])
    })
  }
}))
