import { expect, test, type Locator, type Page } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E assignment grid refresh', line = 'ASSIGNMENT-REFRESH'
test.afterEach(() => cleanupLineProgramProjects([project]))
test.beforeEach(async ({ page }) => {
  await withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,'REFRESH',$2,'II','A',100,100) returning id`, [project, line])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,
      officiality,revision_actuality,connection_type,stamp_1_k,has_vik,vik_result,has_rk)
      select $1,$2,'REFRESH',$3,'F'||n,'2026-09-01','действующий','актуальная',
        case when n=4 then 'С17' else 'У19' end,'REFRESH-A','да','годен',
        case when n<3 then 'да' when n=3 then 'дополнительный' else 'отменен' end
      from generate_series(1,4) n`, [program.id, project, line])
  })
  await page.setViewportSize({ width: 1800, height: 1050 })
  await page.goto('/line-program')
  await expect(page.getByLabel('Итоги раздела')).toBeVisible()
  await page.getByLabel('Поиск программы линий').fill(line)
  await page.getByTestId('line-program-card').getByRole('button', { name: 'Учитываемых соединений 4', exact: true }).click()
  await openEditor(page)
})

async function openEditor(page: Page) {
  await page.getByTestId('line-program-detail').getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeVisible()
  return editor
}
async function openFilter(page: Page, editor: Locator, column: string) {
  await editor.getByRole('columnheader', { name: column, exact: true }).locator('.ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await expect(filter).toBeVisible()
  return filter
}
async function cancelDraft(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await page.getByRole('dialog', { name: 'Отменить изменения назначений?', exact: true }).getByRole('button', { name: 'Отменить изменения', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Отменить изменения', exact: true })).toHaveCount(0)
}
const jointOrder = (editor: Locator) => editor.getByTestId('line-program-joint').evaluateAll(rows =>
  rows.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
    .map(row => row.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')?.replace('Выбрать ', '')))

test('assignment edits and cancellation update an active method filter and another filter’s available values', async ({ page }) => {
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true }).check()
  const rk = await openFilter(page, editor, 'РК')
  await rk.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await rk.getByRole('checkbox', { name: 'Да', exact: true }).check()
  await rk.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect.poll(() => jointOrder(editor)).toEqual(['F1', 'F2'])
  // Exercise an already initialised filter handler as well as the active one.
  const joints = await openFilter(page, editor, 'Стык')
  await expect(joints.getByRole('checkbox', { name: 'F1', exact: true })).toBeVisible()
  await expect(joints.getByRole('checkbox', { name: 'F2', exact: true })).toBeVisible()
  await joints.press('Escape')
  await editor.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('дополнительный')
  await expect.poll(() => jointOrder(editor)).toEqual(['F2'])
  await openFilter(page, editor, 'Стык')
  await expect(joints.getByRole('checkbox', { name: 'F1', exact: true })).toHaveCount(0)
  await expect(joints.getByRole('checkbox', { name: 'F2', exact: true })).toBeVisible()
  await joints.press('Escape')
  await cancelDraft(page, editor)
  await expect.poll(() => jointOrder(editor)).toEqual(['F1', 'F2'])
  await expect(editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })).toBeChecked()
  await expect(editor.getByRole('combobox', { name: 'F1 · РК', exact: true })).toHaveValue('да')
  await expect(editor.getByRole('columnheader', { name: 'РК', exact: true })).toHaveClass(/ag-header-cell-filtered/)
  await openFilter(page, editor, 'Стык')
  await expect(joints.getByRole('checkbox', { name: 'F1', exact: true })).toBeVisible()
})

test('method sorting follows draft changes and cancellation in both directions without losing selection', async ({ page }) => {
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  const checkbox = editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })
  await checkbox.check()
  for (const ascending of [true, false]) {
    await editor.getByRole('columnheader', { name: 'РК', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: ascending ? 'По возрастанию' : 'По убыванию', exact: true }).click()
    const relativePosition = async () => { const order = await jointOrder(editor); return order.indexOf('F1') - order.indexOf('F3') }
    await expect.poll(async () => Math.sign(await relativePosition())).toBe(ascending ? -1 : 1)
    await editor.getByRole('combobox', { name: 'F1 · РК', exact: true }).selectOption('отменен')
    await expect.poll(async () => Math.sign(await relativePosition())).toBe(ascending ? 1 : -1)
    await expect(checkbox).toBeChecked()
    await cancelDraft(page, editor)
    await expect.poll(async () => Math.sign(await relativePosition())).toBe(ascending ? -1 : 1)
    await expect(checkbox).toBeChecked()
    await expect(editor.getByRole('combobox', { name: 'F1 · РК', exact: true })).toHaveValue('да')
  }
})

