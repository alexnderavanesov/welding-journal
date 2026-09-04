import { expect, test, type Locator, type Page } from '@playwright/test'

import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'
import { getWeldLineMembershipLockKeys } from '@/server/weld-line-membership-lock'
import { withE2eDatabase } from '../database'

const JOINT = 'F1'
const CANCELLED_CYCLE_JOINT = 'F2'
const LATE_ASSIGNMENT_JOINT = 'F3'
const REACTIVATED_JOINT = 'F4'
const LINE_MOVE_JOINT = 'F6'
const STAGE_SYNC_JOINT = 'F8'
const STAGE_SYNC_SOURCE_LINE = 'E2E-L8'
const STAGE_SYNC_TARGET_LINE = 'E2E-L9'
const CONCURRENT_PSTO_PROJECT = 'E2E конкурентная линия'
const CONCURRENT_PSTO_SUBTITLE = 'E2E-010'
const CONCURRENT_PSTO_LINE = 'E2E-L10'
const LNK_REPORT_VIEW_STORAGE_KEY = 'welding-report-view:v1:lnk'

test('НК до ТО -> ПСТО -> негодная ТВМТ -> повтор -> основной НК -> ремонт -> исправление', async ({ page }) => {
  test.setTimeout(180_000)

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
    defect_description: 'ДНО',
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
  await expectWeld({
    vik_result: 'ремонт',
    vik_conclusion_date: '2026-08-13',
    vik_defect_description: null,
  })
  await expectRepeatedJointCreateTask(page, JOINT, 'F1R1')

  await openHeaderMenuItem(page, 'Результат', 'Все результаты ЛНК')
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`E2E-L1 · ${JOINT}`) }).click()
  await page.getByRole('button', { name: 'годен', exact: true }).last().click()
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeHidden()
  await expectWeld({
    vik_result: 'годен',
    vik_conclusion_date: '2026-08-13',
    vik_defect_description: 'ДНО',
  })
  await expectRepeatedJointCreateTaskToDisappear(page, 'F1R1')

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
  await expect(page.getByRole('dialog').getByText('E2E-L2', { exact: true })).toBeVisible()
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
  await page.getByRole('button', {
    name: `Оставить основной НК для стыка ${LATE_ASSIGNMENT_JOINT}`,
  }).click()
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

  await runNextAction(page, 'Создать заявку НК до ТО', LATE_ASSIGNMENT_JOINT)
  await expect(page).toHaveURL(/\/lnk$/)
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-01')
  await page.getByRole('button', { name: 'Создать заявку до ТО' }).click()

  await runNextAction(page, 'Внести результат НК до ТО', LATE_ASSIGNMENT_JOINT)
  await fillDate(page, 'Дата контроля', '2026-08-01')
  await page.getByRole('dialog').getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат до ТО' }).click()

  await runNextAction(page, 'Создать заявку ПСТО', LATE_ASSIGNMENT_JOINT)
  await expect(page).toHaveURL(/\/psto$/)
  await fillDate(page, 'Дата заявки', '2026-08-01')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()

  await runNextAction(page, 'Внести результат ПСТО · цикл 1', LATE_ASSIGNMENT_JOINT)
  await fillDate(page, 'Дата ПСТО', '2026-08-02')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()

  await runNextAction(page, 'Создать заявку ТВМТ · цикл 1', LATE_ASSIGNMENT_JOINT)
  await fillDate(page, 'Дата заявки', '2026-08-02')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()

  await runNextAction(page, 'Внести результат ТВМТ · цикл 1', LATE_ASSIGNMENT_JOINT)
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
  await page.getByRole('button', {
    name: `Оставить основной НК для стыка ${REACTIVATED_JOINT}`,
  }).click()
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

