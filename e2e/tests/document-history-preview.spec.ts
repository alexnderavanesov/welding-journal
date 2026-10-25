import { documentGridRow, openDocumentGridFilter, revealDocumentColumn } from '../document-grid'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { loadSystemDocumentSummaries, syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page, type Request } from '@playwright/test'
import * as XLSX from 'xlsx'
import { withE2eDatabase } from '../database'
import { downloadPreviewExcel, previewSheetText } from '../document-sheet'
import { rpcName } from '../rpc'
import { auditSqlCount } from '../audit-sql'
import { createDocumentTemplateFileStore, resolveDocumentTemplateStorageDirectory } from '../../src/server/document-template-files'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withSignatureSheetArtwork } from '../../src/test/fixtures/template-preview-workbook'
import { readHistoryDocumentWorkbook } from '../../src/lib/history-document-preview'

const project = 'E2E history preview'
const manualTitle = 'E2E-PREVIEW-JSR', systemTitle = 'E2E-PREVIEW-LNK'
const store = createDocumentTemplateFileStore(resolveDocumentTemplateStorageDirectory())
let fileKey = ''

// Reproduce a populated application whose document index is already initialized.
test.setTimeout(120_000)

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
  const data = await withSignatureSheetArtwork(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
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
  const filter = await openDocumentGridFilter(page, 'project', 'Проект')
  await filter.getByRole('checkbox', { name: new RegExp(project) }).check()
  await page.keyboard.press('Escape')
  await expect(filter).toBeHidden()
}

test('history preview: manual/system documents, every sheet, full Excel, selection and Escape', async ({ page }, info) => {
  const errors: string[] = [], calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/documents')
  for (const [view, title, rowRpc] of [['ЖСР', manualTitle, 'getRemoteGeneratedDocumentRows'], ['Заявка ЛНК', systemTitle, 'getSystemDocumentRows']]) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await chooseProject(page)
    const { checkbox, titleCell } = await documentGridRow(page, title)
    const titleButton = titleCell.getByRole('button', { name: title, exact: true })
    await checkbox.check()
    const before = calls.length
    await titleButton.click()
    const modal = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
    expect(await previewSheetText(modal)).toContain('Шаблон — готовый документ')
    const file = await downloadPreviewExcel(page, modal)
    expect(file.workbook.SheetNames).toEqual(['Бланк', 'Подписи'])
    expect(file.workbook.Sheets.Бланк.A127.v).toBe('F125')
    expect(calls.slice(before).filter(name => name.startsWith(rowRpc))).toHaveLength(1)
    const local = calls.length
    await modal.getByRole('button', { name: 'Далее', exact: true }).click()
    await expect(modal.frameLocator('iframe').getByText('F125', { exact: true })).toBeVisible()
    await modal.getByLabel('Лист документа').selectOption('1')
    await expect(modal.frameLocator('iframe').getByText('Подписи — конец документа')).toBeVisible()
    const signature = modal.frameLocator('iframe').locator('[data-cell-address="A1"]')
    await expect(signature).toHaveCSS('color', 'rgb(0, 128, 0)')
    await expect(signature).toHaveCSS('border-bottom-width', '2px')
    const logo = modal.frameLocator('iframe').getByRole('img', { name: 'Логотип подписей' })
    await expect(logo).toBeVisible()
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const downloaded = await readHistoryDocumentWorkbook(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer)
    expect(downloaded.sheets[1].images).toHaveLength(1)
    expect(downloaded.sheets[1].styles.get('1:1')).toMatchObject({ color: '#008000', borderBottom: '2px solid #000000' })
    await modal.getByLabel('Лист документа').selectOption('0')
    await modal.getByLabel('Масштаб листа').selectOption('75')
    expect(calls.slice(local).filter(name => !name.startsWith('getDispatcherTaskVersion'))).toEqual([])
    await page.screenshot({ path: info.outputPath(view === 'ЖСР' ? 'manual-sheet.png' : 'system-sheet.png') })
    await modal.getByLabel('Масштаб листа').click()
    await expect(modal.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape'); await expect(modal.getByRole('listbox')).toHaveCount(0)
    await expect(modal).toBeVisible()
    await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
    await expect(titleCell).toBeFocused(); await expect(checkbox).toBeChecked()
    await titleButton.click()
    expect((await downloadPreviewExcel(page, modal)).text).toBe(file.text)
    await page.keyboard.press('Escape')
    await expect(titleCell).toBeFocused(); await expect(checkbox).toBeChecked()
    await page.keyboard.press('Escape'); await expect(checkbox).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-document-history-grid] .ag-header-cell[col-id="project"] .ag-header-cell-filter-button')).not.toHaveClass(/ag-filter-active/)
  }
  expect(errors).toEqual([])
})

