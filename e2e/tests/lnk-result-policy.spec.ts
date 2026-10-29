import { lnkRow as lnkGridRow } from './lnk-grid-helpers'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E LNK result policy'
const line = 'LNK-POLICY-L1'

test.afterEach(async ({ page }) => {
  await page.close()
  await cleanupLineProgramProjects([project])
})

test('обязательные реквизиты, нейтральное сохранение и повтор без потери черновика', async ({ page }) => {
  await seed([{ joint: 'F910', diameter: 159, method: 'ВИК' }])
  const dialog = await openResults(page, 'F910', 'vikRequest')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'ремонт', exact: true }).click()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('')
  await dialog.getByRole('tab', { name: /Заключения и имена/ }).click()
  await dialog.getByRole('button', { name: 'Пользовательское', exact: true }).click()
  const name = dialog.getByRole('textbox', { name: /^Название заключения:/ })
  await name.fill('   ')
  await name.blur()
  const footer = dialog.getByRole('group', { name: 'Сохранение результата', exact: true })
  const save = footer.getByRole('button', { name: 'Сохранить результат', exact: true })
  await expect(save).toBeDisabled()
  await expect(footer).toContainText('дату контроля')
  await expect(footer).toContainText(/наименован|назван/)
  await name.fill('РЕМОНТ-910')
  await name.blur()
  await expect(save).toBeDisabled()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await expect(save).toBeEnabled()

  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let writes = 0
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('updateWeldJoints_')) return route.continue()
    writes += 1
    if (writes === 1) { await held; return route.abort('failed') }
    return route.continue()
  })
  const before = await footer.boundingBox()
  await save.click()
  const pending = footer.getByRole('button', { name: 'Сохраняем…', exact: true })
  await expect(pending).toBeDisabled()
  await expect(footer).not.toContainText('Сохранение заблокировано')
  expect(await footer.boundingBox()).toEqual(before)
  await expect.poll(() => writes).toBe(1)
  release()
  await expect(save).toBeEnabled()
  await expect(dialog).toBeVisible()
  await expect(footer.getByRole('alert')).toContainText('Не удалось сохранить:')
  await expect(name).toHaveValue('РЕМОНТ-910')
  await expect(dialog.getByLabel('Дата контроля', { exact: true })).toHaveValue('2026-09-03')
  await save.click()
  await expect(dialog).toBeHidden()
  expect(writes).toBe(2)
  await expect.poll(async () => withE2eDatabase(async db => (await db.query(
    'select vik_result,vik_conclusion,vik_conclusion_date::text from weld_joints where project_title=$1 and joint=$2', [project, 'F910'],
  )).rows[0])).toEqual({ vik_result: 'ремонт', vik_conclusion: 'РЕМОНТ-910', vik_conclusion_date: '2026-09-03' })
})

test('ранний клик меню ждёт одну проверку без серого мигания и лишних RPC', async ({ page }) => {
  await seed([{ joint: 'F911', diameter: 159, method: 'ВИК' }])
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let checks = 0
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('getLnkWorkflowSummary_')) { checks += 1; await held }
    await route.continue()
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  const item = page.getByRole('button', { name: 'Внести результаты', exact: true })
  await expect(item).toBeEnabled()
  await expect(item).toHaveAttribute('aria-busy', 'true')
  await expect(item).not.toContainText('Проверяем')
  await item.click()
  await item.press('Enter')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toHaveCount(0)
  release()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toBeVisible()
  expect(checks).toBe(1)
})

