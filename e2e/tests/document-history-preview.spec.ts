import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { loadSystemDocumentSummaries, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Request } from '@playwright/test'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { captureFullReportPrint } from '../report-print-capture'
import { rpcName } from '../rpc'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E history preview'
const manualTitle = 'E2E-PREVIEW-JSR', systemTitle = 'E2E-PREVIEW-LNK'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''

// Reproduce a populated application whose document index is already initialized.
test.beforeAll(async () => { await loadSystemDocumentSummaries('lnkRequest') })

test.beforeEach(async () => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([
    ['Шаблон — готовый документ', '', ''], ['Стык', 'Линия', 'Проект'], ['', '', ''],
  ])
  sheet['!merges'] = [XLSX.utils.decode_range('A1:C1')]
  sheet['!cols'] = [{ wpx: 160 }, { wpx: 200 }, { wpx: 280 }]
  sheet['!rows'] = [{ hpt: 30 }]
  XLSX.utils.book_append_sheet(book, sheet, 'Бланк')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Подписи — конец документа']]), 'Подписи')
  const data = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  fileKey = `e2e-history-preview/${randomUUID()}.xlsx`
  await store.set(fileKey, data)
  await withE2eDatabase(async db => {
    // Never overwrite another scenario's templates.
    expect((await db.query("select id from document_templates where id in ('weldingJournal','lnkRequest','lnkConclusionVik','pstoRequest','pstoConclusion')")).rows).toHaveLength(0)
    for (const id of ['weldingJournal', 'lnkRequest', 'lnkConclusionVik', 'pstoRequest', 'pstoConclusion']) await db.query(`insert into document_templates(id,blob_key,file_name,file_type,file_size,metadata,constructor_config)
      values ($1,$2,'preview.xlsx','xlsx',$3,$4,$5)`, [id, fileKey, data.byteLength, JSON.stringify({ fields: [], markerCount: 0, locations: [], warnings: [] }), JSON.stringify({ version: 1, sheetName: 'Бланк', repeatRow: 3, bindings: [
        { cell: 'A3', mode: 'row', field: 'joint' }, { cell: 'B3', mode: 'row', field: 'line' }, { cell: 'C3', mode: 'row', field: 'projectTitle' },
      ] })])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,has_vik,vik_request,vik_request_date)
      select $1,'PREVIEW','LINE','F'||lpad(n::text,3,'0'),'2026-10-01','действующий','актуальная','да',$2,'2026-10-02' from generate_series(1,125) n`, [project, systemTitle])
    for (let n = 0; n < 25; n++) {
      const title = n === 0 ? manualTitle : `${manualTitle}-${n}`
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count) values ('weldingJournal',$1,'preview.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',125) returning id`, [title])).rows[0].id
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,id from weld_joints where project_title=$2', [id, project])
    }
  })
  // SQL fixtures bypass the normal save workflow: explicitly index this project's
  // new documents even when an earlier scenario already initialized the index.
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterEach(async () => {
  await withE2eDatabase(async db => {
    await db.query("delete from document_templates where blob_key=$1", [fileKey])
    await db.query('delete from generated_documents where title like $1', ['E2E-PREVIEW-%'])
  })
  await cleanupLineProgramProjects([project])
  if (fileKey) await store.delete(fileKey)
})

async function chooseProject(page: Page) {
  await page.getByTitle('Фильтр: Проект', { exact: true }).click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Проект', exact: true })
  await filter.getByRole('button', { name: new RegExp(project) }).click()
  await page.keyboard.press('Escape')
  await expect(filter).toBeHidden()
}

