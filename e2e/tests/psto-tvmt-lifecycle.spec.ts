import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const JOINT = 'F1'
const CANCELLED_CYCLE_JOINT = 'F2'
const LATE_ASSIGNMENT_JOINT = 'F3'
const REACTIVATED_JOINT = 'F4'
const LINE_MOVE_JOINT = 'F6'

test('НК до ТО -> ПСТО -> негодная ТВМТ -> повтор -> основной НК -> ремонт -> исправление', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/lnk')
  await expect(page.getByText(JOINT, { exact: true }).first()).toBeVisible()

  await runNextAction(page, 'Создать заявку НК до ТО')
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-02')
  await page.getByRole('button', { name: 'Создать заявку до ТО' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeHidden()
  await expectDatabaseRow('pre_heat_treatment_controls', {
    method: 'ВИК',
    request_date: '2026-08-02',
  })

  await runNextAction(page, 'Внести результат НК до ТО')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата контроля', '2026-08-03')
  await page.getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат до ТО' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeHidden()
  await expectDatabaseRow('pre_heat_treatment_controls', {
    result: 'годен',
    conclusion_date: '2026-08-03',
  })

  await runNextAction(page, 'Создать заявку ПСТО')
  await expect(page).toHaveURL(/\/psto$/)
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-04')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeHidden()
  await expectWeld({
    psto_request_date: '2026-08-04',
    psto_result: null,
    final_status: 'ожидает НК',
  })

  await runNextAction(page, 'Внести результат ПСТО · цикл 1')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата ПСТО', '2026-08-05')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeHidden()
  await expectWeld({ psto_date: '2026-08-05', psto_result: 'проведено' })

  await runNextAction(page, 'Создать заявку ТВМТ · цикл 1')
  await expect(page.getByRole('heading', { name: 'Заявка ТВМТ' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-06')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ТВМТ' })).toBeHidden()
  await expectWeld({ tvmt_request_date: '2026-08-06', tvmt_result: 'ожидает НК' })

  await runNextAction(page, 'Внести результат ТВМТ · цикл 1')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeVisible()
  await fillDate(page, 'Дата ТВМТ', '2026-08-07')
  await chooseOptionByLabel(page, 'Результат для выбранных', 'не годен')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeHidden()
  await expectWeld({ tvmt_result: 'не годен', tvmt_conclusion_date: '2026-08-07' })

  await runNextAction(page, 'Создать заявку повторной ПСТО · цикл 2')
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-08')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeHidden()
  await expectRepeatCycle({ sequence: 2, psto_request_date: '2026-08-08' })

  await runNextAction(page, 'Внести результат ПСТО · цикл 2')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата ПСТО', '2026-08-09')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeHidden()
  await expectRepeatCycle({ sequence: 2, psto_date: '2026-08-09', psto_result: 'проведено' })

  await runNextAction(page, 'Создать заявку ТВМТ · цикл 2')
  await fillDate(page, 'Дата заявки', '2026-08-10')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expectRepeatCycle({ sequence: 2, tvmt_request_date: '2026-08-10' })

  await runNextAction(page, 'Внести результат ТВМТ · цикл 2')
  await fillDate(page, 'Дата ТВМТ', '2026-08-11')
  await chooseOptionByLabel(page, 'Результат для выбранных', 'годен')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expectRepeatCycle({ sequence: 2, tvmt_result: 'годен', tvmt_conclusion_date: '2026-08-11' })

  await runNextAction(page, 'Создать заявку основного НК')
  await expect(page).toHaveURL(/\/lnk$/)
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-12')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expectWeld({ vik_request_date: '2026-08-12', vik_result: 'ожидает НК' })

  await runNextAction(page, 'Внести результат основного НК')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК' })).toBeVisible()
  await chooseOptionByLabel(page, 'Метод контроля', 'ВИК')
  await fillDate(page, 'Дата контроля', '2026-08-13')
  await page.getByRole('button', { name: 'ремонт', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expectWeld({ vik_result: 'ремонт', vik_conclusion_date: '2026-08-13' })
  await expect(page.getByRole('button', { name: /^Создать F1R1/ }).first()).toBeVisible({ timeout: 15_000 })

  await openHeaderMenuItem(page, 'Результат', 'Все результаты ЛНК')
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`E2E-L1 · ${JOINT}`) }).click()
  await page.getByRole('button', { name: 'годен', exact: true }).last().click()
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeHidden()
  await expectWeld({ vik_result: 'годен', vik_conclusion_date: '2026-08-13' })
  await expect(page.getByRole('button', { name: /^Создать F1R1/ })).toHaveCount(0, { timeout: 15_000 })

  await page.goto('/psto')
  await openHeaderMenuItem(page, 'Результат', 'История ПСТО и ТВМТ')
  await expect(page.getByRole('heading', { name: 'История ПСТО и ТВМТ' })).toBeVisible()
  await page.getByRole('tab', { name: 'Основной цикл' }).click()
  const primaryTvmtCard = page
    .getByRole('heading', { name: 'Заключение ТВМТ' })
    .locator('xpath=ancestor::article')
  await primaryTvmtCard.getByRole('combobox').selectOption({ label: 'годен' })
  await page.getByRole('button', { name: 'Удалить последующие циклы и сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Исправить ТВМТ и удалить последующие циклы' })).toBeVisible()
  await expect(page.getByText(/Циклы №2 и связанные с ними документы/)).toBeVisible()
  await page.getByRole('button', { name: 'Удалить циклы и сохранить', exact: true }).click()

  await expect(page.getByRole('tab', { name: 'Повтор #2' })).toBeHidden({ timeout: 15_000 })
  await expectWeld({
    tvmt_result: 'годен',
    tvmt_conclusion_date: '2026-08-07',
    vik_request_date: '2026-08-12',
    vik_result: 'годен',
    vik_conclusion_date: '2026-08-13',
  })
  await expectNoRepeatCycleForJoint(JOINT)
  await expectPstoCycleDocumentPosition(JOINT, 1, true)
  await expectPstoCycleDocumentPosition(JOINT, 2, false)

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  const stageFilterButton = page.getByTitle('Фильтр: Этап')
  await expect(stageFilterButton).toBeVisible()
  await stageFilterButton.click()
  const stageFilterMenu = page.getByRole('dialog', { name: 'Фильтр: Этап' })
  await expect(stageFilterMenu).toBeVisible()
  expect(await stageFilterMenu.evaluate((element) => element.parentElement === document.body)).toBe(true)
  const stageFilterMenuBox = await stageFilterMenu.boundingBox()
  const viewport = page.viewportSize()
  expect(stageFilterMenuBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(stageFilterMenuBox!.y).toBeGreaterThanOrEqual(0)
  expect(stageFilterMenuBox!.y + stageFilterMenuBox!.height).toBeLessThanOrEqual(viewport!.height)
  await stageFilterMenu.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: /Столбцы 8\/8/ }).click()
  await page.getByRole('checkbox', { name: 'Этап', exact: true }).click()
  await expect(page.getByRole('button', { name: /Столбцы 7\/8/ })).toBeVisible()
  await expect(page.getByTitle('Фильтр: Этап')).toBeHidden()

  await page.reload()
  await page.getByRole('button', { name: 'Заявка ПСТО', exact: true }).click()
  await expect(page.getByRole('button', { name: /Столбцы 7\/7/ })).toBeVisible()
  await page.getByRole('button', { name: 'Заключения ЛНК', exact: true }).click()
  await expect(page.getByRole('button', { name: /Столбцы 7\/8/ })).toBeVisible()
  await expect(page.getByTitle('Фильтр: Этап')).toBeHidden()
})

