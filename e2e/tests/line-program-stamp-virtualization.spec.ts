import { expect, test, type Locator, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E program virtual stamps'
const line = 'STAMP-WINDOW'
test.use({ actionTimeout: 15000 })
test.afterEach(() => cleanupLineProgramProjects([project]))

async function prepare(page: Page, options: { stamps?: number; firstBranchJoints?: number; otherBranchJoints?: number } = {}) {
  const { stamps = 180, firstBranchJoints = 120, otherBranchJoints = 2 } = options
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs
      (project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'STAMP-WINDOW',$2,'II','Б(а)',10,10) returning id`, [project, line])
    await db.query(`insert into weld_joints
      (line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
      welding_method,material_group,d1,d2,t1,t2,category,group_name,weld_control_percent,pvk_control_percent,
      stamp_1_k,stamp_1_z,has_vik,vik_result,psto_required)
      select $1,$2,'STAMP-WINDOW',$3,'F'||(s*1000+n),'2026-10-01','С17','действующий','актуальная',
      'РД','М01',108,108,4,4,'II','Б(а)',10,10,'V'||lpad(s::text,3,'0'),'V'||lpad(s::text,3,'0'),'да','годен','нет'
      from generate_series(0,$4::integer-1) s cross join lateral generate_series(1,case when s=0 then $5::integer else $6::integer end) n`,
    [program.id, project, line, stamps, firstBranchJoints, otherBranchJoints])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from weld_joints where line_program_id=$1`, [program.id])
  })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий', { exact: true }).fill(line)
  await page.getByRole('button', { name: `Расчёт линии ${line}`, exact: true }).click()
  const grid = page.locator('[data-program-grid="stamps"]')
  await expect(grid).toHaveAttribute('data-program-row-count', String(stamps))
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
  // Two joints require at least one control even at 10%. Use 50% here so the
  // missing-control task also follows directly from the unrounded quota.
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

test('joint-picture quota action opens all line joints and highlights the selected joint, not the task representative', async ({ page }) => {
  test.setTimeout(120000)
  await prepare(page, { stamps: 1, firstBranchJoints: 2 })
  await withLineProgramFixture(async db => {
    await db.query('update line_programs set weld_control_percent=50,pvk_control_percent=50 where project_title=$1', [project])
    await db.query('update weld_joints set weld_control_percent=50,pvk_control_percent=50 where project_title=$1', [project])
  })
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await page.getByRole('button', { name: 'F2', exact: true }).click({ button: 'right' })
  await page.getByTestId('context-action-menu').getByRole('button', { name: 'Картина стыка', exact: true }).click()
  const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F2', exact: true }) })
  await picture.getByRole('tab', { name: /^Картина линии/ }).click()
  // The quota covers V000 and uses its first joint, F1, as its stored
  // representative. The picture must retain the explicitly chosen F2.
  const quota = picture.getByRole('region', { name: 'СП-01 Назначить контроль по процентной линии', exact: true })
  const quotaToggle = quota.locator('button[aria-expanded]').first()
  await expect(quotaToggle).toBeVisible()
  if (await quotaToggle.getAttribute('aria-expanded') !== 'true') await quotaToggle.click()
  await quota.getByRole('button', { name: 'Назначить контроль', exact: true }).click()
  await expect(page).toHaveURL(/\/line-program$/)
  const program = page.getByTestId('line-program')
  await expect(program.getByRole('button', { name: 'Все стыки линии', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const selected = program.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: 'F2', exact: true }) })
  await expect(selected).toHaveAttribute('data-highlighted', 'true')
  await expect(selected).toBeInViewport()
  await expect(page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })).not.toBeVisible()
  await expect(page.getByRole('region', { name: `Стыки клейма V000 · ${line}`, exact: true })).not.toBeVisible()
  expect(errors).toEqual([])
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