test('history preview: manual and system documents, all sheets, full print/download, bounded reads, Escape order', async ({ page }, info) => {
  const errors: string[] = [], calls: string[] = []
  const pending = new Set<Request>()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) { calls.push(rpcName(request.url())); pending.add(request) } })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await page.goto('/documents')
  for (const [view, title, rowRpc] of [['ЖСР', manualTitle, 'getRemoteGeneratedDocumentRows'], ['Заявка ЛНК', systemTitle, 'getSystemDocumentRows']]) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await chooseProject(page)
    const titleButton = page.getByRole('button', { name: title, exact: true })
    await expect(titleButton).toBeVisible()
    await expect(page.getByTitle('Открыть актуальный Excel', { exact: true })).toHaveCount(0)
    await expect(page.getByTitle('Открыть Excel', { exact: true })).toHaveCount(0)
    const checkbox = page.getByRole('button', { name: `Выбрать документ «${title}»`, exact: true })
    await checkbox.click()
    const beforeOpen = calls.length
    if (view === 'ЖСР') await titleButton.click()
    else {
      await titleButton.click({ button: 'right' })
      await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click()
    }
    const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
    const frame = modal.frameLocator('iframe')
    await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
    const heading = frame.locator('td').filter({ hasText: 'Шаблон — готовый документ' })
    await expect(heading).toHaveAttribute('colspan', '3')
    await expect.poll(() => heading.locator('..').evaluate(row => row.getBoundingClientRect().height)).toBeGreaterThanOrEqual(39)
    expect(calls.slice(beforeOpen).filter(name => name.startsWith(rowRpc))).toHaveLength(1)
    await expect.poll(() => pending.size).toBe(0)
    const localStart = calls.length
    await modal.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(frame.getByText('F125', { exact: true })).toBeVisible()
    await modal.getByLabel('Лист документа').selectOption('1')
    await expect(frame.getByText('Подписи — конец документа')).toBeVisible()
    await modal.getByLabel('Масштаб документа').selectOption('75')
    await captureFullReportPrint(page)
    await modal.getByRole('button', { name: 'Печать / Сохранить PDF' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.fullPrint ?? '{}').lastRow)).toBe('Подписи — конец документа')
    const downloadEvent = page.waitForEvent('download')
    await modal.getByRole('button', { name: 'Скачать Excel' }).click()
    const download = await downloadEvent
    const book = XLSX.read(await readFile((await download.path())!), { type: 'buffer' })
    expect(book.SheetNames).toEqual(['Бланк', 'Подписи'])
    expect(book.Sheets['Бланк'].A127.v).toBe('F125')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await expect.poll(() => pending.size).toBe(0)
    expect(calls.slice(localStart).filter(name => !name.startsWith('getDispatcherTaskVersion'))).toEqual([])
    await modal.getByLabel('Лист документа').selectOption('0')
    // The iframe is rewritten asynchronously on a sheet change. A screenshot
    // taken before it is ready only captures the empty loading surface.
    await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Печать / Сохранить PDF' })).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`${view === 'ЖСР' ? 'manual' : 'system'}-preview.png`) })
    await frame.locator('body').press('Escape')
    await expect(modal).toBeHidden()
    await expect(checkbox).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTitle(/^Проект: /)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(checkbox).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTitle(/^Проект: /)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTitle('Фильтр: Проект', { exact: true })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('navigation stays visible and clickable when scrolling history; Formation preview stays inline', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/documents')
  await expect(page.getByRole('button', { name: manualTitle, exact: true })).toBeVisible()
  await page.mouse.move(700, 650); await page.mouse.wheel(0, 900)
  const navigation = page.locator('[data-documents-navigation]')
  await expect.poll(() => navigation.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0)
  await expect(page.getByRole('button', { name: 'ЖСР', exact: true })).toBeInViewport()
  await expect(page.getByRole('tab', { name: 'Формирование', exact: true })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('sticky-documents.png') })
  await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть на весь экран', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})


async function revealReportDocument(page: Page, title: string) {
  const button = page.getByRole('button', { name: title, exact: true }).first()
  const viewport = page.locator('.ag-grid-viewport')
  await expect(page.getByRole('button', { name: 'F001', exact: true })).toBeVisible()
  if (await viewport.count()) await viewport.evaluate(element => { element.scrollLeft = 0 })
  else await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }))
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  for (let step = 0; step < 40 && !await button.count(); step++) {
    if (await viewport.count()) await viewport.evaluate(element => { element.scrollLeft += 650 })
    else await page.evaluate(() => window.scrollBy(650, 0))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  await expect(button).toBeAttached()
  return button
}