test('официальная отмена сохраняет выполненный цикл, но удаляет незапущенный повтор', async ({ page }) => {
  await seedCancelledCycleJoint()
  await page.goto('/psto')
  await expect(page.getByText(CANCELLED_CYCLE_JOINT, { exact: true }).first()).toBeVisible()

  let row = page.getByText(CANCELLED_CYCLE_JOINT, { exact: true }).first().locator('xpath=ancestor::tr')
  await row.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-08')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expectRepeatCycleForJoint(CANCELLED_CYCLE_JOINT, {
    sequence: 2,
    psto_request_date: '2026-08-08',
  })
  await expectPstoCycleDocumentPosition(CANCELLED_CYCLE_JOINT, 2, true)

  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Программа ПСТО' })).toBeVisible()
  await page.getByLabel('Поиск линий', { exact: true }).fill('E2E-L2')
  await expect(page.getByText('E2E-L2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Отмена ПСТО' })).toBeVisible()
  await page.getByLabel(/Дата решения об отмене ПСТО/).fill('2026-08-09')
  await page.getByLabel('Основание отмены ПСТО', { exact: true }).fill('E2E техническое решение')
  await page.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()

  await expectDatabaseWeld(CANCELLED_CYCLE_JOINT, {
    psto_required: 'отменен',
    psto_cancellation_date: '2026-08-09',
    psto_control_basis: 'E2E техническое решение',
    psto_result: 'проведено',
    tvmt_result: 'не годен',
    final_status: 'ожидает заявку',
  })
  await expectPreControl(CANCELLED_CYCLE_JOINT, {
    method: 'ВИК',
    result: 'годен',
    conclusion_name: 'Заключение ВИК до ТО E2E-2',
  })
  await expectNoRepeatCycleForJoint(CANCELLED_CYCLE_JOINT)
  await expectPstoCycleDocumentPosition(CANCELLED_CYCLE_JOINT, 2, false)

  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Программа ПСТО' })).toBeHidden()
  row = page.getByText(CANCELLED_CYCLE_JOINT, { exact: true }).first().locator('xpath=ancestor::tr')
  const createRequestButton = row.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })
  await expect(createRequestButton).toBeDisabled()
  await expect(createRequestButton).toHaveAttribute(
    'title',
    'ПСТО по линии отменена; новые циклы недоступны.',
  )
})

