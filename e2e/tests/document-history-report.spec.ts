import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction, loadSystemDocumentSummaries } from '../../src/server/system-document-index'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { revealDocumentColumn, openDocumentGridColumnMenu, openDocumentGridFilter } from '../document-grid'

const project = 'E2E document registry output'
test.beforeEach(async () => {
  await loadSystemDocumentSummaries('lnkRequest')
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,isometry,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'OUTPUT',case when n%2=0 then 'LINE-B' else 'LINE-A' end,'F'||n,n::text,'2026-10-01','действующий','актуальная','да','OUTPUT-REQ-'||lpad(n::text,3,'0'),'2026-10-02'
      from generate_series(1,250) n`, [project])
    await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      select 'weldingJournal','OUTPUT-DOC-'||lpad(n::text,3,'0'),'unused.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',0 from generate_series(1,250) n`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select d.id,w.id from generated_documents d join weld_joints w on d.title='OUTPUT-DOC-'||lpad(w.isometry,3,'0') where d.type='weldingJournal' and w.project_title=$1`, [project])
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async () => { await cleanupLineProgramProjects([project]) })

for (const kind of ['generated', 'system'] as const) test(`document registry output: ${kind} filters/order/columns, unloaded rows and fresh Excel`, async ({ page }, info) => {
  await page.goto('/documents')
  if (kind === 'system') await page.getByRole('button', { name: 'Заявка ЛНК', exact: true }).click()
  const grid = page.locator(kind === 'generated' ? '[data-document-history-grid="generated:weldingJournal"]' : '[data-document-history-grid^="system:lnkRequest:"]')
  const search = grid.getByRole('textbox', { name: 'Поиск документов', exact: true })
  await search.fill(kind === 'generated' ? 'OUTPUT-DOC' : 'OUTPUT-REQ')
  await expect(grid.getByText('Найдено: 250', { exact: true })).toBeVisible()
  const lineFilter = await openDocumentGridFilter(page, 'line', 'Линия')
  await lineFilter.locator('label').filter({ hasText: 'LINE-A' }).getByRole('checkbox').check()
  await lineFilter.getByRole('button', { name: 'Закрыть фильтр', exact: true }).click()
  await expect(grid.getByText('Найдено: 125', { exact: true })).toBeVisible()
  await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройка вида документов', exact: true })
  await settings.getByRole('checkbox', { name: 'Проект', exact: true }).uncheck()
  await settings.getByRole('button', { name: 'Закрыть настройки вида', exact: true }).click()
  await revealDocumentColumn(page, 'line')
  await grid.locator('.ag-header-cell[col-id="title"] .ag-header-cell-label').click()
  await expect(grid.getByRole('button', { name: 'Показать', exact: true })).toBeEnabled()
  const headers = await grid.locator('.ag-header-cell[col-id]').evaluateAll(elements => elements.filter(element => !element.getAttribute('col-id')!.startsWith('ag-') && element.getAttribute('col-id') !== '__actions')
    .sort((a,b) => a.getBoundingClientRect().left-b.getBoundingClientRect().left).map(element => element.querySelector('.ag-header-cell-text')?.textContent ?? ''))
  await grid.getByRole('button', { name: 'Показать', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
  const frame = modal.frameLocator('iframe')
  await expect(frame.getByText(kind === 'generated' ? 'OUTPUT-DOC-001' : 'OUTPUT-REQ-001', { exact: true })).toBeVisible()
  const previewHeaders = await frame.locator('thead th').allTextContents()
  expect(previewHeaders).toEqual(headers)
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(frame.getByText(kind === 'generated' ? 'OUTPUT-DOC-249' : 'OUTPUT-REQ-249', { exact: true })).toBeVisible()
  // Another user's later rename must affect only a new download, preserving the open preview.
  const original = kind === 'generated' ? 'OUTPUT-DOC-249' : 'OUTPUT-REQ-249'
  const renamed = original + ' refreshed'
  await withE2eDatabase(db => db.query('update generated_documents set title=$1 where title=$2', [renamed, original]))
  const downloaded = page.waitForEvent('download')
  await modal.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
  const download = await downloaded
  expect(await download.failure()).toBeNull()
  const workbook = XLSX.read(await readFile((await download.path())!)), sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
  expect(rows).toHaveLength(126)
  expect(rows[0]).toEqual(headers)
  expect(rows[1][0]).toBe(kind === 'generated' ? 'OUTPUT-DOC-001' : 'OUTPUT-REQ-001')
  expect(rows[125][0]).toBe(renamed)
  await expect(frame.getByText(original, { exact: true })).toBeVisible()
  await expect(frame.getByText(renamed, { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('document-registry-report.png') })
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
  await expect(grid.getByRole('button', { name: 'Показать', exact: true })).toBeFocused()
  // Grouping must still output leaves rather than only the visible group rows.
  await openDocumentGridColumnMenu(page, 'line')
  await page.getByRole('menuitem', { name: 'Сгруппировать по «Линия»', exact: true }).click()
  await grid.getByRole('button', { name: 'Показать', exact: true }).click()
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(frame.getByText(renamed, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})