test('этап НК одинаково меняется из ПСТО, документов и карточки стыка', async ({ page }) => {
  test.setTimeout(300_000)
  await seedStageSynchronizationLines()
  await showOnlyStageSynchronizationFields(page)

  await page.goto('/lnk')
  await runNextAction(page, 'Создать заявку основного НК', STAGE_SYNC_JOINT)
  await fillDate(page, 'Дата заявки', '2026-08-20')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()

  await runNextAction(page, 'Внести результат основного НК', STAGE_SYNC_JOINT)
  await fillDate(page, 'Дата контроля', '2026-08-21')
  await page.getByRole('dialog').getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат', exact: true }).click()

  const titles = await loadVikDocumentTitles(STAGE_SYNC_JOINT, true)
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_SOURCE_LINE,
    stage: 'primary',
    titles,
    pstoRequired: null,
    completed: true,
  })

  await openPstoLineProgram(page, STAGE_SYNC_SOURCE_LINE)
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Назначение ПСТО' })).toBeVisible()
  await expect(page.getByText('Основной НК: ВИК', { exact: true })).toBeVisible()
  await page.getByRole('button', {
    name: `Перенести основной НК стыка ${STAGE_SYNC_JOINT} в «До ТО»`,
  }).click()
  await page.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await closePstoLineProgram(page)
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_SOURCE_LINE,
    stage: 'beforeHeatTreatment',
    titles,
    completed: true,
  })

  const documentRow = await openLnkDocumentRow(page, titles.request, 'request')
  await documentRow.click({ button: 'right' })
  await page.getByRole('button', { name: 'Перенести в «Основной»', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Перенести комплект на этап «Основной»' })).toBeVisible()
  await page.getByRole('button', { name: 'Перенести', exact: true }).click()
  await expect(page.getByText(`Комплект «${titles.request}» перенесен на этап «Основной».`)).toBeVisible()
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_SOURCE_LINE,
    stage: 'primary',
    titles,
    completed: true,
  })

  const primaryDocumentRow = await openLnkDocumentRow(page, titles.request, 'request')
  await primaryDocumentRow.click({ button: 'right' })
  await page.getByRole('button', { name: 'Перенести в «До ТО»', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Перенести комплект на этап «До ТО»' })).toBeVisible()
  await page.getByRole('button', { name: 'Перенести', exact: true }).click()
  await expect(page.getByText(`Комплект «${titles.request}» перенесен на этап «До ТО».`)).toBeVisible()
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_SOURCE_LINE,
    stage: 'beforeHeatTreatment',
    titles,
    completed: true,
  })

  await openReport(page, 'Сварочный журнал', '/journal')
  const sourceRow = page
    .getByRole('button', { name: `Выбрать стык ${STAGE_SYNC_JOINT}`, exact: true })
    .locator('xpath=ancestor::tr')
  await expect(sourceRow).toBeVisible()
  await sourceRow.getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Редактирование стыка' }),
  })
  const lineInput = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  await lineInput.fill(STAGE_SYNC_TARGET_LINE)
  await lineInput.press('Tab')
  await expect(page.getByRole('heading', { name: 'Перенос стыка на линию без ПСТО' })).toBeVisible()
  await expect(page.getByText('До ТО: ВИК', { exact: false })).toBeVisible()
  const promotePreControl = page.getByRole('button', { name: /^Перенести завершенный НК до ТО/ })
  await expect(promotePreControl).toBeVisible()
  await promotePreControl.click()
  await page.getByRole('button', { name: 'Применить решение', exact: true }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_TARGET_LINE,
    stage: 'primary',
    titles,
    pstoRequired: null,
    completed: true,
  })

  await openPstoLineProgram(page, STAGE_SYNC_TARGET_LINE)
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Назначение ПСТО' })).toBeVisible()
  await expect(page.getByText('Основной НК: ВИК', { exact: true })).toBeVisible()
  await page.getByRole('button', {
    name: `Перенести основной НК стыка ${STAGE_SYNC_JOINT} в «До ТО»`,
  }).click()
  await page.getByRole('button', { name: 'Назначить ПСТО', exact: true }).click()
  await closePstoLineProgram(page)
  await expectDatabaseWeld('F9', { psto_required: 'да' })
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_TARGET_LINE,
    stage: 'beforeHeatTreatment',
    titles,
    completed: true,
  })

  await openPstoLineProgram(page, STAGE_SYNC_TARGET_LINE)
  await page.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Отмена ПСТО' })).toBeVisible()
  await expect(page.getByText('НК до ТО: ВИК', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Перенести завершенный НК до ТО', exact: true }).click()
  await page.getByLabel(/Дата решения об отмене ПСТО/).fill('2026-08-22')
  await page.getByLabel('Основание отмены ПСТО', { exact: true }).fill('Сквозной E2E-тест этапа')
  await page.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true }).click()
  await closePstoLineProgram(page)
  await expectDatabaseWeld('F9', { psto_required: 'отменен' })
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_TARGET_LINE,
    stage: 'primary',
    titles,
    pstoRequired: 'отменен',
    completed: true,
  })

  await openPstoLineProgram(page, STAGE_SYNC_TARGET_LINE)
  await page.getByRole('button', { name: 'Возобновить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Возобновление ПСТО' })).toBeVisible()
  await expect(page.getByText('Основной НК: ВИК', { exact: true })).toBeVisible()
  await page.getByRole('button', {
    name: `Перенести основной НК стыка ${STAGE_SYNC_JOINT} в «До ТО»`,
  }).click()
  await page.getByRole('button', { name: 'Возобновить ПСТО', exact: true }).click()
  await closePstoLineProgram(page)
  await expectDatabaseWeld('F9', { psto_required: 'да' })
  await expectVikStageEverywhere(page, {
    joint: STAGE_SYNC_JOINT,
    line: STAGE_SYNC_TARGET_LINE,
    stage: 'beforeHeatTreatment',
    titles,
    completed: true,
  })
})