test('позднее назначение ПСТО сохраняет фактический основной НК для постепенного дозаполнения истории', async ({ page }) => {
  await seedLateAssignmentJoint()
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await page.getByLabel('Поиск линий', { exact: true }).fill('E2E-L3')
  await expect(page.getByText('E2E-L3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Назначение ПСТО' })).toBeVisible()
  await expect(page.getByText(LATE_ASSIGNMENT_JOINT, { exact: true })).toBeVisible()
  const submit = page.getByRole('button', { name: 'Назначить ПСТО', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByRole('button', { name: /Сохранить существующий основной НК/ }).click()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByRole('heading', { name: 'Назначение ПСТО' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeHidden()

  await expectDatabaseWeld(LATE_ASSIGNMENT_JOINT, {
    psto_required: 'да',
    vik_request: 'Заявка ВИК основная E2E-3',
    vik_request_date: '2026-08-02',
    vik_result: 'годен',
    vik_conclusion_date: '2026-08-03',
    vik_conclusion: 'Заключение ВИК основное E2E-3',
    final_status: 'ожидает заявку',
  })
  await expectNoPreControl(LATE_ASSIGNMENT_JOINT)

  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const row = page.getByText(LATE_ASSIGNMENT_JOINT, { exact: true }).first().locator('xpath=ancestor::tr')
  const createPstoRequest = row.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })
  await expect(createPstoRequest).toBeDisabled()
  await expect(createPstoRequest).toHaveAttribute('title', /НК до ТО: ВИК/)

  await runNextAction(page, 'Создать заявку НК до ТО')
  await expect(page).toHaveURL(/\/lnk$/)
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-01')
  await page.getByRole('button', { name: 'Создать заявку до ТО' }).click()

  await runNextAction(page, 'Внести результат НК до ТО')
  await fillDate(page, 'Дата контроля', '2026-08-01')
  await page.getByRole('dialog').getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат до ТО' }).click()

  await runNextAction(page, 'Создать заявку ПСТО')
  await expect(page).toHaveURL(/\/psto$/)
  await fillDate(page, 'Дата заявки', '2026-08-01')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()

  await runNextAction(page, 'Внести результат ПСТО · цикл 1')
  await fillDate(page, 'Дата ПСТО', '2026-08-02')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()

  await runNextAction(page, 'Создать заявку ТВМТ · цикл 1')
  await fillDate(page, 'Дата заявки', '2026-08-02')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()

  await runNextAction(page, 'Внести результат ТВМТ · цикл 1')
  await fillDate(page, 'Дата ТВМТ', '2026-08-02')
  await chooseOptionByLabel(page, 'Результат для выбранных', 'годен')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()

  await expectDatabaseWeld(LATE_ASSIGNMENT_JOINT, {
    psto_required: 'да',
    tvmt_result: 'годен',
    vik_request: 'Заявка ВИК основная E2E-3',
    vik_request_date: '2026-08-02',
    vik_result: 'годен',
    vik_conclusion_date: '2026-08-03',
    vik_conclusion: 'Заключение ВИК основное E2E-3',
    final_status: 'годен',
  })
  await expectPreControl(LATE_ASSIGNMENT_JOINT, {
    method: 'ВИК',
    request_date: '2026-08-01',
    result: 'годен',
    conclusion_date: '2026-08-01',
  })
  const completedRow = page
    .getByText(LATE_ASSIGNMENT_JOINT, { exact: true })
    .first()
    .locator('xpath=ancestor::tr')
  await expect(completedRow.getByText(/ДЗ-19/)).toBeVisible()
  await expect(completedRow.getByText('ДЗ-20', { exact: false })).toHaveCount(0)
  await expect(completedRow.getByText('Создать заявку основного НК', { exact: true })).toHaveCount(0)
})

test('возобновление отмененной линии также может сохранить фактический основной НК', async ({ page }) => {
  await seedReactivationLine()
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await page.getByLabel('Поиск линий', { exact: true }).fill('E2E-L4')
  await expect(page.getByRole('dialog').getByText('E2E-L4', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Возобновить', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Возобновление ПСТО' })).toBeVisible()
  await expect(page.getByText(REACTIVATED_JOINT, { exact: true })).toBeVisible()
  const submit = page.getByRole('button', { name: 'Возобновить ПСТО', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByRole('button', { name: /Сохранить существующий основной НК/ }).click()
  await submit.click()

  await expectDatabaseWeld(REACTIVATED_JOINT, {
    psto_required: 'да',
    psto_cancellation_date: null,
    psto_control_basis: null,
    vik_request: 'Заявка ВИК основная E2E-4',
    vik_result: 'годен',
    final_status: 'ожидает заявку',
  })
  await expectNoPreControl(REACTIVATED_JOINT)
  await expectDatabaseWeld('F5', {
    psto_required: 'да',
    psto_cancellation_date: null,
    psto_result: 'проведено',
    tvmt_result: 'годен',
  })
})

test('карточка стыка переносит основной НК на линию с ПСТО без автоматического переноса в «До ТО»', async ({ page }) => {
  await seedLineMoveJoint()
  await page.goto('/journal')

  const sourceRow = page
    .getByText(LINE_MOVE_JOINT, { exact: true })
    .first()
    .locator('xpath=ancestor::tr')
  await expect(sourceRow).toBeVisible()
  await sourceRow.getByRole('button', { name: 'Редактировать', exact: true }).click()

  const editor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Редактирование стыка' }),
  })
  await expect(editor).toBeVisible()
  const lineInput = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  await lineInput.fill('E2E-L6')
  await lineInput.press('Tab')

  await expect(page.getByRole('heading', { name: 'Перенос стыка на линию с ПСТО' })).toBeVisible()
  await page.getByRole('button', { name: /Сохранить существующий основной НК/ }).click()
  await page.getByRole('button', { name: 'Применить решение', exact: true }).click()
  await expect(page.getByText(/отдельный НК до ТО можно оформить позже/)).toBeVisible()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()

  await expectDatabaseWeld(LINE_MOVE_JOINT, {
    line: 'E2E-L6',
    psto_required: 'да',
    vik_request: 'Заявка ВИК основная E2E-6',
    vik_request_date: '2026-08-02',
    vik_result: 'годен',
    vik_conclusion_date: '2026-08-03',
    vik_conclusion: 'Заключение ВИК основное E2E-6',
    final_status: 'ожидает заявку',
  })
  await expectNoPreControl(LINE_MOVE_JOINT)

  await page.goto('/psto')
  const movedRow = page
    .getByText(LINE_MOVE_JOINT, { exact: true })
    .first()
    .locator('xpath=ancestor::tr')
  const createPstoRequest = movedRow.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' })
  await expect(createPstoRequest).toBeDisabled()
  await expect(createPstoRequest).toHaveAttribute('title', /НК до ТО: ВИК/)
})

