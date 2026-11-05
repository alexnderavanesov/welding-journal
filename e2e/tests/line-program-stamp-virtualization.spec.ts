import { expect, test, type Locator, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E program virtual stamps'
const line = 'STAMP-WINDOW'
test.use({ actionTimeout: 15000 })
test.afterEach(() => cleanupLineProgramProjects([project]))

async function prepare(page: Page) {
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'STAMP-WINDOW',$2,'II','Б(а)',10,10) returning id`, [project, line])
    await db.query(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,stamp_1_z,stamp_1_o,has_vik,vik_result,psto_required)
      select $1,$2,'STAMP-WINDOW',$3,'F'||(s*1000+n),'2026-10-01','С17','действующий','актуальная',
      'РД','М01',108,108,4,4,'II','Б(а)',10,10,'V'||lpad(s::text,3,'0'),'V'||lpad(s::text,3,'0'),
      'V'||lpad(s::text,3,'0'),'да','годен','нет'
      from generate_series(0,179) s cross join lateral generate_series(1,case when s=0 then 120 else 2 end) n`,
    [program.id, project, line])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where line_program_id=$1`, [program.id])
  })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий', { exact: true }).fill(line)
  await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
  const grid = page.locator('[data-program-grid="stamps"]')
  await expect(grid).toHaveAttribute('data-program-row-count', '180')
  await expect(page.getByRole('button', { name: 'Клеймо V000', exact: true })).toBeVisible()
  return grid
}

async function filterValue(page: Page, column: Locator, value: string) {
  await column.locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('textbox').fill(value)
  await filter.getByRole('checkbox', { name: new RegExp(`^${value}\\s*$`) }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
}

test('large stamp lists render a bounded window and keep native End/Home navigation', async ({ page }) => {
  test.setTimeout(90000)
  const grid = await prepare(page)
  expect(await grid.getByTestId('line-program-stamp').count()).toBeLessThan(60)
  await expect(page.getByRole('button', { name: 'Клеймо V179', exact: true })).toHaveCount(0)
  await expect(grid.locator('.ag-grid-viewport').first()).toHaveCSS('overflow-y', 'hidden')
  const first = page.getByRole('button', { name: 'Клеймо V000', exact: true })
  await first.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ag-cell ")]').focus()
  await page.keyboard.press('End')
  const last = page.getByRole('button', { name: 'Клеймо V179', exact: true })
  await expect(last).toBeInViewport()
  await expect.poll(() => last.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(72)
  expect(await grid.getByTestId('line-program-stamp').count()).toBeLessThan(60)
  await page.keyboard.press('Home')
  await expect(first).toBeInViewport()
})

test('explicit far-stamp reveal clears only conflicting filters and retains history, nested filters and draft', async ({ page }) => {
  test.setTimeout(120000)
  const grid = await prepare(page)
  const stampColumn = grid.locator('.ag-header-cell[col-id="stamp"]').first()
  const countColumn = grid.locator('.ag-header-cell[col-id="count"]').first()
  await filterValue(page, countColumn, '2')
  await filterValue(page, stampColumn, 'V001')
  await expect(grid.getByTestId('line-program-stamp')).toHaveCount(1)
  await page.getByTestId('program-scope-actions').getByRole('button', { name: 'Расчёт линии', exact: true }).click()
  const calculation = page.getByRole('dialog', { name: `Расчёт · ${line}`, exact: true })
  await calculation.getByRole('combobox', { name: 'Клеймо в расчёте', exact: true }).selectOption('V179')
  await calculation.getByTestId('demand-common').getByRole('button').first().click()
  await calculation.getByLabel('Состав расчёта РК/УЗК', { exact: true }).selectOption('physical')
  await calculation.getByRole('button', { name: 'Показать стыки в рабочей таблице', exact: true }).click()
  await expect(calculation).toHaveCount(0)
  const workspace = page.getByRole('region', { name: `Стыки клейма V179 · ${line}`, exact: true })
  await expect(workspace).toBeFocused()
  await expect(workspace.getByRole('button', { name: 'F179001', exact: true })).toBeInViewport()
  await expect(stampColumn).not.toHaveClass(/ag-header-cell-filtered/)
  await expect(countColumn).toHaveClass(/ag-header-cell-filtered/)
  await expect(page.getByRole('button', { name: 'Клеймо V179', exact: true })).toHaveAttribute('aria-expanded', 'true')

  await workspace.getByRole('button', { name: 'F179001', exact: true }).click()
  await expect(workspace.locator('.program-joint-history')).toBeVisible()
  await filterValue(page, workspace.locator('.ag-header-cell[col-id="joint"]').first(), 'F179001')
  const assignments = page.getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения клейма V179/ })
  await assignments.click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await editor.getByLabel('F179001 · РК', { exact: true }).selectOption('да')
  await editor.getByRole('button', { name: 'Закрыть назначения', exact: true }).click()
  await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  await page.getByRole('button', { name: 'По клеймам', exact: true }).click()
  await expect(workspace.locator('.program-joint-history')).toBeVisible()
  await expect(workspace.locator('.ag-header-cell[col-id="joint"]').first()).toHaveClass(/ag-header-cell-filtered/)
  await expect(countColumn).toHaveClass(/ag-header-cell-filtered/)
  await assignments.click()
  await expect(editor.getByLabel('F179001 · РК', { exact: true })).toHaveValue('да')
  await editor.getByRole('button', { name: 'Закрыть назначения', exact: true }).click()
})

test('dispatcher navigation mounts the requested far stamp without a calculation-dialog reveal token', async ({ page }) => {
  test.setTimeout(120000)
  await prepare(page)
  // Two joints at 10% round to zero; 50% creates a real missing-control task
  // for the final stamp instead of relying on an invented dispatcher fixture.
  await withLineProgramFixture(async db => {
    await db.query('update line_programs set weld_control_percent=50,pvk_control_percent=50 where project_title=$1', [project])
    await db.query('update weld_joints set weld_control_percent=50,pvk_control_percent=50 where project_title=$1', [project])
  })
  await page.goto('/journal')
  await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер', exact: true }).click()
  const dispatcher = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
  const search = dispatcher.getByRole('textbox', { name: 'Поиск задач диспетчера', exact: true })
  await search.fill('V179')
  await search.press('Enter')
  await dispatcher.getByRole('button', { name: 'Назначить контроль', exact: true }).first().click()
  await expect(page).toHaveURL(/\/line-program$/)
  const workspace = page.getByRole('region', { name: `Стыки клейма V179 · ${line}`, exact: true })
  await expect(workspace).toBeFocused()
  await expect(workspace.getByRole('button', { name: 'F179001', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Клеймо V179', exact: true })).toHaveAttribute('aria-expanded', 'true')
  expect(await page.locator('[data-program-grid="stamps"]').getByTestId('line-program-stamp').count()).toBeLessThan(60)
})

test('nested joint navigation has one scroll owner and closing returns focus to its virtual master', async ({ page }) => {
  test.setTimeout(90000)
  await prepare(page)
  const master = page.getByRole('button', { name: 'Клеймо V000', exact: true })
  await master.click()
  const workspace = page.getByRole('region', { name: `Стыки клейма V000 · ${line}`, exact: true })
  const joints = workspace.locator('[data-program-grid="joints"]')
  await expect(joints).toHaveAttribute('data-program-row-count', '120')
  await workspace.getByRole('button', { name: 'F1', exact: true }).click()
  const history = workspace.locator('.program-joint-history')
  await expect(history).toBeVisible()
  // Clear the outer grid's focused master before navigating the inner grid;
  // AG deliberately retains a focused row even outside its virtual window.
  await page.locator('[data-program-grid="stamps"] .ag-header-cell[col-id="stamp"]').first().focus()
  await workspace.locator('[data-joint="F1"] .ag-cell[col-id="joint"]').focus()
  await page.keyboard.press('PageDown')
  await page.keyboard.press('End')
  const last = workspace.getByRole('button', { name: 'F120', exact: true })
  await expect(last).toBeInViewport()
  await expect.poll(() => last.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(72)
  await expect(master).toHaveCount(0)
  // The same scope menu is available by keyboard on the workspace, even when
  // the stamp's own disclosure button has left the rendered window.
  await workspace.evaluate(element => element.focus({ preventScroll: true }))
  await page.keyboard.press('Shift+F10')
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Свернуть', exact: true }).click()
  await expect(master).toHaveAttribute('aria-expanded', 'false')
  await expect(master).toBeFocused()
  const stampHeader = page.locator('[data-program-grid="stamps"] .ag-header-cell[col-id="stamp"]').first()
  await expect(stampHeader).toHaveCSS('visibility', 'visible')
  await expect.poll(() => stampHeader.locator('.ag-header-cell-resize').evaluate(element => {
    const box = element.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('.ag-header-cell-resize') === element
  })).toBe(true)
  await master.click()
  await expect(history).toBeVisible()
  // Reopening may restore the previous reading position inside the branch;
  // the virtual master can legitimately leave the rendered window again.
  await expect(joints).toBeInViewport()
})
