import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { eq } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { weldJoints } from '../../src/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '../../src/server/system-document-index'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E document officiality layout'

test.beforeEach(async () => {
  await withE2eDatabase(async db => {
    const rows = await db.query(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,officiality,has_vik,vik_request,vik_request_date,vik_result,final_status)
      select $1,'LAYOUT','UI-LINE','F' || (800 + n), '2026-09-01'::date,
        case when n=30 then 'неофициальный' end,'да','UI-VIK-' || n,'2026-09-02'::date,
        case when n=30 then 'ожидает НК' else 'ремонт' end,
        case when n=30 then 'ожидает НК' else 'не годен' end
      from generate_series(1,30) as n returning id`, [project])
    for (const [index, row] of rows.rows.slice(0, 3).entries()) {
      const doc = await db.query(`insert into generated_documents (type,title,file_name,mime_type,row_count)
        values ('weldingJournal',$1,'layout.xlsx','application/octet-stream',1) returning id`, [`UI-JSR-${index}`])
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [doc.rows[0].id, row.id])
    }
  })
  // SQL fixture insertion bypasses the save workflow; index it explicitly even
  // when another scenario has already initialized the document registry.
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, project))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
})

test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
})

test('меню столбцов поверх кнопок; закрепленные действия принимают фон строки', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/documents')
  for (const view of ['ЖСР', 'Заявка ЛНК']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    const grid = page.locator('[data-document-history-grid]')
    const actions = grid.locator('[data-document-row-actions]')
    await expect(actions.first()).toBeVisible()
    for (let index = 0; index < 2; index++) {
      const cell = actions.nth(index)
      const rowId = await cell.evaluate(element => element.closest('.ag-row')!.getAttribute('row-id'))
      const row = grid.locator(`.ag-row[row-id="${rowId}"]`)
      const checkbox = grid.locator(`.ag-row[row-id="${rowId}"]`).getByRole('checkbox')
      const colorLayers = () => cell.evaluate(element => {
        const row = element.closest('.ag-row')!
        const pinnedCells = element.closest('.ag-grid-pinned-right-cells')
        const scrollingCells = row.querySelector('.ag-grid-scrolling-cells')
        const pinnedWrapper = element.closest('.ag-grid-container-wrapper')
        if (!pinnedCells || !scrollingCells || !pinnedWrapper) return { matches: false, missingNativeLayer: true }
        const color = (target: Element, pseudo: string | null = null) => {
          const style = getComputedStyle(target, pseudo)
          return { background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity }
        }
        const customLayers = []
        for (let current: Element | null = element; current && current !== pinnedWrapper; current = current.parentElement) {
          customLayers.push({ className: current.className, ...color(current) })
        }
        const rowBase = color(row), wrapperBase = color(pinnedWrapper)
        const pinnedOverlays = ['::before', '::after'].map(pseudo => color(pinnedCells, pseudo))
        const scrollingOverlays = ['::before', '::after'].map(pseudo => color(scrollingCells, pseudo))
        // AG 36 paints scrolling cells through their parent row, while the
        // pinned native wrapper inherits that same opaque row background.
        // Only the application/individual cell layers must be transparent.
        const matches = customLayers.every(layer => ['transparent', 'rgba(0, 0, 0, 0)'].includes(layer.background) && layer.image === 'none')
          && wrapperBase.background === rowBase.background && wrapperBase.image === rowBase.image
          && wrapperBase.opacity === rowBase.opacity
          && JSON.stringify(pinnedOverlays) === JSON.stringify(scrollingOverlays)
        return { matches, rowBase, wrapperBase, pinnedBase: color(pinnedCells), scrollingBase: color(scrollingCells), customLayers, pinnedOverlays, scrollingOverlays }
      })
      const assertMatchingColor = async (state: string) => {
        try { await expect.poll(async () => (await colorLayers()).matches).toBe(true) }
        catch (error) {
          await info.attach(`document-row-colors-${view}-${index}-${state}`, { body: JSON.stringify(await colorLayers(), null, 2), contentType: 'application/json' })
          throw error
        }
      }
      await assertMatchingColor('normal')
      await row.hover()
      await assertMatchingColor('hover')
      await checkbox.check()
      await assertMatchingColor('selected')
    }
    await grid.getByRole('button', { name: 'Настроить вид', exact: true }).click()
    const menu = page.getByRole('dialog', { name: 'Настройка вида документов' })
    await expect(menu).toBeInViewport()
    // Check actual browser hit-testing, not merely the numeric z-index.
    expect(await menu.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return [0.25, 0.5, 0.85].every(fraction => element.contains(document.elementFromPoint(rect.right - 35, rect.top + rect.height * fraction)))
    })).toBe(true)
    await menu.getByRole('checkbox', { name: 'Проект', exact: true }).click()
    await expect(menu).toBeVisible()
    await page.screenshot({ path: `/private/tmp/welding-columns-${view === 'ЖСР' ? 'manual' : 'system'}.png` })
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(grid.getByRole('button', { name: 'Настроить вид', exact: true })).toBeFocused()
  }
})

test('официальность: нижние счетчики и последняя строка доступны прокруткой, кнопки не обрезаны', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }) })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(project)
  await expect(dialog.getByText('Найдено: 30 · Выбрано: 0', { exact: true })).toBeVisible()
  const settings = dialog.getByRole('region', { name: 'Параметры официальности' })
  const rows = dialog.getByRole('region', { name: 'Стыки для изменения официальности' })
  await settings.hover()
  await page.mouse.wheel(0, 1200)
  await expect(dialog.getByText('Не годные официальные', { exact: true })).toBeInViewport()
  const viewport = rows.locator('.overflow-auto')
  await viewport.hover()
  await page.mouse.wheel(0, 6000)
  await expect(dialog.getByText('UI-LINE · F830', { exact: true })).toBeInViewport()
  await expect(dialog.getByText('Неофициальный стык без негодного результата. Проверьте историю и официальность.')).toBeInViewport()
  await expect(rows.getByText('1-30', { exact: true })).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Сохранить официальность', exact: true })).toBeInViewport()
  await page.screenshot({ path: '/private/tmp/welding-officiality-scroll.png' })
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill('F830')
  await expect(dialog.getByText('Найдено: 1 · Выбрано: 0', { exact: true })).toBeVisible()
  await rows.getByRole('button', { name: /UI-LINE · F830/ }).click()
  await settings.getByRole('button', { name: /^Официальный/ }).click()
  await expect(dialog.getByRole('button', { name: 'Сохранить официальность', exact: true })).toBeEnabled()
  await expect(settings.getByRole('button', { name: /^Неофициальный/ })).toBeDisabled()
  for (const viewport of [{ width: 1000, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(async () => {
      const left = await settings.boundingBox(), right = await rows.boundingBox()
      return !!left && !!right && left.y + left.height <= right.y
    }).toBe(true)
    await dialog.locator('[data-officiality-workspace]').hover()
    await page.mouse.wheel(0, 1600)
    await expect(rows.getByText('1-1', { exact: true })).toBeInViewport()
    // Resizing can retain the inner list's scroll offset; its top must remain reachable too.
    await rows.locator('.overflow-auto').hover()
    await page.mouse.wheel(0, -1600)
    await expect(dialog.getByText('UI-LINE · F830', { exact: true })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Сохранить официальность', exact: true })).toBeInViewport()
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `/private/tmp/welding-officiality-${viewport.width}.png` })
  }
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  const stored = await withE2eDatabase(async db => (await db.query('select officiality,vik_result from weld_joints where project_title=$1 and joint=$2', [project, 'F830'])).rows[0])
  expect(stored).toEqual({ officiality: 'неофициальный', vik_result: 'ожидает НК' })
})