test('отложенный клик внесения не открывает второе окно поверх официальности', async ({ page }) => {
  await seed([{ joint: 'F915', diameter: 159, method: 'ВИК' }])
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (!rpcName(route.request().url()).startsWith('getLnkWorkflowSummary_')) return route.continue()
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  const add = page.getByRole('button', { name: 'Внести результаты', exact: true })
  await expect(add).toHaveAttribute('aria-busy', 'true')
  await add.click()
  await page.locator('header').getByRole('button', { name: 'Официальность', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Официальность стыков', exact: true })).toBeVisible()
  release()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  // Finish this test's delayed response before page.close(); otherwise its
  // route.fetch rejection can be attributed to the following Escape test.
  await page.unrouteAll({ behavior: 'wait' })
})

test('fresh header action is cancelled when the joint picture opens before its rows arrive', async ({ page }) => {
  await seed([{ joint: 'F917', diameter: 159, method: 'ВИК' }])
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  const row = lnkGridRow(page, 'F917')
  await row.getByRole('checkbox').check()
  await page.waitForLoadState('networkidle')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  await page.route('**/_serverFn/**', async route => {
    if (rpcName(route.request().url()).startsWith('listWeldJointRowsByIds_')) { started(); await gate }
    await route.continue()
  })
  try {
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
    await pending
    await row.getByRole('button', { name: 'F917', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Картина стыка F917', exact: true })).toBeVisible()
    release()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(1)
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }) }
})

test('Escape сначала закрывает обычную подсказку i, не форму внесения и не её данные', async ({ page }) => {
  await seed([{ joint: 'F916', diameter: 159, method: 'ВИК' }])
  const dialog = await openResults(page, 'F916', 'vikRequest')
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await dialog.getByRole('tab', { name: 'Специалисты', exact: true }).click()
  const help = dialog.getByRole('button', { name: 'Как назначить общую пару и специалистов отдельных документов', exact: true })
  await help.click()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Дата контроля', { exact: true })).toHaveValue('2026-09-03')
})

test('длинная ошибка официальности начинается справа от значка, без лишней строки и потери черновика', async ({ page }, info) => {
  await seed([{ joint: 'F914', diameter: 159, method: 'ВИК' }])
  await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный',
    has_rk='да',rk_result='ожидает НК',rk_request='POLICY-RK',rk_request_date='2026-09-02'
    where project_title=$1 and joint='F914'`, [project]))
  const dialog = await openResults(page, 'F914', 'vikRequest')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  const footer = dialog.getByRole('group', { name: 'Сохранение результата', exact: true })
  const alert = footer.getByRole('alert')
  await expect(alert).toContainText('Сначала верните стыку официальность')
  const toastClose = page.getByRole('button', { name: 'Закрыть уведомление', exact: true })
  if (await toastClose.isVisible()) await toastClose.click()
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const geometry = await alert.evaluate(element => {
      const icon = element.querySelector('svg')!.getBoundingClientRect()
      const text = element.querySelector('span')!
      const range = document.createRange()
      range.setStart(text.firstChild!, 0)
      range.setEnd(text.firstChild!, 1)
      const first = range.getBoundingClientRect()
      const area = element.parentElement!
      return { iconRight: icon.right, iconTop: icon.top, textLeft: first.left, textTop: first.top,
        width: area.clientWidth, scrollWidth: area.scrollWidth, height: area.clientHeight, scrollHeight: area.scrollHeight }
    })
    expect(geometry.textLeft).toBeGreaterThan(geometry.iconRight)
    expect(Math.abs(geometry.textTop - geometry.iconTop)).toBeLessThan(5)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
    if (width >= 1000) expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height + 1)
    await footer.screenshot({ path: info.outputPath(`officiality-message-${width}.png`) })
  }
  await expect(dialog.getByLabel('Дата контроля', { exact: true })).toHaveValue('2026-09-03')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await withE2eDatabase(async db => (await db.query(
    "select officiality,vik_result,rk_result from weld_joints where project_title=$1 and joint='F914'", [project],
  )).rows[0])).toEqual({ officiality: 'неофициальный', vik_result: 'ожидает НК', rk_result: 'ожидает НК' })
})

test('старый безымянный результат: совместное дозаполнение без удаления факта', async ({ page }) => {
  await seed([{ joint: 'F912', diameter: 159, method: 'ВИК' }])
  await withE2eDatabase(db => db.query("update weld_joints set vik_result='ремонт',vik_conclusion=null,vik_conclusion_date=null where project_title=$1 and joint=$2", [project, 'F912']))
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F912')
  await lnkGridRow(page, 'F912').getByRole('checkbox').click()
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Редактировать выбранные', exact: true }).click()
  const form = page.getByRole('region', { name: 'Дозаполнение реквизитов результата' })
  await form.getByLabel('Наименование заключения', { exact: true }).fill('ИСТОРИЯ-912')
  await expect(form.getByRole('button', { name: 'Дозаполнить реквизиты' })).toBeDisabled()
  await form.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  await form.getByRole('button', { name: 'Дозаполнить реквизиты' }).click()
  await expect.poll(async () => withE2eDatabase(async db => (await db.query(
    'select vik_result,vik_conclusion,vik_conclusion_date::text from weld_joints where project_title=$1 and joint=$2', [project, 'F912'],
  )).rows[0])).toEqual({ vik_result: 'ремонт', vik_conclusion: 'ИСТОРИЯ-912', vik_conclusion_date: '2026-09-03' })
})

test('старая заявка без даты не позволяет внести новый результат НК', async ({ page }) => {
  await seed([{ joint: 'F915', diameter: 159, method: 'ВИК' }])
  await withE2eDatabase(db => db.query('update weld_joints set vik_request_date=null where project_title=$1 and joint=$2', [project, 'F915']))
  const snapshot = () => withE2eDatabase(async db => (await db.query(
    'select vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date from weld_joints where project_title=$1 and joint=$2', [project, 'F915'],
  )).rows[0])
  const before = await snapshot()
  const dialog = await openResults(page, 'F915', 'vikRequest')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'годен', exact: true }).click()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  const footer = dialog.getByRole('group', { name: 'Сохранение результата', exact: true })
  await expect(footer.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeDisabled()
  await expect(footer).toContainText('дату заявки ВИК')
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
})

test('дубль-контроль требует название и обе независимые даты', async ({ page }) => {
  await seed([{ joint: 'F913', diameter: 159, method: 'ВИК' }])
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill('F913')
  await lnkGridRow(page, 'F913').getByRole('checkbox').click()
  await page.locator('header').getByRole('button', { name: 'Дубль контроль', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'ВИК', exact: true }).click()
  await dialog.getByRole('button', { name: 'годен', exact: true }).click()
  const save = dialog.getByRole('button', { name: 'Добавить дубль', exact: true })
  await expect(save).toBeDisabled()
  await dialog.getByLabel('Заключение', { exact: true }).fill('ЗАКАЗЧИК-913')
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('03.09.2026')
  await expect(save).toBeDisabled()
  await expect(dialog.getByLabel('Дата заключения', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByLabel('Дата заключения', { exact: true }).fill('04.09.2026')
  await save.click()
  await expect.poll(async () => withE2eDatabase(async db => (await db.query(
    "select control_date::text,conclusion_date::text,conclusion from duplicate_controls where conclusion=$1", ['ЗАКАЗЧИК-913'],
  )).rows[0])).toEqual({ control_date: '2026-09-03', conclusion_date: '2026-09-04', conclusion: 'ЗАКАЗЧИК-913' })
})

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

test('a result-registry click after saving waits for the refreshed availability instead of losing the intent', async ({ page }) => {
  await seed([{ joint: 'F918', diameter: 57, method: 'ВИК' }])
  const dialog = await openResults(page, 'F918', 'vikRequest')
  await page.waitForLoadState('networkidle')
  await dialog.getByRole('group', { name: 'Результат для всех выбранных', exact: true }).getByRole('button', { name: 'ремонт', exact: true }).click()
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-09-03')
  let releaseRows!: () => void, releaseSummary!: () => void
  const rowsGate = new Promise<void>(resolve => { releaseRows = resolve })
  const summaryGate = new Promise<void>(resolve => { releaseSummary = resolve })
  await page.route('**/_serverFn/**', async route => {
    const name = rpcName(route.request().url())
    if (!name.startsWith('readJournalGrid_') && !name.startsWith('getLnkWorkflowSummary_')) return route.continue()
    const response = await route.fetch()
    await (name.startsWith('readJournalGrid_') ? rowsGate : summaryGate)
    await route.fulfill({ response })
  })
  try {
    await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
    await expect(dialog).toBeHidden()
    const grid = page.locator('[data-lnk-grid] .journal-grid-frame')
    await expect(grid).toHaveAttribute('aria-busy', 'true')
    await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
    const item = page.getByRole('button', { name: 'Все результаты ЛНК', exact: true })
    await expect(item).toHaveAttribute('aria-busy', 'true')
    await item.click()
    releaseRows()
    await expect(grid).toHaveAttribute('aria-busy', 'false')
    // The previous summary contains zero results. It cannot cancel the user's
    // click while its replacement, reflecting the save, is still in flight.
    await expect(item).toHaveAttribute('aria-busy', 'true')
    releaseSummary()
    const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
    await expect(manager).toBeVisible()
    await manager.getByPlaceholder('Стык, линия, заявка или заключение').fill('F918')
    await expect(manager.getByRole('group', { name: 'Изменить на:', exact: true }).getByRole('button', { name: 'ремонт', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    releaseRows(); releaseSummary()
    await page.unrouteAll({ behavior: 'wait' })
  }
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
  // A native checkbox is checked before the controlled selection finishes its
  // render. Wait for all three rows before testing a separate hover interaction.
  await expect(dialog.getByText(/^Заявка:.*· Выбрано: 3$/)).toBeVisible()
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
  await lnkGridRow(page, joint).getByRole('checkbox').click()
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