async function fillDate(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true })
  await expect(input).toBeVisible()
  await input.fill(value)
  await expect(input).toHaveValue(value)
}

async function runNextAction(page: Page, title: string) {
  const button = page.getByRole('button', { name: `Выполнить: ${title}`, exact: true })
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
}

async function chooseOptionByLabel(page: Page, label: string, value: string) {
  const select = page.getByLabel(label, { exact: true })
  await expect(select).toBeVisible()
  await select.selectOption({ label: value })
}

async function openHeaderMenuItem(page: Page, menu: string, item: string) {
  await page.locator('header').getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('button', { name: item, exact: true }).click()
}

async function expectWeld(expected: Record<string, unknown>) {
  return expectDatabaseWeld(JOINT, expected)
}

async function expectDatabaseWeld(joint: string, expected: Record<string, unknown>) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query('select * from weld_joints where joint = $1', [joint])
    return pick(result.rows[0] ?? {}, Object.keys(expected))
  })).toEqual(expected)
}

async function expectRepeatCycle(expected: Record<string, unknown>) {
  return expectRepeatCycleForJoint(JOINT, expected)
}

async function expectRepeatCycleForJoint(joint: string, expected: Record<string, unknown>) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query(`
      select cycle.*
      from psto_repeat_cycles cycle
      inner join weld_joints weld on weld.id = cycle.weld_joint_id
      where weld.joint = $1 and cycle.sequence = $2
    `, [joint, expected.sequence])
    return pick(result.rows[0] ?? {}, Object.keys(expected))
  })).toEqual(expected)
}