test('report conclusion and joint picture open template preview inline; Escape keeps the picture and filter', async ({ page, context }, info) => {
  const title = 'E2E-PREVIEW-VIK'
  await withE2eDatabase(db => db.query("update weld_joints set vik_result='годен',vik_conclusion=$2,vik_conclusion_date='2026-10-03' where project_title=$1", [project, title]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  const joint = page.getByRole('button', { name: 'F001', exact: true })
  await expect(joint).toBeVisible()
  await joint.click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F001', exact: true }) })
  await picture.getByRole('button', { name: title, exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  await expect(modal.frameLocator('iframe').getByText('Шаблон — готовый документ')).toBeVisible()
  await page.screenshot({ path: info.outputPath('joint-document-preview.png') })
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await expect(picture).toBeVisible()
  await expect(picture.getByRole('button', { name: title, exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picture).toBeHidden()
  await expect(page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' })).toHaveValue(project)

  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  const conclusion = await revealReportDocument(page, title)
  await expect(conclusion).toBeAttached()
  const before = calls.length
  await conclusion.click()
  await expect(modal.frameLocator('iframe').getByText('Шаблон — готовый документ')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  expect(calls.slice(before).filter(name => name.startsWith('getSystemDocumentRows_'))).toHaveLength(1)
  await modal.frameLocator('iframe').locator('body').press('Escape')
  await expect(modal).toBeHidden()
  expect(context.pages()).toHaveLength(1)
  expect(errors).toEqual([])
})

test('request names open the exact document in grouped journal and LNK; missing template never opens the editor', async ({ page, context }) => {
  const secondTitle = 'E2E-PREVIEW-RK-REQUEST'
  await withE2eDatabase(db => db.query("update weld_joints set has_rk='да',rk_request=$2,rk_request_date='2026-10-03' where project_title=$1 and joint in ('F001','F002')", [project, secondTitle]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  for (const route of ['/journal', '/lnk']) {
    await page.goto(route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByRole('button', { name: 'F001', exact: true })).toBeVisible()
    if (route === '/journal') {
      await page.locator('.ag-header-cell[col-id="line"]').click({ button: 'right' })
      await page.getByRole('menuitem', { name: /Сгруппировать загруженные по «Линия»/ }).click()
      await page.locator('.ag-full-width-row.ag-row-group .ag-group-contracted').click()
    }
    for (const title of [systemTitle, secondTitle]) {
      const link = await revealReportDocument(page, title)
      await link.click()
      await expect(modal.getByText(title, { exact: true })).toBeVisible()
      const frame = modal.frameLocator('iframe')
      await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
      await expect(frame.getByText('F001', { exact: true })).toBeVisible()
      if (title === secondTitle) {
        await expect(frame.getByText('F002', { exact: true })).toBeVisible()
        await expect(frame.getByText('F003', { exact: true })).toHaveCount(0)
        await expect(modal.getByRole('button', { name: 'Далее', exact: true })).toHaveCount(0)
      } else {
        await modal.getByRole('button', { name: 'Далее', exact: true }).click()
        await expect(frame.getByText('F125', { exact: true })).toBeVisible()
      }
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
    }
  }
  await withE2eDatabase(db => db.query("delete from document_templates where id='lnkRequest'"))
  await page.reload()
  const link = await revealReportDocument(page, systemTitle)
  await link.click()
  await expect(modal.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await link.click({ button: 'right' })
  await page.getByRole('button', { name: 'Редактирование', exact: true }).hover()
  await page.getByRole('button', { name: 'Заявка · Основной', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование заявок ЛНК', exact: true })).toBeVisible()
  await expect(modal).toBeHidden()
  expect(context.pages()).toHaveLength(1)
  expect(errors).toEqual([])
})

test('missing conclusion template never opens the LNK editor and cancelled preparation stays closed', async ({ page, context }) => {
  const title = 'E2E-PREVIEW-NO-TEMPLATE'
  await withE2eDatabase(async db => {
    await db.query("delete from document_templates where id='lnkConclusionVik'")
    await db.query("update weld_joints set vik_result='годен',vik_conclusion=$2,vik_conclusion_date='2026-10-03' where project_title=$1", [project, title])
  })
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  const conclusion = await revealReportDocument(page, title)
  await conclusion.click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  await expect(modal.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let waiting = false
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getRemoteDocumentTemplate_')) { waiting = true; await gate }
    await route.continue()
  })
  await conclusion.click()
  await expect(modal).toBeVisible()
  await expect.poll(() => waiting).toBe(true)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  release()
  await page.waitForLoadState('networkidle')
  await expect(modal).toBeHidden()
  expect(context.pages()).toHaveLength(1)
})

test('PSTO names open exact previews from their report columns, including missing templates', async ({ page, context }) => {
  const requestTitle = 'E2E-PREVIEW-PSTO-REQUEST', conclusionTitle = 'E2E-PREVIEW-PSTO-CONCLUSION'
  await withLineProgramFixture(db => db.query(`update weld_joints set psto_required='да',psto_request=$2,psto_request_date='2026-10-03',
    psto_result='проведено',psto_date='2026-10-04',heat_treatment_diagram=$3
    where project_title=$1 and joint in ('F001','F002')`, [project, requestTitle, conclusionTitle]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  for (const route of ['/journal', '/psto']) {
    await page.goto(route)
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    // The journal exposes the request; the PSTO report also exposes the diagram.
    const titles = route === '/journal' ? [requestTitle] : [requestTitle, conclusionTitle]
    for (const title of titles) {
      const link = await revealReportDocument(page, title)
      await link.scrollIntoViewIfNeeded()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const originalScrollX = await page.evaluate(() => window.scrollX)
      const before = calls.length
      await link.click()
      await expect(modal.getByText(title, { exact: true })).toBeVisible()
      // Moving focus into the portalled preview must not unmount the source
      // column through the report's window-based horizontal virtualization.
      expect(await page.evaluate(() => window.scrollX)).toBe(originalScrollX)
      const frame = modal.frameLocator('iframe')
      await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
      await expect(frame.getByText('F001', { exact: true })).toBeVisible()
      await expect(frame.getByText('F002', { exact: true })).toBeVisible()
      await expect(frame.getByText('F003', { exact: true })).toHaveCount(0)
      expect(calls.slice(before).filter(name => name.startsWith('getSystemDocumentRows_'))).toHaveLength(1)
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
      if (route === '/journal') await expect.poll(() => link.evaluate(element => element.closest('.ag-cell')?.contains(document.activeElement))).toBe(true)
      else await expect(link).toBeFocused()
    }
  }
  await withE2eDatabase(db => db.query("delete from document_templates where id in ('pstoRequest','pstoConclusion') and blob_key=$1", [fileKey]))
  await page.reload()
  for (const title of [requestTitle, conclusionTitle]) {
    const link = await revealReportDocument(page, title)
    await link.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const originalScrollX = await page.evaluate(() => window.scrollX)
    await link.click()
    await expect(modal.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
    expect(await page.evaluate(() => window.scrollX)).toBe(originalScrollX)
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(link).toBeFocused()
  }
  // The independent workflow editor remains available even without templates.
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'История ПСТО и ТВМТ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'История ПСТО и ТВМТ', exact: true })).toBeVisible()
  await expect(modal).toBeHidden()
  expect(context.pages()).toHaveLength(1)
  expect(errors).toEqual([])
})

test('line-program document portal isolates the underlying joint menu while loading, ready and missing-template states', async ({ page, context }) => {
  await withLineProgramFixture(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'PREVIEW','LINE','II','A',100,10) returning id`, [project])
    await db.query(`update weld_joints set line_program_id=$2,connection_type='С17',category='II',group_name='A',weld_control_percent=100,pvk_control_percent=10,stamp_1_k='PREVIEW'
      where project_title=$1`, [project, line.id])
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-program')
  await expect(page.getByTestId('line-program').getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill(project)
  const card = page.getByTestId('line-program-card')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: 'Расчёт линии LINE', exact: true }).click()
  await card.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await card.getByRole('button', { name: 'F001', exact: true }).click()
  const history = card.getByLabel('История контроля F001', { exact: true })
  const link = history.getByRole('button', { name: systemTitle, exact: true })
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let waiting = false
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getRemoteDocumentTemplate_')) { waiting = true; await gate }
    await route.continue()
  })
  await link.click()
  await expect.poll(() => waiting).toBe(true)
  await modal.getByRole('heading', { name: 'Предпросмотр документа' }).click({ button: 'right' })
  await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  release()
  await expect(modal.frameLocator('iframe').getByText('Шаблон — готовый документ')).toBeVisible()
  for (const target of [modal.getByRole('heading', { name: 'Предпросмотр документа' }), modal.getByRole('button', { name: 'Скачать Excel', exact: true })]) {
    await target.click({ button: 'right' })
    await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  }
  await modal.getByRole('button', { name: 'Закрыть предпросмотр' }).press('Shift+F10')
  await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await expect(link).toBeFocused()
  await expect(history).toBeVisible()

  await withE2eDatabase(db => db.query("delete from document_templates where id='lnkRequest' and blob_key=$1", [fileKey]))
  await link.click()
  await expect(modal.getByRole('alert')).toHaveText('Шаблон системного документа не загружен.')
  await modal.getByRole('heading', { name: 'Предпросмотр документа' }).click({ button: 'right' })
  await expect(page.getByTestId('context-action-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(link).toBeFocused()
  await link.click({ button: 'right' })
  await page.getByRole('button', { name: 'Перейти к назначениям стыка', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Назначения · LINE', exact: true })).toBeVisible()
  await expect(modal).toBeHidden()
  expect(context.pages()).toHaveLength(1)
  expect(errors).toEqual([])
})