test('retained branches preserve their extent, reading position and history when density changes in another tab', async ({ page }, info) => {
  test.setTimeout(120000)
  await prepare(page, { stamps: 3, firstBranchJoints: 100, otherBranchJoints: 100 })
  const workspaces: Locator[] = []
  for (let index = 0; index < 3; index++) {
    const stamp = `V${String(index).padStart(3, '0')}`
    await page.getByRole('button', { name: `Клеймо ${stamp}`, exact: true }).click()
    const workspace = page.getByRole('region', { name: `Стыки клейма ${stamp} · ${line}`, exact: true })
    workspaces.push(workspace)
    await expect(workspace.locator('[data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', '100')
    if (index === 0) {
      await workspace.getByRole('button', { name: 'F1', exact: true }).click()
      await expect(workspace.locator('.program-joint-history')).toBeVisible()
    }
    await expect(page.locator('[data-program-motion]')).toHaveCount(0)
    // Reach the following master through document scrolling, as a reader does;
    // the preceding branch stays expanded, with its own filters/history intact.
    if (index < 2) await workspace.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().bottom + window.scrollY - 150))
  }
  const first = workspaces[0], third = workspaces[2]
  const firstGrid = first.locator('[data-program-grid="joints"]')
  const thirdGrid = third.locator('[data-program-grid="joints"]')
  await expect(firstGrid).toHaveAttribute('data-program-density', 'comfortable')
  await thirdGrid.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 500))
  await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
  await expect.poll(() => firstGrid.evaluate(element => element.getBoundingClientRect().bottom < -window.innerHeight)).toBe(true)
  const firstHeight = await firstGrid.evaluate(element => element.getBoundingClientRect().height)

  let settingsPage: Page | undefined
  try {
    await page.mouse.move(1000, 600)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 90)
      await page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
    }
    expect(await firstGrid.evaluate(element => element.getBoundingClientRect().height)).toBe(firstHeight)

    const reading = await thirdGrid.evaluate(element => {
      const headerBottom = element.querySelector('.ag-grid-pinned-top-rows')!.getBoundingClientRect().bottom
      const row = [...element.querySelectorAll<HTMLElement>('[data-joint]')].find(candidate => {
        const box = candidate.getBoundingClientRect()
        return box.top <= headerBottom + 2 && box.bottom > headerBottom + 2
      })!
      return { joint: row.dataset.joint!, top: row.getBoundingClientRect().top, pageY: window.scrollY,
        gridTop: element.getBoundingClientRect().top, viewportTop: element.querySelector('.ag-grid-viewport')!.scrollTop }
    })
    const readingRow = third.locator(`[data-joint="${reading.joint}"]`)
    await expect(readingRow).toBeInViewport()

    // Appearance changes in another window are a real model/height update for
    // retained offscreen grids. Keep this reader's tab and position untouched.
    settingsPage = await page.context().newPage()
    await settingsPage.goto('/line-program')
    await settingsPage.getByRole('button', { name: 'Настроить вид программы линий', exact: true }).click()
    const panel = settingsPage.getByRole('dialog', { name: 'Вид программы линий', exact: true })
    await panel.getByRole('tab', { name: 'Оформление', exact: true }).click()
    await panel.getByRole('combobox', { name: 'Плотность таблиц' }).click()
    await panel.getByRole('option', { name: /Просторно/ }).click()
    await page.bringToFront()
    await expect(firstGrid).toHaveAttribute('data-program-density', 'spacious')
    await expect.poll(() => firstGrid.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(firstHeight + 300)
    // Nested auto-height observers finish in later frames. Check the settled
    // position, not an intermediate frame that still happens to match.
    await page.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
    await info.attach('density-position', { contentType: 'application/json', body: JSON.stringify({ before: reading,
      after: await thirdGrid.evaluate(element => ({ pageY: window.scrollY, gridTop: element.getBoundingClientRect().top,
        viewportTop: element.querySelector('.ag-grid-viewport')!.scrollTop,
        rows: [...element.querySelectorAll<HTMLElement>('[data-joint]')].map(row => ({ joint: row.dataset.joint, top: row.getBoundingClientRect().top })) })) }) })
    await expect(readingRow).toBeInViewport()
    // A new row density may change the clipping within one row, but must not
    // send the reader to another branch or lose the current joint.
    await expect.poll(() => readingRow.evaluate((element, top) => Math.abs(element.getBoundingClientRect().top - top), reading.top)).toBeLessThan(70)

    const returnOffset = await thirdGrid.evaluate(element => element.querySelector('.ag-grid-viewport')!.scrollTop)
    await firstGrid.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 80))
    await expect(first.getByRole('button', { name: 'F1', exact: true })).toBeInViewport()
    await expect(first.locator('.program-joint-history')).toBeVisible()
    // A detail created after the density change must still measure itself;
    // retaining an existing height must not freeze newly opened histories.
    await first.getByRole('button', { name: 'F2', exact: true }).click()
    await expect(first.getByLabel('История контроля F2', { exact: true })).toBeVisible()
    await expect(first.locator('[data-program-motion]')).toHaveCount(0)
    await expect.poll(() => first.getByLabel('История контроля F2', { exact: true }).evaluate(element => {
      const row = element.closest('.ag-row.ag-full-width-row')!
      return row.getBoundingClientRect().height - element.getBoundingClientRect().height
    })).toBeGreaterThanOrEqual(-1)
    await first.getByRole('button', { name: 'F2', exact: true }).click()
    await expect(first.getByLabel('История контроля F2', { exact: true })).not.toBeVisible()
    await expect(first.getByLabel('История контроля F1', { exact: true })).toBeVisible()
    await thirdGrid.evaluate((element, offset) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + offset - 36), returnOffset)
    await expect(readingRow).toBeInViewport()
    await expect(thirdGrid).toHaveAttribute('data-program-row-count', '100')
    // Let the page-scroll adapter finish the manual return before capturing
    // the reading position for the independent reverse density change.
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
    const spaciousTop = await readingRow.evaluate(element => element.getBoundingClientRect().top)
    await settingsPage.getByRole('button', { name: 'Вернуть исходное оформление', exact: true }).click()
    await page.bringToFront()
    await expect(firstGrid).toHaveAttribute('data-program-density', 'comfortable')
    await page.evaluate(async () => { for (let i = 0; i < 16; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
    await expect(readingRow).toBeInViewport()
    await expect.poll(() => readingRow.evaluate((element, top) => Math.abs(element.getBoundingClientRect().top - top), spaciousTop)).toBeLessThan(70)
    await page.screenshot({ path: info.outputPath('density-reading-position.png') })
  } finally {
    if (settingsPage && !settingsPage.isClosed()) {
      await settingsPage.getByRole('button', { name: 'Вернуть исходное оформление', exact: true }).click({ timeout: 3000 }).catch(() => {})
      await settingsPage.close()
    }
  }
})