async function expectNoRepeatCycleForJoint(joint: string) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query(`
      select count(*)::int as count
      from psto_repeat_cycles cycle
      inner join weld_joints weld on weld.id = cycle.weld_joint_id
      where weld.joint = $1
    `, [joint])
    return result.rows[0]?.count ?? -1
  })).toBe(0)
}

async function expectPstoCycleDocumentPosition(joint: string, sequence: number, expected: boolean) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const weld = await client.query<{ id: number }>('select id from weld_joints where joint = $1', [joint])
    const weldJointId = weld.rows[0]?.id
    if (!weldJointId) return false
    const documents = await client.query<{ source_metadata: string | null }>(`
      select source_metadata
      from generated_documents
      where source_metadata is not null
    `)
    return documents.rows.some((document) => {
      try {
        const metadata = JSON.parse(document.source_metadata ?? '{}') as {
          sourceKind?: string
          sourcePositions?: Array<{ weldJointId?: number; sequence?: number }>
        }
        return metadata.sourceKind === 'pstoCycle' && metadata.sourcePositions?.some((position) => (
          position.weldJointId === weldJointId && position.sequence === sequence
        ))
      } catch {
        return false
      }
    })
  })).toBe(expected)
}

async function expectDocumentStage(joint: string, title: string, sourceKind: string) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const documents = await client.query<{ source_metadata: string | null }>(`
      select document.source_metadata
      from generated_documents document
      inner join generated_document_weld_joints assignment on assignment.document_id = document.id
      inner join weld_joints weld on weld.id = assignment.weld_joint_id
      where weld.joint = $1 and document.title = $2
    `, [joint, title])
    return documents.rows.some((document) => {
      try {
        return JSON.parse(document.source_metadata ?? '{}').sourceKind === sourceKind
      } catch {
        return false
      }
    })
  })).toBe(true)
}

