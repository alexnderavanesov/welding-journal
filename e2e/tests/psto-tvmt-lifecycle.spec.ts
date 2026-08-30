import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const JOINT = 'F1'
const CANCELLED_CYCLE_JOINT = 'F2'
const LATE_ASSIGNMENT_JOINT = 'F3'
const REACTIVATED_JOINT = 'F4'

test('НК до ТО -> ПСТО -> негодная ТВМТ -> повтор -> основной НК -> ремонт -> исправление', async ({ page }) => {
  await page.goto('/lnk')
  await expect(page.getByText(JOINT, { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Создать заявку ЛНК на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-02')
  await page.getByRole('button', { name: 'Создать заявку до ТО' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО' })).toBeHidden()
  await expectDatabaseRow('pre_heat_treatment_controls', {
    method: 'ВИК',
    request_date: '2026-08-02',
  })

  await page.getByRole('button', { name: 'Добавить результат ЛНК на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeVisible()
  await fillDate(page, 'Дата контроля', '2026-08-03')
  await page.getByRole('button', { name: 'годен', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат до ТО' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeHidden()
  await expectDatabaseRow('pre_heat_treatment_controls', {
    result: 'годен',
    conclusion_date: '2026-08-03',
  })

  await page.goto('/psto')
  await expect(page.getByText(JOINT, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Создать заявку ПСТО на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-04')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeHidden()
  await expectWeld({
    psto_request_date: '2026-08-04',
    psto_result: null,
    final_status: 'ожидает НК',
  })

  await page.getByRole('button', { name: 'Добавить результат ПСТО на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата ПСТО', '2026-08-05')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeHidden()
  await expectWeld({ psto_date: '2026-08-05', psto_result: 'проведено' })

  await openHeaderMenuItem(page, 'ТВМТ', 'Новая заявка ТВМТ')
  await expect(page.getByRole('heading', { name: 'Заявка ТВМТ' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-06')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ТВМТ' })).toBeHidden()
  await expectWeld({ tvmt_request_date: '2026-08-06', tvmt_result: 'ожидает НК' })

  await openHeaderMenuItem(page, 'ТВМТ', 'Внести результаты ТВМТ')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeVisible()
  await fillDate(page, 'Дата ТВМТ', '2026-08-07')
  await chooseOptionByLabel(page, 'Результат для выбранных', 'не годен')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeHidden()
  await expectWeld({ tvmt_result: 'не годен', tvmt_conclusion_date: '2026-08-07' })

  await openHeaderMenuItem(page, 'Заявка', 'Новая заявка')
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-08')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО' })).toBeHidden()
  await expectRepeatCycle({ sequence: 2, psto_request_date: '2026-08-08' })

  await openHeaderMenuItem(page, 'Результат', 'Внести результаты')
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeVisible()
  await fillDate(page, 'Дата ПСТО', '2026-08-09')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ПСТО' })).toBeHidden()
  await expectRepeatCycle({ sequence: 2, psto_date: '2026-08-09', psto_result: 'проведено' })

  await openHeaderMenuItem(page, 'ТВМТ', 'Новая заявка ТВМТ')
  await fillDate(page, 'Дата заявки', '2026-08-10')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expectRepeatCycle({ sequence: 2, tvmt_request_date: '2026-08-10' })

  await openHeaderMenuItem(page, 'ТВМТ', 'Внести результаты ТВМТ')
  await fillDate(page, 'Дата ТВМТ', '2026-08-11')
  await chooseOptionByLabel(page, 'Результат для выбранных', 'годен')
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expectRepeatCycle({ sequence: 2, tvmt_result: 'годен', tvmt_conclusion_date: '2026-08-11' })

  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Создать заявку ЛНК на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ЛНК' })).toBeVisible()
  await fillDate(page, 'Дата заявки', '2026-08-12')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expectWeld({ vik_request_date: '2026-08-12', vik_result: 'ожидает НК' })

  await page.getByRole('button', { name: 'Добавить результат ЛНК на этот стык' }).click()
  await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК' })).toBeVisible()
  await chooseOptionByLabel(page, 'Метод контроля', 'ВИК')
  await fillDate(page, 'Дата контроля', '2026-08-13')
  await page.getByRole('button', { name: 'ремонт', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить результат' }).click()
  await expectWeld({ vik_result: 'ремонт', vik_conclusion_date: '2026-08-13' })
  await expect(page.getByText('Создать F1R1', { exact: true })).toBeVisible({ timeout: 15_000 })

  await openHeaderMenuItem(page, 'Результат', 'Все результаты ЛНК')
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`E2E-L1 · ${JOINT}`) }).click()
  await page.getByRole('button', { name: 'годен', exact: true }).last().click()
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(page.getByRole('heading', { name: 'Редактирование результатов ЛНК' })).toBeHidden()
  await expectWeld({ vik_result: 'годен', vik_conclusion_date: '2026-08-13' })
  await expect(page.getByText('Создать F1R1', { exact: true })).toBeHidden({ timeout: 15_000 })
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

test('позднее назначение ПСТО переносит основной комплект в НК до ТО только после подтверждения', async ({ page }) => {
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
  await page.getByRole('button', { name: /Перенести перечисленные комплекты в «НК до ТО»/ }).click()
  await expect(submit).toBeEnabled()
  await submit.click()

  await expectDatabaseWeld(LATE_ASSIGNMENT_JOINT, {
    psto_required: 'да',
    vik_request: null,
    vik_request_date: null,
    vik_result: null,
    vik_conclusion_date: null,
    vik_conclusion: null,
    final_status: 'ожидает заявку',
  })
  await expectPreControl(LATE_ASSIGNMENT_JOINT, {
    method: 'ВИК',
    request_name: 'Заявка ВИК основная E2E-3',
    request_date: '2026-08-02',
    result: 'годен',
    conclusion_date: '2026-08-03',
    conclusion_name: 'Заключение ВИК основное E2E-3',
  })
  await expectDocumentStage(
    LATE_ASSIGNMENT_JOINT,
    'Заявка ВИК основная E2E-3',
    'beforeHeatTreatment',
  )
})

test('возобновление отмененной линии использует ту же защищенную подготовку НК', async ({ page }) => {
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
  await page.getByRole('button', { name: /Перенести перечисленные комплекты в «НК до ТО»/ }).click()
  await submit.click()

  await expectDatabaseWeld(REACTIVATED_JOINT, {
    psto_required: 'да',
    psto_cancellation_date: null,
    psto_control_basis: null,
    vik_request: null,
    vik_result: null,
    final_status: 'ожидает заявку',
  })
  await expectPreControl(REACTIVATED_JOINT, {
    method: 'ВИК',
    request_name: 'Заявка ВИК основная E2E-4',
    result: 'годен',
    conclusion_name: 'Заключение ВИК основное E2E-4',
  })
  await expectDatabaseWeld('F5', {
    psto_required: 'да',
    psto_cancellation_date: null,
    psto_result: 'проведено',
    tvmt_result: 'годен',
  })
})

async function fillDate(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true })
  await expect(input).toBeVisible()
  await input.fill(value)
  await expect(input).toHaveValue(value)
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
