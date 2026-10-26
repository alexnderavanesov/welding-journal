import { expect, test, type Locator, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E statistics AG Grid'
const otherProject = 'ZZ E2E statistics scope'

async function filterValue(page: Page, grid: Locator, column: string, value: string) {
  await grid.locator(`.ag-header-cell[col-id="${column}"] .ag-header-cell-filter-button`).click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await expect(filter.getByRole('textbox')).toHaveCSS('height', '32px')
  await expect(filter.getByRole('textbox')).toHaveCSS('font-size', '12px')
  for (const button of await filter.getByRole('button').all()) {
    await expect.poll(() => button.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight &&
        element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
  }
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('textbox').fill(value)
  await filter.getByRole('checkbox', { name: value, exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
}

async function resetFilter(page: Page, grid: Locator, column: string) {
  await grid.locator(`.ag-header-cell[col-id="${column}"] .ag-header-cell-filter-button`).click()
  await page.locator('.ag-filter').filter({ visible: true }).getByRole('button', { name: 'Сбросить', exact: true }).click()
  await page.keyboard.press('Escape')
}

test('statistics and import: large lists, preserved details and bounded rendering', async ({ page }, info) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  const errors: string[] = [], calls: string[] = []
  const observations: Record<string, unknown> = {}
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('AG Grid')) errors.push(message.text()) })
  page.on('request', r => { if (r.url().includes('/_serverFn/')) calls.push(rpcName(r.url())) })
  try {
    await withE2eDatabase(async db => {
      await db.query(`insert into weld_joints
        (project_title,subtitle_code,line,joint,weld_date,connection_type,material_group,stamp_1_k_fact,has_vik,vik_result,wdi)
        select $1,'GRID','L'||lpad(n::text,4,'0'),'F1',date '2026-09-01' + (n%5),
        'С17','М01','G'||lpad(((n+1)/2)::text,4,'0'),'да','ожидает заявку','10.1234567'
        from generate_series(1,2000) n`, [project])
      await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type)
        values ($1,'OTHER','Z-OTHER','F1','2026-09-01','С17')`, [otherProject])
      await db.query('delete from derived_calculation_cache')
      await db.query('update derived_calculation_state set source_revision=source_revision+1,updated_at=now() where id=1')
      await db.query('update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,updated_at=now() where id=1')
    })
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Сварщики', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
    await page.getByRole('combobox', { name: 'Период отчета', exact: true }).selectOption('custom')
    await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
    const start = performance.now()
    await page.getByLabel('Период по', { exact: true }).fill('2026-09-30')
    const welders = page.locator('[data-statistics-grid="welders"]')
    await expect(welders.getByText('G0001', { exact: true })).toBeVisible()
    observations.weldersReadyMs = performance.now() - start
    observations.welderDomRows = await welders.locator('.ag-row').count()
    expect(observations.welderDomRows).toBeLessThan(40)
    await welders.getByText('G0001', { exact: true }).click()
    await expect(welders.getByText('Динамика по дням', { exact: true })).toBeVisible()
    await expect(welders.getByText('М01', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: info.outputPath('welder-details.png') })
    {
      await welders.getByText('Динамика по дням', { exact: true }).click()
      await welders.getByText('М01', { exact: true }).first().click()
      await expect(welders.getByText('Динамика по дням', { exact: true })).toBeVisible()
    }
    const beforeScroll = calls.filter(x => x.startsWith('getStatisticsServerResult_')).length
    await page.evaluate(() => window.scrollBy(0, 3000))
    await page.evaluate(() => window.scrollBy(0, -3000))
    expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeScroll)
    {
      const resize = welders.locator('.ag-header-cell[col-id="stamp"] .ag-header-cell-resize')
      const grip = (await resize.boundingBox())!
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await page.mouse.down()
      await page.mouse.move(grip.x + grip.width / 2 + 45, grip.y + grip.height / 2, { steps: 3 })
      await page.mouse.up()
      const width = await welders.locator('.ag-header-cell[col-id="stamp"]').evaluate(element => element.getBoundingClientRect().width)
      const cell = welders.locator('.ag-row[row-id="G0001"] [col-id="total"]')
      await cell.focus()
      await cell.press('PageDown')
      await page.keyboard.press('End')
      await expect(welders.locator('.ag-row[row-id="G1000"] [col-id="defect"]')).toBeFocused()
      await expect(welders.getByText('G1000', { exact: true })).toBeInViewport()
      await page.keyboard.press('Home')
      const first = welders.locator('.ag-row[row-id="G0001"] [col-id="stamp"]')
      await expect(first).toBeFocused()
      await expect.poll(() => first.evaluate(element => element.getBoundingClientRect().top >=
        document.querySelector('[data-statistics-toolbar]')!.getBoundingClientRect().bottom)).toBe(true)
      for (let repeat = 0; repeat < 20; repeat++) {
        await welders.getByRole('button', { name: 'Подробности сварщика G0001', exact: true }).click()
        await expect(welders.getByText('Динамика по дням', { exact: true })).toHaveCount(0)
        await welders.getByRole('button', { name: 'Подробности сварщика G0001', exact: true }).click()
        await expect(welders.getByText('Динамика по дням', { exact: true })).toHaveCount(1)
      }
      expect(await welders.locator('.ag-row').count()).toBeLessThan(40)
      expect(await welders.locator('.ag-header-cell[col-id="stamp"]').evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0)
      await filterValue(page, welders, 'stamp', 'G1000')
      await expect(welders.getByText('G1000', { exact: true })).toBeVisible()
      await expect(welders.getByText('G0001', { exact: true })).toHaveCount(0)
      await resetFilter(page, welders, 'stamp')
      await expect(welders.getByText('Динамика по дням', { exact: true })).toBeVisible()
      expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeScroll)
    }
    // An empty local search must clear totals and output as well as the grid;
    // restoring it must preserve the expanded welder and require no RPC.
    const stampSearch = page.getByPlaceholder('Клеймо НАКС, внутреннее или ФИО')
    await stampSearch.fill('no-such-welder')
    await expect(welders.locator('.ag-row')).toHaveCount(0)
    await expect(page.getByText('Сварщиков в срезе', { exact: true }).locator('..')).toHaveText(/Сварщиков в срезе\s*0/)
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const emptyPreview = page.getByRole('dialog', { name: 'Предпросмотр отчёта', exact: true })
    await expect(emptyPreview.frameLocator('iframe').locator('body')).not.toContainText('G0001')
    const emptyDownload = page.waitForEvent('download')
    await emptyPreview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const emptyFile = await emptyDownload
    const emptyBook = XLSX.read(await readFile((await emptyFile.path())!), { type: 'buffer' })
    const emptyRows = emptyBook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(emptyBook.Sheets[name], { header: 1 }))
    expect(emptyRows.filter(row => /^G\d{4}$/.test(String(row[0])))).toHaveLength(0)
    await emptyPreview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await stampSearch.fill('')
    await expect(welders.getByText('Динамика по дням', { exact: true })).toBeVisible()
    await expect(page.getByText('Сварщиков в срезе', { exact: true }).locator('..')).toHaveText(/Сварщиков в срезе\s*1000/)
    expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeScroll)
    await page.getByRole('button', { name: 'Полинейная сводка', exact: true }).click()
    const lines = page.locator('[data-statistics-grid="lines"]')
    await expect(lines.getByText('L0001', { exact: true })).toBeVisible()
    observations.lineDomRows = await lines.locator('.ag-row').count()
    await expect(lines.getByText('Группа трубопровода', { exact: true })).toBeVisible()
    await expect(lines.getByText('Категория трубопровода', { exact: true })).toBeVisible()
    await expect(lines.getByText('Контроль швов, (%)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Параметры', exact: true })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Проект', exact: true })).toHaveCount(0)
    await expect(page.getByText('Линии с наибольшим остатком', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Поиск по линии, проекту или шифру' })).toHaveCount(0)
    const beforeLineSearch = calls.filter(x => x.startsWith('getStatisticsServerResult_')).length
    // A project selected in the welder tab must not silently restrict lines.
    await filterValue(page, lines, 'projectTitle', otherProject)
    await expect(lines.getByText('Z-OTHER', { exact: true })).toBeVisible()
    await resetFilter(page, lines, 'projectTitle')
    await filterValue(page, lines, 'projectTitle', project)
    await filterValue(page, lines, 'line', 'L2000')
    await expect(lines.getByText('L2000', { exact: true })).toBeVisible()
    await expect(lines.getByText('L0001', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Линий всего', { exact: true }).locator('..')).toContainText('1')
    expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeLineSearch)

    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const preview = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Скачать Excel', exact: true }) })
    const reportDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const reportFile = await reportDownload
    const reportBook = XLSX.read(await readFile((await reportFile.path())!), { type: 'buffer' })
    const exported = reportBook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(reportBook.Sheets[name], { header: 1 }))
    const lineRows = exported.filter(row => row[0] === project)
    expect(lineRows).toHaveLength(1)
    expect(lineRows[0][2]).toBe('L2000')
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    // The next response must keep column filters, and export its new unit/data.
    await page.getByRole('button', { name: 'WDI', exact: true }).click()
    await expect(lines.locator('.ag-cell[col-id="completed"]')).toContainText('10,1 / 10,1')
    await page.setViewportSize({ width: 1100, height: 650 })
    await filterValue(page, lines, 'completed', '10,12')
    await expect(lines.getByText('L2000', { exact: true })).toBeVisible()
    const completionHeader = lines.locator('.ag-header-cell[col-id="completed"]')
    await completionHeader.focus()
    await completionHeader.press('Space')
    const numericFilter = page.locator('.read-only-grid-popup').filter({ visible: true })
    await expect(numericFilter.getByRole('checkbox', { name: '10,12', exact: true })).toBeVisible()
    await expect(numericFilter.getByText(/10[.,]123456/)).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('line-filter-one-row.png') })
    await page.keyboard.press('Escape')
    await expect(completionHeader).toBeFocused()
    await page.setViewportSize({ width: 1600, height: 1000 })
    await resetFilter(page, lines, 'completed')
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const updatedDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const updatedFile = await updatedDownload
    const updatedBook = XLSX.read(await readFile((await updatedFile.path())!), { type: 'buffer' })
    const updatedRows = updatedBook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(updatedBook.Sheets[name], { header: 1 })).filter(row => row[0] === project)
    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0].slice(6)).toEqual([10.1, 10.1, 0])
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    await resetFilter(page, lines, 'line')
    await expect(lines.getByText('L0001', { exact: true })).toBeVisible()
    expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeLineSearch + 1)
    // Header sorting must apply to all exported rows, including unrendered ones.
    const lineHeader = lines.locator('.ag-header-cell[col-id="line"]')
    await lineHeader.locator('.ag-header-cell-text').click()
    await lineHeader.locator('.ag-header-cell-text').click()
    await expect(lineHeader).toHaveAttribute('aria-sort', 'descending')
    await page.getByRole('button', { name: 'Отчет PDF', exact: true }).click()
    const sortedDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Скачать Excel', exact: true }).click()
    const sortedFile = await sortedDownload
    const sortedBook = XLSX.read(await readFile((await sortedFile.path())!), { type: 'buffer' })
    const sortedRows = sortedBook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<unknown[]>(sortedBook.Sheets[name], { header: 1 })).filter(row => row[0] === project)
    expect(sortedRows.map(row => row[2])).toEqual(Array.from({ length: 2000 }, (_, i) => `L${String(2000 - i).padStart(4, '0')}`))
    await preview.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click()
    expect(calls.filter(x => x.startsWith('getStatisticsServerResult_'))).toHaveLength(beforeLineSearch + 1)

    await page.goto('/journal')
    await page.getByRole('button', { name: 'Импорт', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Импорт данных', exact: true }) })
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Скачать шаблон', exact: true }).click()
    const downloaded = await download
    const template = XLSX.read(await readFile((await downloaded.path())!), { type: 'buffer' })
    const headers = (XLSX.utils.sheet_to_json<unknown[]>(template.Sheets[template.SheetNames[0]], { header: 1 })[0]).map(String)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      headers,
      ...Array.from({ length: 500 }, (_, i) => {
        const values: Record<string, string> = { Проект: project, Шифр: 'GRID', Линия: `L${String(i+1).padStart(4,'0')}`, Стык: 'F2', 'Дата сварки': i === 499 ? '31.02.2026' : '01.09.2026' }
        return headers.map(header => values[header] ?? '')
      }),
    ]), 'Импорт')
    await dialog.locator('input[type=file]').setInputFiles({ name: 'grid-preview.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) })
    await expect(dialog.getByText(/найдено: 500/)).toBeVisible()
    const allStart = performance.now()
    await dialog.getByRole('button', { name: 'Все', exact: true }).click()
    await expect(dialog.getByText('Строки: 500/500')).toBeVisible()
    observations.importAllMs = performance.now() - allStart
    observations.importDomRows = await dialog.locator('[data-import-preview-grid] .ag-row').count()
    {
      expect(observations.importDomRows).toBeLessThan(100)
      await dialog.getByRole('button', { name: '50', exact: true }).click()
      await expect(dialog.getByText('Строки: 50/500')).toBeVisible()
      await dialog.getByRole('button', { name: /Строка 501:/ }).click()
      const invalid = dialog.locator('[data-import-preview-grid] [row-id="499"] [col-id="weldDate"]')
      await expect(invalid).toBeVisible()
      await expect(invalid).toHaveClass(/bg-amber-50/)
      await expect(invalid).toBeFocused().catch(async error => {
        console.log('IMPORT_FOCUS', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500)))
        throw error
      })
      await expect(dialog.getByText('Строки: 500/500')).toBeVisible()
      await dialog.getByRole('button', { name: 'Только строки с ошибками · 1', exact: true }).click()
      await expect(dialog.getByText('Показано: 1', { exact: true })).toBeVisible()
      await expect(invalid).toHaveClass(/bg-amber-50/)
    }
    await info.attach('grid-measurements', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    console.log('GRID_MEASUREMENTS', JSON.stringify(observations))
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project, otherProject])
  }
})