async function expectPreControl(joint: string, expected: Record<string, unknown>) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query(`
      select relation.*
      from pre_heat_treatment_controls relation
      inner join weld_joints weld on weld.id = relation.weld_joint_id
      where weld.joint = $1
    `, [joint])
    return pick(result.rows[0] ?? {}, Object.keys(expected))
  })).toEqual(expected)
}

async function expectNoPreControl(joint: string) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query<{ count: number }>(`
      select count(*)::int as count
      from pre_heat_treatment_controls relation
      inner join weld_joints weld on weld.id = relation.weld_joint_id
      where weld.joint = $1
    `, [joint])
    return result.rows[0]?.count ?? -1
  })).toBe(0)
}

async function seedCancelledCycleJoint() {
  await withE2eDatabase(async (client) => {
    const seed = await client.query<{ id: number }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        status, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, psto_required, psto_request, psto_request_date,
        psto_date, heat_treatment_diagram, psto_result, tvmt_request,
        tvmt_request_date, tvmt_result, tvmt_conclusion_date, tvmt_conclusion,
        final_status, welding_updated_at, psto_created_at, psto_updated_at,
        lnk_created_at, lnk_updated_at
      ) values (
        '2026-08-01', 'E2E отмена', 'E2E-002', 'E2E-L2', 'ISO-E2E-2', 'F2', 'E2E-S2',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2E-K2', 'E2E-K2', 'да',
        'проект', 'да', 'Заявка ПСТО E2E-2', '2026-08-04',
        '2026-08-05', 'Диаграмма E2E-2', 'проведено', 'Заявка ТВМТ E2E-2',
        '2026-08-06', 'не годен', '2026-08-07', 'Заключение ТВМТ E2E-2',
        'ожидает заявку', now(), now(), now(), now(), now()
      )
      returning id
    `)
    const weldJointId = seed.rows[0]?.id
    if (!weldJointId) throw new Error('E2E cancellation seed was not created')
    await client.query(`
      insert into pre_heat_treatment_controls (
        weld_joint_id, method, request_name, request_date, result, conclusion_date, conclusion_name
      ) values (
        $1, 'ВИК', 'Заявка ВИК до ТО E2E-2', '2026-08-02',
        'годен', '2026-08-03', 'Заключение ВИК до ТО E2E-2'
      )
    `, [weldJointId])
  })
}

async function seedLateAssignmentJoint() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        status, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, vik_request, vik_request_date, vik_result,
        vik_conclusion_date, vik_conclusion, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-08-01', 'E2E позднее назначение', 'E2E-003', 'E2E-L3', 'ISO-E2E-3', 'F3', 'E2E-S3',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2E-K3', 'E2E-K3', 'да',
        'проект', 'Заявка ВИК основная E2E-3', '2026-08-02', 'годен',
        '2026-08-03', 'Заключение ВИК основное E2E-3', 'годен',
        now(), now(), now()
      )
    `)
  })
}

