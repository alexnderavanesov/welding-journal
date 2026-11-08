import { expect, test, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'

const project = 'E2E report return freshness'
const search = (page: Page) => page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true })
const frame = (page: Page) => page.locator('[data-weld-report-grid] .journal-grid-frame')
const navigate = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы программы' }).getByRole('button', { name, exact: true }).click()

async function revealColumn(page: Page, field: string) {
  const viewport = page.locator('[data-weld-report-grid] .ag-grid-viewport')
  const header = page.locator(`[data-weld-report-grid] .ag-header-cell[col-id="${field}"]`)
  await viewport.evaluate(async element => {
    element.scrollLeft = 0
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const steps = await viewport.evaluate(element => Math.ceil(element.scrollWidth / Math.max(100, element.clientWidth / 2)) + 1)
  for (let step = 0; step < steps && !await header.count(); step++) {
    await viewport.evaluate(async element => {
      element.scrollLeft += Math.max(100, element.clientWidth / 2)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
  }
  await header.scrollIntoViewIfNeeded()
  return header
}

test.afterEach(() => cleanupLineProgramProjects([project]))

for (const [path, name, report] of [
  ['/journal', 'Сварочный журнал', 'weldingJournal'],
  ['/lnk', 'ЛНК', 'lnk'],
  ['/psto', 'ПСТО и ТВМТ', 'heatTreatment'],
] as const) test(`${report}: returning after another window saves loads fresh flat, grouped and empty results automatically`, async ({ page, browser }, info) => {
  test.setTimeout(120000)
  const ids = await withLineProgramFixture(async db => (await db.query(`
    insert into weld_joints(project_title,subtitle_code,line,joint,isometry,connection_type,weld_date,officiality,revision_actuality,psto_required,has_vik)
    values($1,'RETURN','RETURN-L','F991001','BEFORE','С17','2026-10-01','действующий','актуальная','да','да'),
          ($1,'RETURN','RETURN-L','F991002','BEFORE','С17','2026-10-01','действующий','актуальная','да','да') returning id`, [project])).rows.map(row => row.id as number))
  const writerContext = await browser.newContext({ storageState: process.env.E2E_AUTH_STATE, baseURL: info.project.use.baseURL, viewport: { width: 1600, height: 1000 } })
  const writer = await writerContext.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  writer.on('pageerror', error => errors.push(error.message))
  try {
    await writer.goto('/journal')
    await search(writer).fill(project)
    await expect(writer.getByText('Найдено: 2', { exact: true })).toBeVisible()
    const save = async (value: string) => {
      await writer.bringToFront()
      await editJournalJoint(writer, ids[1])
      const dialog = writer.getByRole('dialog').filter({ has: writer.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
      await dialog.getByLabel('Изометрия', { exact: true }).fill(value)
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(frame(writer)).toHaveAttribute('aria-busy', 'false')
      expect(await withE2eDatabase(async db => (await db.query('select isometry from weld_joints where id=$1', [ids[1]])).rows[0].isometry)).toBe(value)
    }
    const leave = async () => {
      await navigate(page, 'Документы')
      await expect(frame(page)).toHaveCount(0)
    }
    const returnToReport = async () => {
      await page.bringToFront()
      await navigate(page, name)
      await expect(page.locator(`[data-weld-report-grid="${report}"] .journal-grid-frame`)).toHaveAttribute('aria-busy', 'false')
      await expect(page.getByRole('button', { name: 'Обновить таблицу', exact: true })).toBeHidden()
    }

    await page.goto(path)
    await search(page).fill(project)
    await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
    const jointHeader = await revealColumn(page, 'joint')
    await jointHeader.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'По убыванию', exact: true }).click()
    await expect(jointHeader).toHaveAttribute('aria-sort', 'descending')

    for (const grouped of [false, true]) {
      if (grouped) {
        await (await revealColumn(page, 'line')).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Сгруппировать.*Линия/ }).click()
        await page.getByRole('button', { name: 'Развернуть группу RETURN-L', exact: true }).click()
        await expect(page.getByRole('button', { name: 'F991002', exact: true })).toBeVisible()
      }
      await leave()
      const value = `FRESH-${report}-${grouped ? 'GROUP' : 'FLAT'}`
      await save(value)
      await returnToReport()
      await expect(search(page)).toHaveValue(project)
      await expect(page.getByText('Найдено: 2', { exact: true })).toBeVisible()
      if (grouped) {
        const expand = page.getByRole('button', { name: 'Развернуть группу RETURN-L', exact: true })
        if (await expand.isVisible()) await expand.click()
        await expect(page.getByRole('button', { name: 'Свернуть группу RETURN-L', exact: true })).toBeVisible()
      }
      await expect(await revealColumn(page, 'joint')).toHaveAttribute('aria-sort', 'descending')
      const row = page.locator(`[data-weld-report-grid] .ag-row[row-id="${ids[1]}"]`)
      await expect(row).toHaveAttribute('row-index', grouped ? '1' : '0')
      await revealColumn(page, 'isometry')
      await expect(row.locator('[col-id="isometry"]')).toHaveText(value)
    }

    // A retained filter can legitimately become empty. Its old count and rows
    // must disappear automatically, without confusing emptiness with a failure.
    await search(page).fill(`FRESH-${report}-GROUP`)
    await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()
    await leave()
    await save(`NO-LONGER-MATCHES-${report}`)
    await returnToReport()
    await expect(search(page)).toHaveValue(`FRESH-${report}-GROUP`)
    await expect(page.getByText('Найдено: 0', { exact: true })).toBeVisible()
    await expect(frame(page).locator('.ag-row[row-id]')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await writerContext.close() }
})