test('не назначает ПСТО по устаревшему составу линии при одновременном добавлении стыка', async ({ page }) => {
  test.setTimeout(120_000)
  await seedConcurrentPstoLine()
  await openPstoLineProgram(page, CONCURRENT_PSTO_LINE)
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Назначение ПСТО' })).toBeVisible()

  const [lockKey] = getWeldLineMembershipLockKeys([{
    projectTitle: CONCURRENT_PSTO_PROJECT,
    subtitleCode: CONCURRENT_PSTO_SUBTITLE,
    line: CONCURRENT_PSTO_LINE,
  }])
  expect(lockKey).toBeTruthy()

  await withE2eDatabase(async (client) => {
    let committed = false
    await client.query('begin')
    try {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey])
      await client.query(`
        insert into weld_joints (
          weld_date, project_title, subtitle_code, line, isometry, joint, spool,
          officiality, revision_actuality, welding_method, connection_type, material_group,
          d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, final_status,
          welding_updated_at, lnk_created_at, lnk_updated_at, psto_created_at, psto_updated_at
        ) values (
          '2026-08-24', $1, $2, $3, 'ISO-E2E-10-B', 'F10-B', 'E2E-S10',
          'действующий', 'актуальная', 'РД', 'СШ', 'M01',
          108, 108, 4, 4, 0.42, 'E2K10', 'E2K10', 'годен',
          now(), now(), now(), now(), now()
        )
      `, [CONCURRENT_PSTO_PROJECT, CONCURRENT_PSTO_SUBTITLE, CONCURRENT_PSTO_LINE])

      const submit = page.getByRole('button', { name: 'Назначить ПСТО', exact: true })
      await submit.click()
      await expect(submit).toBeDisabled()
      await expect.poll(async () => {
        const result = await client.query(`
          select count(*)::int as count
          from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and wait_event_type = 'Lock'
            and wait_event = 'advisory'
        `)
        return Number(result.rows[0]?.count ?? 0)
      }, { timeout: 15_000 }).toBeGreaterThan(0)

      await client.query('commit')
      committed = true
    } finally {
      if (!committed) await client.query('rollback')
    }
  })

  await expect(page.getByRole('status')).toContainText('Открытые данные устарели')
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const result = await client.query(`
      select joint, psto_required
      from weld_joints
      where project_title = $1 and subtitle_code = $2 and line = $3
      order by joint
    `, [CONCURRENT_PSTO_PROJECT, CONCURRENT_PSTO_SUBTITLE, CONCURRENT_PSTO_LINE])
    return result.rows
  })).toEqual([
    { joint: 'F10-A', psto_required: null },
    { joint: 'F10-B', psto_required: null },
  ])
})

type VikDocumentTitles = {
  request: string
  conclusion: string
}

type ExpectedVikStage = 'primary' | 'beforeHeatTreatment'

