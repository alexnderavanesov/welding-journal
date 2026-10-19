import { expect, test, type Page } from '@playwright/test'
import { deserializeRpcPayload, rpcName } from '../rpc'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E program explicit target'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function prepare(page: Page, similar = false) {
  await withLineProgramFixture(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'TARGET','TARGET-A','II','A',10,10), ($1,'TARGET','TARGET-B','II','A',10,10) returning id`, [project])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,connection_type,stamp_1_k,has_vik)
      values ($1,$2,'TARGET','TARGET-A','F1','2026-09-01','действующий','актуальная','С17','TARGET-STAMP','да')`, [line.id, project])
    if (similar) await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'TARGET','TARGET-A-OTHER','II','A',10,10)`, [project])
  })
  await page.goto('/line-program')
  await page.getByLabel('Поиск программы линий').fill(project)
  await expect(page.getByTestId('line-program-card')).toHaveCount(similar ? 3 : 2)
}

async function selectLine(page: Page, value: string) {
  await page.locator('[data-program-grid="lines"] .ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
  const filter = page.locator('.ag-filter').filter({ visible: true })
  await filter.getByRole('checkbox', { name: 'Выбрать все', exact: true }).uncheck()
  await filter.getByRole('checkbox', { name: value, exact: true }).check()
  await filter.getByRole('button', { name: 'Применить', exact: true }).click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
}

test('created line is revealed despite a previous column filter; ordinary disclosure keeps that filter', async ({ page }) => {
  await prepare(page)
  await selectLine(page, 'TARGET-A')
  const expand = page.getByRole('button', { name: 'Расчёт линии TARGET-A', exact: true })
  await expand.click(); await expand.click()
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Новая линия', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Новая линия', exact: true })
  await editor.getByLabel('Проект', { exact: true }).fill(project)
  await editor.getByLabel('Шифр', { exact: true }).fill('TARGET')
  await editor.getByLabel('Линия', { exact: true }).fill('TARGET-C')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByLabel('Поиск программы линий')).toHaveValue('TARGET-C')
  await expect(page.getByRole('button', { name: 'Расчёт линии TARGET-C', exact: true })).toBeVisible()
  await expect(page.getByTestId('line-program-detail').getByRole('heading', { name: 'TARGET-C', exact: true })).toBeVisible()
})

test('saving settings preserves a matching column filter even when the top search matches another line', async ({ page }) => {
  await prepare(page, true)
  await selectLine(page, 'TARGET-A')
  await page.getByTestId('line-program-card').getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Категория', { exact: true }).fill('I')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByLabel('Поиск программы линий')).toHaveValue('TARGET-A')
  await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 2', exact: true })).toBeVisible()
  await expect(page.getByTestId('line-program-card')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Расчёт линии TARGET-A', exact: true })).toBeVisible()
  await expect(page.locator('[data-program-grid="lines"] .ag-header-cell[col-id="line"]')).toHaveClass(/ag-header-cell-filtered/)
})

test('renamed line is revealed despite a previous column value; keyboard menu restores focus through assignments', async ({ page }) => {
  await prepare(page)
  await selectLine(page, 'TARGET-A')
  await page.getByRole('button', { name: 'Расчёт линии TARGET-A', exact: true }).click()
  await page.getByRole('button', { name: 'Все стыки линии', exact: true }).click()
  const joint = page.getByRole('button', { name: 'F1', exact: true })
  await joint.press('Shift+F10')
  const assignments = page.getByRole('button', { name: 'Перейти к назначениям стыка', exact: true })
  await expect(assignments).toBeFocused()
  await assignments.press('Escape')
  await expect(joint).toBeFocused()
  await joint.press('Shift+F10')
  await assignments.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Назначения · TARGET-A', exact: true })
  await expect(dialog.getByRole('button', { name: 'Закрыть назначения', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(joint).toBeFocused()

  await page.getByTestId('line-program-card').getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Линия', { exact: true }).fill('TARGET-RENAMED')
  await editor.getByRole('button', { name: 'Сохранить программу' }).click()
  await page.getByRole('button', { name: 'Изменить всю линию', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByLabel('Поиск программы линий')).toHaveValue('TARGET-RENAMED')
  await expect(page.getByRole('button', { name: 'Расчёт линии TARGET-RENAMED', exact: true })).toBeVisible()
  await expect(page.getByTestId('line-program-detail').getByRole('heading', { name: 'TARGET-RENAMED', exact: true })).toBeVisible()
})

test('a manual filter reset during post-save loading is not replaced by the old snapshot', async ({ page }) => {
  await prepare(page, true)
  await selectLine(page, 'TARGET-A')
  await page.getByTestId('line-program-card').getByRole('button', { name: 'Настроить', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Настройка линии', exact: true })
  await editor.getByLabel('Категория', { exact: true }).fill('I')
  let release!: () => void, held = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    const request = route.request(), payload = new URL(request.url()).searchParams.get('payload') ?? request.postData()
    const search = /getLineProgram(Page|Section)_/.test(rpcName(request.url())) && payload
      ? (deserializeRpcPayload(payload) as { data?: { search?: string } }).data?.search : undefined
    if (search === 'target-a') {
      held = true
      await gate
    }
    await route.continue()
  })
  try {
    await editor.getByRole('button', { name: 'Сохранить программу' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => held).toBe(true)
    await page.locator('[data-program-grid="lines"] .ag-header-cell[col-id="line"] .ag-header-cell-filter-button').click()
    const filter = page.locator('.ag-filter').filter({ visible: true })
    await filter.getByRole('button', { name: 'Сбросить', exact: true }).click()
    release()
    await expect(page.getByLabel('Итоги раздела').getByRole('button', { name: 'Линий 2', exact: true })).toBeVisible()
    await expect(page.getByTestId('line-program-card')).toHaveCount(2)
    await expect(page.locator('[data-program-grid="lines"] .ag-header-cell[col-id="line"]')).not.toHaveClass(/ag-header-cell-filtered/)
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