async function seedReactivationLine() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        status, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, vik_request, vik_request_date, vik_result,
        vik_conclusion_date, vik_conclusion, psto_required, psto_cancellation_date,
        psto_control_basis, final_status, welding_updated_at, lnk_created_at,
        lnk_updated_at, psto_created_at, psto_updated_at
      ) values (
        '2026-08-01', 'E2E возобновление', 'E2E-004', 'E2E-L4', 'ISO-E2E-4', 'F4', 'E2E-S4',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2E-K4', 'E2E-K4', 'да',
        'проект', 'Заявка ВИК основная E2E-4', '2026-08-02', 'годен',
        '2026-08-03', 'Заключение ВИК основное E2E-4', 'отменен', '2026-08-04',
        'E2E отмена', 'годен', now(), now(), now(), now(), now()
      ), (
        '2026-08-01', 'E2E возобновление', 'E2E-004', 'E2E-L4', 'ISO-E2E-5', 'F5', 'E2E-S4',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2E-K5', 'E2E-K5', null,
        null, null, null, null,
        null, null, 'отменен', '2026-08-08',
        'E2E отмена', 'годен', now(), now(), now(), now(), now()
      )
    `)
    await client.query(`
      update weld_joints
      set psto_request = 'Заявка ПСТО E2E-5', psto_request_date = '2026-08-04',
          psto_date = '2026-08-05', heat_treatment_diagram = 'Диаграмма E2E-5',
          psto_result = 'проведено', tvmt_request = 'Заявка ТВМТ E2E-5',
          tvmt_request_date = '2026-08-06', tvmt_result = 'годен',
          tvmt_conclusion_date = '2026-08-07', tvmt_conclusion = 'Заключение ТВМТ E2E-5'
      where joint = 'F5'
    `)
  })
}

async function seedLineMoveJoint() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        status, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, vik_request, vik_request_date, vik_result,
        vik_conclusion_date, vik_conclusion, psto_required, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at, psto_created_at,
        psto_updated_at
      ) values (
        '2026-08-01', 'E2E перенос', 'E2E-006', 'E2E-L5', 'ISO-E2E-6', 'F6', 'E2E-S6',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2K6', 'E2K6', 'да',
        'проект', 'Заявка ВИК основная E2E-6', '2026-08-02', 'годен',
        '2026-08-03', 'Заключение ВИК основное E2E-6', null, 'годен',
        now(), now(), now(), now(), now()
      ), (
        '2026-08-01', 'E2E перенос', 'E2E-006', 'E2E-L6', 'ISO-E2E-7', 'F7', 'E2E-S7',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2K6', 'E2K6', null,
        null, null, null, null,
        null, null, 'да', 'ожидает НК',
        now(), now(), now(), now(), now()
      )
    `)
    await client.query(`
      insert into welder_stamps (
        naks_stamp, welder_name, weld_type, material_groups,
        diameter_from, diameter_to, thickness_from, thickness_to,
        valid_from, valid_to, naks_permits
      ) values (
        'E2K6', 'E2E сварщик', 'РД', 'M01',
        '1', '1000', '1', '100', '2026-01-01', '2026-12-31',
        '[{"id":"e2e-naks-6","weldType":"РД","materialGroups":"M01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","note":"","archived":false}]'
      )
    `)
  })
}

async function expectDatabaseRow(table: 'pre_heat_treatment_controls', expected: Record<string, unknown>) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query(`
      select relation.*
      from ${table} relation
      inner join weld_joints weld on weld.id = relation.weld_joint_id
      where weld.joint = $1
    `, [JOINT])
    return pick(result.rows[0] ?? {}, Object.keys(expected))
  })).toEqual(expected)
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, normalizeDatabaseValue(source[key])]))
}

function normalizeDatabaseValue(value: unknown) {
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return value
}