async function showOnlyStageSynchronizationFields(page: Page) {
  const visibleFieldKeys = new Set([
    'line',
    'joint',
    'pstoRequired',
    'vikRequest',
    'vikResult',
    'vikConclusion',
    'preVikRequest',
    'preVikResult',
    'preVikConclusion',
  ])
  const hiddenFieldKeys = LNK_VISIBLE_FIELD_SECTIONS
    .flatMap((section) => section.fields.map((field) => field.key))
    .filter((fieldKey) => !visibleFieldKeys.has(fieldKey))

  await page.addInitScript(({ storageKey, hiddenFields }) => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      activePreset: 'custom',
      hiddenFieldKeys: hiddenFields,
      customHiddenFieldKeys: hiddenFields,
      collapsedSections: [],
      savedViews: [],
    }))
  }, { storageKey: LNK_REPORT_VIEW_STORAGE_KEY, hiddenFields: hiddenFieldKeys })
}

async function openReport(page: Page, label: string, path: string) {
  await page.goto(path)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.locator('header').getByRole('heading', { name: label, exact: true })).toBeVisible()
}

async function openPstoLineProgram(page: Page, line: string) {
  await openReport(page, 'Термообработка', '/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  const program = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Программа ПСТО' }),
  })
  await expect(program).toBeVisible()
  await program.getByLabel('Поиск линий', { exact: true }).fill(line)
  await expect(program.getByText(line, { exact: true })).toBeVisible()
}

async function closePstoLineProgram(page: Page) {
  const program = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Программа ПСТО' }),
  })
  await expect(program).toBeVisible()
  await program.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(program).toBeHidden()
}

async function openLnkDocumentRow(page: Page, title: string, type: 'request' | 'conclusion') {
  await openReport(page, 'Документы', '/documents')
  await page.getByRole('button', {
    name: type === 'request' ? 'Заявка ЛНК' : 'Заключения ЛНК',
    exact: true,
  }).click()
  const titleText = page.getByText(title, { exact: true }).first()
  await expect(titleText).toBeVisible()
  const row = titleText.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " grid ")][1]',
  )
  await expect(row).toBeVisible()
  return row
}

async function expectVikStageEverywhere(page: Page, {
  joint,
  line,
  stage,
  titles,
  pstoRequired = 'да',
  completed = false,
}: {
  joint: string
  line: string
  stage: ExpectedVikStage
  titles: VikDocumentTitles
  pstoRequired?: string | null
  completed?: boolean
}) {
  await expectStoredVikStage({ joint, line, stage, titles, pstoRequired, completed })
  await expectDocumentStage(joint, titles.request, stage === 'beforeHeatTreatment' ? 'beforeHeatTreatment' : undefined)
  if (completed) {
    await expectDocumentStage(joint, titles.conclusion, stage === 'beforeHeatTreatment' ? 'beforeHeatTreatment' : undefined)
  }

  await openReport(page, 'ЛНК', '/lnk')
  const lnkRow = page
    .getByRole('button', { name: `Выбрать стык ${joint}`, exact: true })
    .locator('xpath=ancestor::tr')
  await expect(lnkRow).toBeVisible()
  await expect(lnkRow.locator('td[data-weld-field-key="line"]')).toHaveText(line)
  await expect(lnkRow.locator('td[data-weld-field-key="pstoRequired"]')).toHaveText(pstoRequired ?? '')
  await expectVikCells(lnkRow, stage, titles, pstoRequired, completed)

  const documentRow = await openLnkDocumentRow(
    page,
    completed ? titles.conclusion : titles.request,
    completed ? 'conclusion' : 'request',
  )
  await expect(documentRow.getByText(stage === 'primary' ? 'Основной' : 'До ТО', { exact: true })).toBeVisible()
  await expect(documentRow.getByText(line, { exact: true })).toBeVisible()
}

async function expectVikCells(
  row: Locator,
  stage: ExpectedVikStage,
  titles: VikDocumentTitles,
  pstoRequired: string | null,
  completed: boolean,
) {
  const pendingPrimaryResult = pstoRequired === 'да' ? 'ожидает заявку' : ''
  const activeResult = completed ? 'годен' : 'ожидает НК'
  const activeConclusion = completed ? titles.conclusion : ''
  const primaryValues = stage === 'primary'
    ? { vikRequest: titles.request, vikResult: activeResult, vikConclusion: activeConclusion }
    : { vikRequest: '', vikResult: pendingPrimaryResult, vikConclusion: '' }
  const preValues = stage === 'beforeHeatTreatment'
    ? { preVikRequest: titles.request, preVikResult: activeResult, preVikConclusion: activeConclusion }
    : { preVikRequest: '', preVikResult: '', preVikConclusion: '' }

  for (const [fieldKey, expectedValue] of Object.entries({ ...primaryValues, ...preValues })) {
    await expect(row.locator(`td[data-weld-field-key="${fieldKey}"]`)).toHaveText(expectedValue)
  }
}

