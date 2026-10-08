import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E LNK result policy'
const line = 'LNK-POLICY-L1'

test.afterEach(() => cleanupLineProgramProjects([project]))

for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 720 }]) {
  test(`ЛНК: выбор, пояснение СП-07 и запрет сохранения не двигают список (${viewport.width})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await seed([{ joint: 'F909', diameter: 57, method: 'ВИК' }])
    const dialog = await openResults(page, 'F909', 'vikRequest')
    const checkbox = dialog.getByRole('checkbox', { name: `Выбрать стык ${line} F909`, exact: true })
    await checkbox.uncheck()
    const controls = dialog.locator('[data-lnk-result-controls]')
    const tabs = dialog.getByRole('tablist', { name: 'Разделы результата ЛНК' })
    const footer = dialog.getByRole('group', { name: 'Сохранение результата', exact: true })
    const save = footer.getByRole('button', { name: 'Сохранить результат', exact: true })
    const targets = [dialog, controls, tabs, footer, save, checkbox, checkbox.locator('..')]
    const before = await Promise.all(targets.map(target => target.boundingBox()))
    const warning = footer.locator(':scope > div').first()
    const warningBox = await warning.boundingBox(), saveBox = await save.boundingBox()
    if (viewport.width >= 1280) expect(Math.abs((warningBox!.y + warningBox!.height / 2) - (saveBox!.y + saveBox!.height / 2))).toBeLessThan(2)
    else expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(saveBox!.y)
    await page.screenshot({ path: `/private/tmp/welding-lnk-footer-short-${viewport.width}.png` })
    for (const selected of [true, false, true]) {
      await checkbox.setChecked(selected)
      if (selected) {
        await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
        await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
        await expect(save).toBeEnabled()
        await checkReason(page, dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }), 'вырез', ['По ВИК'])
      } else await expect(save).toBeDisabled()
      await expect.poll(async () => Promise.all(targets.map(target => target.boundingBox()))).toEqual(before)
      await expect(checkbox).toBeInViewport()
    }
    await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-08-31')
    await expect(save).toBeDisabled()
    await expect.poll(async () => Promise.all(targets.map(target => target.boundingBox()))).toEqual(before)
    await expect(footer.getByRole('button', { name: 'Исправить дату заключения ВИК', exact: true })).toBeInViewport()
    await page.screenshot({ path: `/private/tmp/welding-lnk-stable-${viewport.width}.png` })
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(await withE2eDatabase(async db => (await db.query('select vik_result from weld_joints where project_title=$1', [project])).rows[0].vik_result)).toBe('ожидает НК')
  })
}

test('ВИК малого диаметра: ручной ремонт, hover/focus запрета выреза и сохранение результата', async ({ page }) => {
  await seed([{ joint: 'F905', diameter: 57, method: 'ВИК' }])
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = await openResults(page, 'F905', 'vikRequest')
  const common = dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true })
  const row = dialog.getByRole('checkbox', { name: `Выбрать стык ${line} F905`, exact: true }).locator('..')
  await expect(row.getByRole('button', { name: 'ремонт', exact: true })).toBeEnabled()
  for (const option of ['годен', 'ремонт', 'вырез']) {
    await expect(common.getByRole('button', { name: option, exact: true })).toHaveAttribute('aria-pressed', 'false')
  }
  await checkReason(page, row, 'вырез', ['По ВИК результат «вырез» не допускается.'])
  await checkReason(page, common, 'вырез', ['По ВИК результат «вырез» не допускается.'])
  const rule = dialog.getByRole('link', { name: 'Подробнее о правиле СП-07', exact: true }).first()
  await expect(rule).toHaveAttribute('href', '/settings#system-rule-lnk-results')
  const popupPromise = page.waitForEvent('popup')
  await rule.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(/\/settings#system-rule-lnk-results$/)
  await popup.close()
  await expect(dialog).toBeVisible()
  await common.getByRole('button', { name: 'ремонт', exact: true }).click()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => withE2eDatabase(async (db) => (await db.query(
    'select vik_result from weld_joints where project_title=$1 and joint=$2', [project, 'F905'],
  )).rows[0]?.vik_result)).toBe('ремонт')

  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
  await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill('F905')
  await expect(manager.getByRole('group', { name: 'Изменить на:', exact: true }).getByRole('button', { name: 'ремонт', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await checkReason(page, manager.getByRole('group', { name: 'Изменить на:', exact: true }), 'вырез', ['По ВИК результат «вырез» не допускается.'])
  expect(errors).toEqual([])
  await page.close()
})

test('РК: все причины выбранных стыков, смена выбора без автозамены и ограничения дубля', async ({ page }) => {
  await seed([
    { joint: 'F906', diameter: 57, method: 'РК' },
    { joint: 'F907R2', diameter: 89, method: 'РК' },
    { joint: 'F908', diameter: 89, method: 'РК' },
  ])
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = await openResults(page, 'F906', 'rkRequest')
  await dialog.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(line)
  for (const joint of ['F907R2', 'F908']) {
    await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} ${joint}`, exact: true }).check()
  }
  const common = dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true })
  await checkReason(page, common, 'ремонт', ['меньше 89 мм', 'два ремонта'])
  await expect(common.getByRole('button', { name: 'вырез', exact: true })).toBeEnabled()
  for (const joint of ['F906', 'F907R2']) {
    await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} ${joint}`, exact: true }).uncheck()
  }
  await expect(common.getByRole('button', { name: 'ремонт', exact: true })).toBeEnabled()
  await expect(common.getByRole('button', { name: 'годен', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await common.getByRole('button', { name: 'ремонт', exact: true }).click()
  await expect(common.getByRole('button', { name: 'ремонт', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const duplicate = page.getByRole('dialog')
  await duplicate.getByRole('button', { name: 'Снять выбор', exact: true }).click()
  await duplicate.getByPlaceholder('Проект, шифр, линия, спул или стык').fill(line)
  await expect(duplicate.getByText('Найдено: 3 · Выбрано: 0', { exact: true })).toBeVisible()
  await duplicate.getByRole('button', { name: 'Выбрать найденные', exact: true }).click()
  await expect(duplicate.getByText('Найдено: 3 · Выбрано: 3', { exact: true })).toBeVisible()
  await duplicate.getByRole('button', { name: 'ВИК', exact: true }).click()
  await duplicate.getByRole('button', { name: 'РК', exact: true }).click()
  const picker = duplicate.getByRole('group', { name: 'Результат', exact: true })
  await checkReason(page, picker, 'ремонт', ['меньше 89 мм', 'два ремонта'])
  await checkReason(page, picker, 'вырез', ['По ВИК результат «вырез» не допускается.'])
  await expect(picker.getByRole('button', { name: 'годен', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
  await page.close()
})

async function checkReason(page: Page, picker: Locator, result: string, reasons: string[]) {
  const button = picker.getByRole('button', { name: result, exact: true })
  const trigger = picker.getByRole('group', { name: result, exact: true })
  await expect(button).toBeDisabled()
  // Hover the disabled button itself, as the operator does, rather than forcing a DOM event.
  await button.hover()
  for (const reason of reasons) await expect(page.getByRole('tooltip')).toContainText(reason)
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  for (const reason of reasons) await expect(page.getByRole('tooltip')).toContainText(reason)
  await page.keyboard.press('Enter')
  await expect(button).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await expect(picker).toBeVisible()
}

async function openResults(page: Page, joint: string, methodKey: string) {
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
  await page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
  await dialog.getByLabel('Метод контроля', { exact: true }).selectOption(methodKey)
  await dialog.getByRole('checkbox', { name: `Выбрать стык ${line} ${joint}`, exact: true }).check()
  return dialog
}

async function seed(records: { joint: string; diameter: number; method: 'ВИК' | 'РК' }[]) {
  await withE2eDatabase(async (db) => {
    for (const record of records) {
      await db.query(`insert into weld_joints (
        project_title,subtitle_code,line,joint,weld_date,officiality,revision_actuality,
        connection_type,material_group,welding_method,d1,d2,t1,t2,wdi,stamp_1_k,stamp_1_k_fact,
        has_vik,vik_control_basis,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        has_rk,rk_control_basis,rk_request,rk_request_date,rk_result,psto_required,final_status,
        welding_updated_at,lnk_created_at,lnk_updated_at
      ) values ($1,'POLICY',$2,$3,'2026-09-01','действующий','актуальная',
        'С17','M01','РД',159,$4,4,4,0.42,'POLICY-K','POLICY-K',
        'да','проект','POLICY-VIK','2026-09-02',$5,$6,$7,
        $8,'проект',$9,$10,$11,'нет','ожидает НК',now(),now(),now())`,
      [project, line, record.joint, record.diameter,
        record.method === 'ВИК' ? 'ожидает НК' : 'годен', record.method === 'ВИК' ? null : 'POLICY-VIK-C', record.method === 'ВИК' ? null : '2026-09-02',
        record.method === 'РК' ? 'да' : 'нет', record.method === 'РК' ? 'POLICY-RK' : null, record.method === 'РК' ? '2026-09-02' : null, record.method === 'РК' ? 'ожидает НК' : null])
    }
    await db.query('update dispatcher_task_index_state set source_revision=source_revision+1, full_rebuild=true')
  })
}
