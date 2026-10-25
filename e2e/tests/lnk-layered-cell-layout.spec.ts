import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { WELD_FIELDS } from '../../src/lib/weld-fields'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { lnkRow, revealLnkColumn } from './lnk-grid-helpers'

const project = 'E2E layered cell layout'
const joint = 'F9527'
const fields = ['line', 'joint', 'layeredVikDocuments', 'layeredPvkDocuments', 'wdi', 'weldDate', 'finalStatus']

test.beforeAll(async () => {
  await withLineProgramFixture(db => db.query(`insert into weld_joints (
    project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
    has_vik,has_pvk,layered_control_assigned,vik_result,pvk_result,
    vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,
    pvk_request,pvk_request_date,pvk_conclusion,pvk_conclusion_date
  ) values ($1,'LAYOUT','LAYOUT-L',$2,'2026-09-01','У17','действующий','актуальная',
    'да','да',true,'годен','годен','LAYOUT-V','2026-09-02','LAYOUT-VC','2026-09-03',
    'LAYOUT-P','2026-09-02','LAYOUT-PC','2026-09-03')`, [project, joint]))
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})
test.afterAll(() => cleanupLineProgramProjects([project]))

test('ЛНК: ссылки кромок и слоев целиком видны и открываются при каждой плотности и переносе', async ({ page }, info) => {
  await page.addInitScript(({ fields, hidden }) => {
    localStorage.setItem('lnk-ag-grid:v1', JSON.stringify({
      columns: fields.map(colId => ({ colId, width: 184, pinned: ['line', 'joint'].includes(colId) ? 'left' : null })),
      appearance: { density: 'compact', wrapText: false },
    }))
    localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys: hidden, customHiddenFieldKeys: hidden, collapsedSections: [], savedViews: [],
    }))
  }, { fields, hidden: WELD_FIELDS.filter(field => !fields.includes(field.key)).map(field => field.key) })
  await page.goto('/lnk')
  await page.getByRole('searchbox').fill(project)
  await expect(page.getByText('Найдено: 1', { exact: true })).toBeVisible()

  for (const [density, label] of [['compact', 'Компактно'], ['comfortable', 'Комфортно'], ['spacious', 'Просторно']]) {
    for (const wrap of [false, true]) {
      await page.getByRole('button', { name: 'Настроить вид', exact: true }).click()
      await page.getByRole('tab', { name: 'Оформление', exact: true }).click()
      await page.getByRole('combobox', { name: 'Плотность строк', exact: true }).click()
      await page.getByRole('option', { name: new RegExp(`^${label}`) }).click()
      const wrapSwitch = page.getByRole('switch', { name: 'Перенос текста', exact: true })
      if ((await wrapSwitch.getAttribute('aria-checked') === 'true') !== wrap) await wrapSwitch.click()
      await page.getByRole('button', { name: 'Закрыть настройки вида' }).click()
      for (const field of ['layeredVikDocuments', 'layeredPvkDocuments']) {
        await revealLnkColumn(page, field)
        const cell = lnkRow(page, joint).locator(`[col-id="${field}"]`)
        await expect(cell.getByRole('button')).toHaveText(['Кромки', 'Слои'])
        // Visibility alone misses this regression: the buttons exist but their
        // fixed line height is cropped inside the compact cell.
        await expect.poll(() => cell.evaluate(element => {
          const cellBox = element.getBoundingClientRect()
          return [...element.querySelectorAll('button')].every(button => {
            const box = button.getBoundingClientRect()
            return box.top >= cellBox.top && box.bottom <= cellBox.bottom &&
              box.left >= cellBox.left && box.right <= cellBox.right &&
              button.clientHeight >= parseFloat(getComputedStyle(button).lineHeight) &&
              button.scrollWidth <= button.clientWidth
          })
        }), `${field}, ${density}, wrap=${wrap}: links must not be clipped`).toBe(true)
        if (density === 'compact' && !wrap) {
          await cell.screenshot({ path: info.outputPath(`${field}-compact.png`) })
          for (const name of ['Кромки', 'Слои']) {
            await cell.getByRole('button', { name, exact: true }).click()
            const preview = page.getByRole('dialog', { name: 'Предпросмотр документа', exact: true })
            await expect(preview).toBeVisible()
            await expect(preview.getByRole('alert')).toBeVisible()
            await page.keyboard.press('Escape')
            await expect(preview).toBeHidden()
          }
        }
      }
    }
  }
})