async function expectStoredVikStage({
  joint,
  line,
  stage,
  titles,
  pstoRequired,
  completed,
}: {
  joint: string
  line: string
  stage: ExpectedVikStage
  titles: VikDocumentTitles
  pstoRequired: string | null
  completed: boolean
}) {
  const activeResult = completed ? 'годен' : 'ожидает НК'
  const activeConclusionDate = completed ? '2026-08-21' : null
  const activeConclusion = completed ? titles.conclusion : null
  const activeDefectDescription = completed ? 'ДНО' : null
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const weld = await client.query(`
      select id, line, psto_required, vik_request, vik_request_date, vik_result,
             vik_conclusion_date, vik_conclusion, vik_defect_description
      from weld_joints
      where joint = $1
    `, [joint])
    const controls = await client.query(`
      select method, request_name, request_date, result, conclusion_date,
             conclusion_name, defect_description
      from pre_heat_treatment_controls
      where weld_joint_id = $1 and method = 'ВИК'
      order by id
    `, [weld.rows[0]?.id])
    return {
      weld: pick(weld.rows[0] ?? {}, [
        'line',
        'psto_required',
        'vik_request',
        'vik_request_date',
        'vik_result',
        'vik_conclusion_date',
        'vik_conclusion',
        'vik_defect_description',
      ]),
      controls: controls.rows.map((control) => pick(control, [
        'method',
        'request_name',
        'request_date',
        'result',
        'conclusion_date',
        'conclusion_name',
        'defect_description',
      ])),
    }
  })).toEqual(stage === 'primary'
    ? {
        weld: {
          line,
          psto_required: pstoRequired,
          vik_request: titles.request,
          vik_request_date: '2026-08-20',
          vik_result: activeResult,
          vik_conclusion_date: activeConclusionDate,
          vik_conclusion: activeConclusion,
          vik_defect_description: activeDefectDescription,
        },
        controls: [],
      }
    : {
        weld: {
          line,
          psto_required: pstoRequired,
          vik_request: null,
          vik_request_date: null,
          vik_result: null,
          vik_conclusion_date: null,
          vik_conclusion: null,
          vik_defect_description: null,
        },
        controls: [{
          method: 'ВИК',
          request_name: titles.request,
          request_date: '2026-08-20',
          result: activeResult,
          conclusion_date: activeConclusionDate,
          conclusion_name: activeConclusion,
          defect_description: activeDefectDescription,
        }],
      })
}

async function loadVikDocumentTitles(joint: string, requireConclusion = false): Promise<VikDocumentTitles> {
  let titles: VikDocumentTitles = { request: '', conclusion: '' }
  await expect.poll(async () => {
    titles = await withE2eDatabase(async (client) => {
      const result = await client.query<{
        vik_request: string | null
        vik_conclusion: string | null
        pre_request: string | null
        pre_conclusion: string | null
      }>(`
        select weld.vik_request, weld.vik_conclusion,
               control.request_name as pre_request,
               control.conclusion_name as pre_conclusion
        from weld_joints weld
        left join pre_heat_treatment_controls control
          on control.weld_joint_id = weld.id and control.method = 'ВИК'
        where weld.joint = $1
      `, [joint])
      return {
        request: result.rows[0]?.vik_request ?? result.rows[0]?.pre_request ?? '',
        conclusion: result.rows[0]?.vik_conclusion ?? result.rows[0]?.pre_conclusion ?? '',
      }
    })
    return Boolean(titles.request && (!requireConclusion || titles.conclusion))
  }).toBe(true)
  return titles
}

async function fillDate(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true })
  await expect(input).toBeVisible()
  await input.fill(value)
  await expect(input).toHaveValue(value)
}

async function runNextAction(page: Page, title: string, joint = JOINT) {
  const row = page
    .getByRole('button', { name: `Выбрать стык ${joint}`, exact: true })
    .locator('xpath=ancestor::tr')
  const button = row.getByRole('button', { name: `Выполнить: ${title}`, exact: true })
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
}