test('manual document Excel: failed loading is visible, retry downloads the complete file and preserves selection', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  await chooseProject(page)
  const row = await documentGridRow(page, manualTitle)
  await row.checkbox.check()
  let attempts = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('getRemoteGeneratedDocumentRows')) return route.continue()
    if (++attempts === 1) return route.abort('failed')
    return route.continue()
  })
  await row.actions.getByTitle('Скачать Excel', { exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(row.checkbox).toBeChecked()
  const downloaded = page.waitForEvent('download')
  await row.actions.getByTitle('Скачать Excel', { exact: true }).click()
  const file = await downloaded
  expect(await file.failure()).toBeNull()
  const book = XLSX.read(await readFile((await file.path())!), { type: 'buffer' })
  expect(book.Sheets['Бланк'].A127.v).toBe('F125')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(row.checkbox).toBeChecked()
  expect(attempts).toBe(2)
  expect(errors).toEqual([])
})

test('navigation stays visible and clickable when scrolling history; Formation preview stays inline', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/documents')
  await expect(page.getByRole('button', { name: `${manualTitle}-24`, exact: true })).toBeVisible()
  await page.mouse.move(700, 650); await page.mouse.wheel(0, 900)
  const navigation = page.locator('[data-documents-navigation]')
  await expect.poll(() => navigation.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0)
  await expect(page.getByRole('button', { name: 'ЖСР', exact: true })).toBeInViewport()
  await expect(page.getByRole('tab', { name: 'Формирование', exact: true })).toBeInViewport()
  const footer = page.locator('.document-grid-footer')
  const geometry = () => footer.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const coverElement = document.querySelector('.document-grid-bottom-cover')!
    const cover = getComputedStyle(coverElement)
    const section = element.closest('section')!.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: parseFloat(cover.height), viewport: innerHeight,
      coverLeft: parseFloat(cover.left), coverRight: parseFloat(cover.left) + parseFloat(cover.width),
      sectionLeft: section.left, sectionRight: section.right,
      outsideScrollTree: coverElement.parentElement === document.body,
      coverPosition: cover.position, coverBottom: cover.bottom, coverBackground: cover.backgroundColor }
  })
  const first = await geometry()
  expect(first.outsideScrollTree).toBe(true)
  expect(first.coverPosition).toBe('fixed')
  expect(first.coverBottom).toBe('0px')
  expect(first.coverBackground).toBe('rgb(244, 247, 249)')
  expect(Math.abs(first.bottom + first.height - first.viewport)).toBeLessThanOrEqual(1)
  // The outer registry border must not continue below the fixed footer.
  expect(first.coverLeft).toBeLessThanOrEqual(first.sectionLeft)
  expect(first.coverRight).toBeGreaterThanOrEqual(first.sectionRight)
  const beforeScroll = await page.evaluate(() => scrollY)
  await page.mouse.wheel(0, -200)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(beforeScroll)
  await expect.poll(async () => (await geometry()).top).toBe(first.top)
  // Inspect painted pixels, not only the footer's settled layout rectangle.
  for (const delta of [400, -180, 9000, -240]) {
    await page.mouse.wheel(0, delta)
    // Screenshot clipping uses document coordinates. Wait for the native wheel
    // animation to finish so its scroll offset cannot move during capture.
    // This checks painted content after scrolling; geometry above also checks docking.
    await page.evaluate(async () => {
      let previous = scrollY, stable = 0
      for (let frame = 0; frame < 120; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        stable = scrollY === previous ? stable + 1 : 0
        previous = scrollY
        if (stable >= 4) return
      }
      throw new Error('Document scrolling did not settle before screenshot')
    })
    const current = await geometry()
    const clip = {
      x: Math.floor(current.sectionLeft), y: Math.ceil(current.bottom) + 2,
      width: Math.ceil(current.sectionRight) - Math.floor(current.sectionLeft),
      height: current.viewport - Math.ceil(current.bottom) - 2,
    }
    // Use the emulated viewport, not the native Chrome window surface: on
    // macOS CDP can return only 713px of an 800px viewport during scrolling.
    // Read the strip from a full viewport image, never a document-relative clip.
    const band = await page.screenshot({ scale: 'css' })
    const strayPixels = await page.evaluate(async ({ encoded, clip }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${encoded}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const scale = image.width / 1200
      if (image.height < (clip.y + clip.height) * scale) throw new Error(`Incomplete viewport screenshot: ${image.width}×${image.height}`)
      const pixels = context.getImageData(clip.x * scale, clip.y * scale, clip.width * scale, clip.height * scale).data
      let stray = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 244 || pixels[i + 1] !== 247 || pixels[i + 2] !== 249) stray++
      }
      return stray
    }, { encoded: band.toString('base64'), clip })
    if (strayPixels) {
      await info.attach(`footer-band-${delta}`, { body: band, contentType: 'image/png' })
      console.info('FOOTER_BAND', JSON.stringify({ delta, current, after: await geometry() }))
    }
    expect(strayPixels, `Table pixels below the footer after wheel ${delta}`).toBe(0)
  }
  await page.screenshot({ path: info.outputPath('sticky-documents.png') })
  await page.getByRole('tab', { name: 'Формирование', exact: true }).click()
  await expect(page.locator('.document-grid-bottom-cover')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Открыть на весь экран', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть на весь экран', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Закрыть полноэкранный просмотр', exact: true })).toBeVisible()
  const sheetViewport = page.locator('[data-template-preview-viewport]')
  await expect(sheetViewport).toBeVisible()
  const zoomButton = page.getByTitle('Вписать лист по ширине', { exact: true })
  const initialZoom = await zoomButton.textContent()
  await sheetViewport.hover()
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
  await expect(zoomButton).not.toHaveText(initialZoom!)
  await page.getByRole('button', { name: 'Уменьшить масштаб', exact: true }).click()
  await zoomButton.click()
  await expect(sheetViewport).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Открыть на весь экран', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Формирование', exact: true })).toHaveAttribute('aria-selected', 'true')
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
  await page.keyboard.press('Escape')
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
      await page.getByRole('menuitem', { name: /Сгруппировать по «Линия»/ }).click()
      await page.locator('[data-welding-journal-grid] .ag-row-group .ag-group-contracted').click()
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
        await expect(modal.getByLabel('Лист документа')).toHaveValue('0')
      } else {
        expect((await downloadPreviewExcel(page, modal)).text).toContain('F125')
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
  const card = page.locator('[data-testid="line-program-card"], [data-testid="line-program-detail"]')
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

test('reopening gets fresh data/template; closing and reopening during loading ignores the old result', async ({ page }) => {
  await page.goto('/documents')
  const row = await documentGridRow(page, manualTitle), title = row.titleCell.getByRole('button', { name: manualTitle, exact: true })
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа' })
  await row.checkbox.check(); await title.click()
  const first = await downloadPreviewExcel(page, modal)
  expect(first.text).toContain('F001')
  await page.keyboard.press('Escape')
  await withE2eDatabase(db => db.query("update weld_joints set joint='F999' where project_title=$1 and joint='F001'", [project]))
  await title.click()
  await expect(modal.getByRole('button', { name: 'Далее', exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(modal.frameLocator('iframe').getByText('F999', { exact: true })).toBeVisible()
  const changed = await downloadPreviewExcel(page, modal)
  expect(changed.text).toContain('F999'); expect(changed.text).not.toContain('F001')
  await page.keyboard.press('Escape')
  const template = XLSX.read((await store.get(fileKey))!, { type: 'array', cellStyles: true })
  template.Sheets.Бланк.A1.v = 'Обновлённый бланк документа'
  await store.set(fileKey, XLSX.write(template, { type: 'array', bookType: 'xlsx', cellStyles: true }))
  await title.click()
  expect(await previewSheetText(modal)).toContain('Обновлённый бланк документа')
  const revised = await downloadPreviewExcel(page, modal)
  expect(revised.text).toContain('Обновлённый бланк документа'); expect(revised.text).toContain('F999')
  await page.keyboard.press('Escape')
  let waiting = false, delivered = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (waiting || !rpcName(route.request().url()).startsWith('getRemoteGeneratedDocumentRows')) return route.continue()
    const response = await route.fetch()
    waiting = true
    await gate
    await route.fulfill({ response }).catch(() => {})
    delivered = true
  })
  await title.click(); await expect.poll(() => waiting).toBe(true)
  await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
  await withE2eDatabase(db => db.query("update weld_joints set joint='F998' where project_title=$1 and joint='F999'", [project]))
  await title.click()
  await expect(modal.getByRole('button', { name: 'Далее', exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(modal.frameLocator('iframe').getByText('F998', { exact: true })).toBeVisible()
  release()
  await expect.poll(() => delivered).toBe(true)
  await expect(modal.frameLocator('iframe').getByText('F999', { exact: true })).toHaveCount(0)
  expect((await downloadPreviewExcel(page, modal)).text).toContain('F998')
  await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
  await expect(row.titleCell).toBeFocused(); await expect(row.checkbox).toBeChecked()
})

test('document opening: bounded SQL/RPC for 1 and 125 joints, precise page readiness and repeated cleanup', async ({ page }, info) => {
  await withE2eDatabase(db => db.query('update weld_joints set line=$1 where project_title=$2', ['OPENING-COUNT', project]))
  const calls: string[] = [], errors: string[] = [], workers: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  page.on('worker', worker => { if (worker.url().includes('pdf.worker')) workers.push(worker.url()) })
  await page.goto('/documents')
  const row = await documentGridRow(page, manualTitle)
  const title = row.titleCell.getByRole('button', { name: manualTitle, exact: true })
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа' })
  const measurements: { joints: number; firstPageMs: number; sql?: number; requests: string[] }[] = []
  for (const joints of [1, 125, 125, 125]) {
    await withE2eDatabase(async db => {
      await db.query('delete from generated_document_weld_joints where document_id=(select id from generated_documents where title=$1)', [manualTitle])
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        select (select id from generated_documents where title=$1),w.id from weld_joints w where w.project_title=$2 order by w.id limit $3`, [manualTitle, project, joints])
    })
    const sqlBefore = await auditSqlCount(), before = calls.length
    // Record inside the browser on animation frames, independently of Playwright's assertion polling.
    await page.evaluate(() => {
      const state = { start: performance.now(), firstPageMs: 0 }
      ;(window as typeof window & { sheetOpening: typeof state }).sheetOpening = state
      const check = () => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-sheet-preview] iframe')
        if (frame?.contentDocument?.querySelector('[data-document-preview-page]')?.textContent?.includes('Шаблон — готовый документ')) {
          requestAnimationFrame(() => { state.firstPageMs = performance.now() - state.start })
        } else if (performance.now() - state.start < 40000) requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
    await title.click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { sheetOpening: { firstPageMs: number } }).sheetOpening.firstPageMs), { timeout: 40000 }).toBeGreaterThan(0)
    const firstPageMs = await page.evaluate(() => (window as typeof window & { sheetOpening: { firstPageMs: number } }).sheetOpening.firstPageMs)
    const sqlAfter = await auditSqlCount(), requests = calls.slice(before)
    expect(requests.filter(name => name.startsWith('getRemoteGeneratedDocumentRows'))).toHaveLength(1)
    expect(requests.filter(name => name.startsWith('getRemoteDocumentTemplate'))).toHaveLength(1)
    const file = await downloadPreviewExcel(page, modal)
    expect(file.text).toContain('F001')
    if (joints === 125) expect(file.text).toContain('F125')
    measurements.push({ joints, firstPageMs: Math.round(firstPageMs), sql: sqlAfter === undefined || sqlBefore === undefined ? undefined : sqlAfter - sqlBefore, requests })
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()
    await expect(page.locator('[data-sheet-preview] iframe')).toHaveCount(0)
  }
  if (measurements[0].sql !== undefined) {
    expect(Math.max(...measurements.map(item => item.sql!))).toBeLessThanOrEqual(20)
    expect(measurements[1].sql!).toBeLessThanOrEqual(measurements[0].sql! + 2)
  }
  expect(workers).toHaveLength(0); expect(errors).toEqual([])
  console.log('DOCUMENT_OPENING_AUDIT', JSON.stringify(measurements))
  await info.attach('document-opening-audit', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})

test('oversized documents keep paged viewing and complete Excel without starting PDF', async ({ page }) => {
  const original = await store.get(fileKey)
  const book = XLSX.read(original!, { type: 'array' })
  book.Sheets.Бланк.A1002 = { t: 's', v: 'Конец большого документа' }; book.Sheets.Бланк['!ref'] = 'A1:C1002'
  await store.set(fileKey, XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
  const pdfCalls: string[] = []
  page.on('request', request => { if (request.url().includes('/api/document-preview')) pdfCalls.push(request.url()) })
  await page.goto('/documents')
  const row = await documentGridRow(page, manualTitle)
  await row.titleCell.getByRole('button', { name: manualTitle, exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа' })
  await expect(modal.frameLocator('iframe').getByText('Шаблон — готовый документ')).toBeVisible()
  await expect(modal.getByRole('button', { name: /Вид для печати|Скачать PDF|Печать PDF/ })).toHaveCount(0)
  const pending = page.waitForEvent('download'); await modal.getByRole('button', { name: 'Скачать Excel' }).click()
  const full = XLSX.read(await readFile((await (await pending).path())!), { type: 'buffer' })
  expect(Object.values(full.Sheets.Бланк).some(cell => (cell as { v?: string }).v === 'Конец большого документа')).toBe(true)
  expect(pdfCalls).toEqual([])
  await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
})

test('fast sheet: zoom, scrolling, resize, keyboard and Excel stay local without PDF', async ({ page }, info) => {
  const calls: string[] = [], pdfCalls: string[] = [], workers: string[] = [], errors: string[] = []
  page.on('request', request => {
    if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url()))
    if (request.url().includes('/api/document-preview')) pdfCalls.push(request.method())
  })
  page.on('worker', worker => { if (worker.url().includes('pdf.worker')) workers.push(worker.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  const row = await documentGridRow(page, manualTitle)
  const before = calls.length
  await row.titleCell.getByRole('button', { name: manualTitle, exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Предпросмотр документа' }), frame = modal.frameLocator('iframe')
  await expect(frame.getByText('Шаблон — готовый документ')).toBeVisible()
  expect(pdfCalls).toEqual([]); expect(workers).toEqual([])
  await modal.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(frame.getByText('F125', { exact: true })).toBeVisible()
  await modal.getByLabel('Лист документа').selectOption('1')
  await expect(frame.getByText('Подписи — конец документа')).toBeVisible()
  await modal.getByLabel('Лист документа').selectOption('0')
  const zoom = modal.getByLabel('Масштаб листа')
  await zoom.selectOption('100')
  const box = (await modal.locator('iframe').boundingBox())!
  await page.mouse.move(box.x + 150, box.y + 100)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => modal.locator('iframe').evaluate((element: HTMLIFrameElement) => element.contentWindow!.scrollY)).toBeGreaterThan(0)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control')
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(100)
  const afterWheel = Number(await zoom.inputValue())
  await frame.locator('body').evaluate(element => {
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.2], ['gestureend', 1.2]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { scale, clientX: 300, clientY: 300 }); element.dispatchEvent(event)
    }
  })
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(afterWheel)
  await zoom.selectOption('auto')
  for (const width of [1920, 1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = (await modal.boundingBox())!
    expect(bounds.width).toBeLessThanOrEqual(width >= 768 ? Math.min(1440, width * .92) + 1 : width - 30)
    await expect(modal.getByRole('button', { name: 'Закрыть предпросмотр' })).toBeInViewport()
    await expect(modal.getByRole('button', { name: 'Скачать Excel' })).toBeInViewport()
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await modal.screenshot({ path: info.outputPath('fast-sheet.png') })
  await frame.locator('body').click()
  await page.keyboard.press('Control+p')
  await expect(modal.getByRole('button', { name: 'Скачать Excel' })).toBeFocused()
  expect((await downloadPreviewExcel(page, modal)).text).toContain('F125')
  expect(calls.slice(before).filter(name => name.startsWith('getRemoteGeneratedDocumentRows'))).toHaveLength(1)
  expect(calls.slice(before).filter(name => name.startsWith('getRemoteDocumentTemplate'))).toHaveLength(1)
  expect(pdfCalls).toEqual([]); expect(workers).toEqual([])
  await expect(modal.getByRole('button', { name: /Вид для печати|Скачать PDF|Печать PDF/ })).toHaveCount(0)
  await frame.locator('body').click()
  await page.keyboard.press('Escape'); await expect(modal).toBeHidden()
  expect(errors).toEqual([])
})