test('linked layered/PVK draft keeps keyboard focus, selection, history height and current availability', async ({ page }) => {
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  const checkbox = editor.getByRole('checkbox', { name: 'Выбрать F1', exact: true })
  const row = editor.getByTestId('line-program-joint').filter({ has: page.getByRole('checkbox', { name: 'Выбрать F1', exact: true }) })
  await row.locator('summary').click()
  await expect(row.locator('details')).toHaveAttribute('open', '')
  await checkbox.focus()
  await checkbox.press('Space')
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeFocused()
  await expect(row.locator('details')).toHaveAttribute('open', '')
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const height = (await row.boundingBox())!.height
  const layered = editor.getByRole('combobox', { name: 'F1 · Послойный ПВК', exact: true })
  const pvk = editor.getByRole('combobox', { name: 'F1 · ПВК', exact: true })
  await layered.focus()
  await layered.selectOption('да')
  await expect(layered).toHaveValue('да')
  await expect(layered).toBeFocused()
  await expect(pvk).toHaveValue('да')
  await expect(pvk.getByRole('option', { name: 'Отменен', exact: true })).toBeDisabled()
  await expect(row.locator('details')).toHaveAttribute('open', '')
  await expect.poll(async () => Math.abs((await row.boundingBox())!.height - height)).toBeLessThan(1)
  await layered.press('Shift+Tab')
  await expect(pvk).toBeFocused()
  await editor.getByRole('button', { name: 'Вернуться к просмотру', exact: true }).click()
  await openEditor(page)
  await expect(layered).toHaveValue('да')
  await expect(pvk).toHaveValue('да')
  await expect(checkbox).toBeChecked()
  await cancelDraft(page, editor)
  await expect(layered).toHaveValue('')
  await expect(pvk).toHaveValue('')
  await expect(pvk.getByRole('option', { name: 'Отменен', exact: true })).toBeEnabled()
  await expect(checkbox).toBeChecked()
})

test('fresh server rows refresh metadata and history while joint and result values stay unchanged', async ({ page }) => {
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  const row = editor.getByTestId('line-program-joint').filter({ has: page.getByRole('checkbox', { name: 'Выбрать F1', exact: true }) })
  const weldDate = row.getByTestId('program-joint-metadata').locator('time')
  await expect(weldDate).toHaveAttribute('datetime', '2026-09-01')
  await row.locator('summary').click()
  const originalSummary = await row.locator('summary').innerText()
  const vikResult = row.getByText('ВИК: годен', { exact: true })
  await expect(vikResult).toBeVisible()
  await expect(vikResult).not.toHaveAttribute('title', /REFRESH-VIK-NEW/)

  // Model committed external changes to the same loaded row. Keep its AG
  // identity, assignment values and result cell value unchanged. The normal
  // save on another row then invalidates/refetches the mounted line editor.
  await withLineProgramFixture(async db => {
    const result = await db.query(`update weld_joints set weld_date='2026-09-02',
      vik_request='REFRESH-VIK-NEW' where project_title=$1 and line=$2 and joint='F1'
      returning joint, has_rk, vik_result`, [project, line])
    expect(result.rows).toEqual([{ joint: 'F1', has_rk: 'да', vik_result: 'годен' }])
  })
  await editor.getByRole('combobox', { name: 'F2 · РК', exact: true }).selectOption('дополнительный')
  await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Сохранить назначения', exact: true })).toBeVisible()
  const acknowledgement = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
  if (await acknowledgement.count()) await acknowledgement.check()
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 1', { exact: true })).toBeVisible()

  // Do not reopen the modal or reload: that would mask the stale renderer.
  await expect(weldDate).toHaveAttribute('datetime', '2026-09-02')
  await expect(weldDate).toHaveText('02.09.2026')
  await expect(row.locator('summary')).toHaveText(originalSummary)
  await expect(row.locator('details')).toHaveAttribute('open', '')
  await expect(vikResult).toHaveAttribute('title', /Заявка: REFRESH-VIK-NEW/)
  await expect(editor.getByRole('combobox', { name: 'F1 · РК', exact: true })).toHaveValue('да')
  await expect(editor.getByRole('combobox', { name: 'F2 · РК', exact: true })).toHaveValue('дополнительный')
})
