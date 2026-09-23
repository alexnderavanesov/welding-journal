import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const SOURCE_JOINT = 'F5'
const SECOND_JOINT = 'F6'

test('точное исправление ZV возвращает черновик и меняет дату всего документа атомарно', async ({ page }) => {
  test.setTimeout(120_000)
  await seedChronologyRows()

  await page.goto('/lnk')
  await runNextAction(page, SOURCE_JOINT, 'Создать заявку основного НК')
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК' })).toBeVisible()

  const requestDate = page.getByLabel('Дата заявки', { exact: true })
  await requestDate.fill('2026-07-31')
  await expect(page.getByRole('button', { name: 'Исправить дату заявки ВИК' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Исправить дату ПСТО' })).toBeHidden()
  await page.getByRole('button', { name: 'Исправить дату заявки ВИК' }).click()
  await expect(requestDate).toBeFocused()
  await expect(page.getByRole('checkbox', { name: `Выбрать стык E2E-ROOT-L1 ${SOURCE_JOINT}`, exact: true })).toBeChecked()

  await page.getByRole('button', { name: 'Очистить', exact: true }).click()
  await page.getByRole('checkbox', { name: `Выбрать стык E2E-ROOT-L1 ${SECOND_JOINT}`, exact: true }).click()
  await requestDate.fill('2026-08-09')
  await expect(page.getByRole('button', { name: 'Исправить дату ПСТО' })).toBeHidden()
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК' })).toBeHidden()

  const initialRows = await loadVikRequests()
  expect(initialRows).toHaveLength(2)
  expect(initialRows.every((row) => row.vik_request_date === '2026-08-09')).toBe(true)
  expect(new Set(initialRows.map((row) => row.vik_request)).size).toBe(1)
  const previousTitle = initialRows[0]!.vik_request

  await openHeaderMenuItem(page, 'Заявка', 'Все заявки ЛНК')
  await expect(page.getByRole('heading', { name: 'Редактирование заявок ЛНК' })).toBeVisible()
  const requestCard = page.getByText(previousTitle, { exact: true }).first().locator('xpath=ancestor::button')
  await expect(requestCard).toBeVisible()
  await requestCard.click()
  await requestCard.click({ button: 'right' })
  await page.getByRole('button', { name: 'Изменить дату заявки', exact: true }).click()

  const documentDate = page.getByLabel('Дата заявки ЛНК', { exact: true })
  await expect(documentDate).toHaveValue('2026-08-09')
  await documentDate.fill('2026-08-31')
  await expect(page.getByText(/Будет изменено позиций: 2; стыков: 2/)).toBeVisible()
  await page.getByRole('button', { name: 'Изменить дату', exact: true }).click()

  const confirmation = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Изменить дату документа' }),
  })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Изменить дату', exact: true }).click()

  await expect.poll(loadVikRequests).toEqual([
    expect.objectContaining({ joint: SOURCE_JOINT, vik_request_date: '2026-08-31' }),
    expect.objectContaining({ joint: SECOND_JOINT, vik_request_date: '2026-08-31' }),
  ])
  const savedRows = await loadVikRequests()
  expect(new Set(savedRows.map((row) => row.vik_request)).size).toBe(1)
  expect(savedRows[0]!.vik_request).toBe(previousTitle)
  await expect(page.getByPlaceholder('Новое наименование заявки', { exact: true })).toBeDisabled()

  // A concurrent change of one position must prevent changes to every position.
  await documentDate.fill('2026-09-01')
  await withE2eDatabase(async (client) => {
    await client.query("update weld_joints set updated_at = updated_at + interval '1 second' where project_title = 'E2E точное исправление' and joint = $1", [SECOND_JOINT])
  })
  await page.getByRole('button', { name: 'Изменить дату', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Изменить дату', exact: true }).click()
  await expect(page.getByText(/уже изменен другим пользователем/).first()).toBeVisible()
  expect(await loadVikRequests()).toEqual(savedRows)
})

async function runNextAction(page: Page, joint: string, title: string) {
  const row = page.locator('tr')
    .filter({ has: page.getByText('E2E-ROOT-L1', { exact: true }) })
    .filter({ has: page.getByText(joint, { exact: true }) })
  const button = row.getByRole('button', { name: `Выполнить: ${title}`, exact: true })
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
}

async function openHeaderMenuItem(page: Page, menu: string, item: string) {
  await page.locator('header').getByRole('button', { name: menu, exact: true }).click()
  await page.getByRole('button', { name: item, exact: true }).click()
}

async function loadVikRequests() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      joint: string
      vik_request: string
      vik_request_date: string
    }>(`
      select joint, vik_request, vik_request_date::text
      from weld_joints
      where project_title = 'E2E точное исправление'
      order by joint
    `)
    return result.rows
  })
}

async function seedChronologyRows() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik,
        vik_control_basis, psto_required, psto_request, psto_request_date,
        psto_date, heat_treatment_diagram, psto_result, tvmt_request,
        tvmt_request_date, tvmt_result, tvmt_conclusion_date, tvmt_conclusion,
        final_status, welding_updated_at, psto_created_at, psto_updated_at,
        lnk_created_at, lnk_updated_at
      ) values
      (
        '2026-08-01', 'E2E точное исправление', 'E2E-ROOT', 'E2E-ROOT-L1', 'ISO-ROOT-1', 'F5', 'ROOT-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'ROOT-K1', 'ROOT-K1', 'да',
        'проект', 'да', 'Заявка ПСТО ROOT', '2026-08-20',
        '2026-08-29', 'Диаграмма ПСТО ROOT', 'проведено', 'Заявка ТВМТ ROOT',
        '2026-08-29', 'годен', '2026-08-30', 'Заключение ТВМТ ROOT',
        'ожидает заявку', now(), now(), now(), now(), now()
      ),
      (
        '2026-08-01', 'E2E точное исправление', 'E2E-ROOT', 'E2E-ROOT-L1', 'ISO-ROOT-2', 'F6', 'ROOT-S2',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42, 'ROOT-K2', 'ROOT-K2', 'да',
        'проект', 'да', 'Заявка ПСТО ROOT', '2026-08-20',
        '2026-08-29', 'Диаграмма ПСТО ROOT', 'проведено', 'Заявка ТВМТ ROOT',
        '2026-08-29', 'годен', '2026-08-30', 'Заключение ТВМТ ROOT',
        'ожидает заявку', now(), now(), now(), now(), now()
      )
    `)
    await client.query(`
      insert into pre_heat_treatment_controls (
        weld_joint_id, method, request_name, request_date,
        result, conclusion_date, conclusion_name
      )
      select
        id, 'ВИК', 'Заявка ВИК до ТО ROOT', '2026-08-02',
        'годен', '2026-08-03', 'Заключение ВИК до ТО ROOT'
      from weld_joints
      where project_title = 'E2E точное исправление'
    `)
  })
}