async function expectRepeatedJointCreateTask(page: Page, sourceJoint: string, targetJoint: string) {
  const codeGroup = page.locator('details').filter({ hasText: 'ДЗ-07' }).first()
  await expect(codeGroup).toBeVisible({ timeout: 15_000 })
  await openDetails(codeGroup)

  const nestedObjectGroup = codeGroup.locator('details').filter({ hasText: targetJoint }).first()
  const taskButton = codeGroup.getByRole('button', {
    name: new RegExp(
      `^${escapeRegExp(sourceJoint)} Создать повторный стык.*${escapeRegExp(targetJoint)}`,
    ),
  }).first()
  await expect.poll(async () => (
    await taskButton.count() + await nestedObjectGroup.count()
  ), { timeout: 5_000 }).toBeGreaterThan(0)
  if (await taskButton.count() === 0) await openDetails(nestedObjectGroup)
  await expect(taskButton).toBeVisible()
}

async function expectRepeatedJointCreateTaskToDisappear(page: Page, targetJoint: string) {
  await expect.poll(async () => page.getByText(targetJoint, { exact: true }).count(), { timeout: 15_000 }).toBe(0)
}

async function openDetails(details: ReturnType<Page['locator']>) {
  if (await details.evaluate((element) => element instanceof HTMLDetailsElement && element.open)) return
  await details.locator('summary').first().click()
  await expect(details).toHaveJSProperty('open', true)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

async function expectDocumentStage(joint: string, title: string, sourceKind: string | undefined) {
  await expect.poll(async () => withE2eDatabase(async (client) => {
    const documents = await client.query<{ source_metadata: string | null }>(`
      select document.source_metadata
      from generated_documents document
      inner join generated_document_weld_joints assignment on assignment.document_id = document.id
      inner join weld_joints weld on weld.id = assignment.weld_joint_id
      where weld.joint = $1 and document.title = $2
    `, [joint, title])
    return documents.rows.map((document) => {
      try {
        return JSON.parse(document.source_metadata ?? '{}').sourceKind ?? null
      } catch {
        return 'invalid-metadata'
      }
    })
  })).toEqual([sourceKind ?? null])
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
        officiality, revision_actuality, welding_method, connection_type, material_group,
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
        officiality, revision_actuality, welding_method, connection_type, material_group,
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
        officiality, revision_actuality, welding_method, connection_type, material_group,
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
        officiality, revision_actuality, welding_method, connection_type, material_group,
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

async function seedStageSynchronizationLines() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, psto_required, final_status, welding_updated_at,
        lnk_created_at, lnk_updated_at, psto_created_at, psto_updated_at
      ) values (
        '2026-08-19', 'E2E синхронизация этапа', 'E2E-008', $1,
        'ISO-E2E-8', $2, 'E2E-S8', 'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2K8', 'E2K8', 'да', 'проект', null,
        'ожидает заявку', now(), now(), now(), now(), now()
      ), (
        '2026-08-19', 'E2E синхронизация этапа', 'E2E-008', $3,
        'ISO-E2E-9', 'F9', 'E2E-S9', 'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2K9', 'E2K9', null, null, null,
        'годен', now(), now(), now(), now(), now()
      )
    `, [STAGE_SYNC_SOURCE_LINE, STAGE_SYNC_JOINT, STAGE_SYNC_TARGET_LINE])
    await client.query(`
      insert into welder_stamps (
        naks_stamp, welder_name, weld_type, material_groups,
        diameter_from, diameter_to, thickness_from, thickness_to,
        valid_from, valid_to, naks_permits
      ) values (
        'E2K8', 'E2E сварщик 8', 'РД', 'M01',
        '1', '1000', '1', '100', '2026-01-01', '2026-12-31',
        '[{"id":"e2e-naks-8","weldType":"РД","materialGroups":"M01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","note":"","archived":false}]'
      )
    `)
  })
}

async function seedConcurrentPstoLine() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at, psto_created_at, psto_updated_at
      ) values (
        '2026-08-24', $1, $2, $3, 'ISO-E2E-10-A', 'F10-A', 'E2E-S10',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'E2K10', 'E2K10', 'годен',
        now(), now(), now(), now(), now()
      )
    `, [CONCURRENT_PSTO_PROJECT, CONCURRENT_PSTO_SUBTITLE, CONCURRENT_PSTO_LINE])
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
