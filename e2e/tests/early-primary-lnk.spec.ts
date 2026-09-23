import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { REQUEST_CONCLUSION_DEFAULT_SETTINGS } from '@/lib/request-conclusion-settings'
import { eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'

test('историческая заявка переименовывается, ТВМТ довносится между заявкой и результатом ВИК', async ({ page }) => {
  const joint = 'F543'
  let id = 0
  let previousNaming: { value: string; updated_at: Date } | undefined
  try {
    await withE2eDatabase(async (client) => {
      previousNaming = (await client.query("select value, updated_at from app_settings where key = 'request-conclusion'")).rows[0]
      const settings = { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS, lnkRequest: { ...REQUEST_CONCLUSION_DEFAULT_SETTINGS.lnkRequest, systemPattern: '{{Проект}}-{{№}}' } }
      await client.query("insert into app_settings (key, value) values ('request-conclusion', $1) on conflict (key) do update set value = excluded.value", [JSON.stringify(settings)])
    })
    id = await seedJoint(joint, true)
    await page.goto('/lnk')
    await page.locator('header').getByRole('button', { name: 'Заявка', exact: true }).click()
    await page.getByRole('button', { name: 'Все заявки ЛНК', exact: true }).click()
    const card = page.getByText('1503-2', { exact: true }).first().locator('xpath=ancestor::button')
    await card.click()
    await card.click({ button: 'right' })
    await page.getByRole('button', { name: 'Переименовать заявку', exact: true }).click()
    await page.getByLabel('Дата заявки ЛНК', { exact: true }).fill('2026-03-16')
    await page.getByRole('button', { name: 'Изменить дату', exact: true }).click()
    const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Изменить дату документа' }) })
    await expect(confirmation).toContainText('Полное наименование документа останется без изменений')
    await confirmation.getByRole('button', { name: 'Изменить дату', exact: true }).click()
    await expect.poll(() => readJoint(id)).toMatchObject({ vik_request: '1503-2', vik_request_date: '2026-03-16' })
    await page.getByPlaceholder('Новое наименование заявки', { exact: true }).fill('1503-2 исправлено')
    await page.getByRole('button', { name: 'Переименовать', exact: true }).click()
    await expect.poll(() => readJoint(id)).toMatchObject({ vik_request: '1503-2 исправлено', vik_request_date: '2026-03-16' })

    await page.goto('/psto')
    const row = page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
    await row.getByRole('button', { name: 'Выполнить: Внести результат ТВМТ · цикл 1', exact: true }).click()
    await page.getByLabel('Дата ТВМТ', { exact: true }).fill('2026-03-20')
    await page.getByLabel('Результат для выбранных', { exact: true }).selectOption({ label: 'годен' })
    await expect(page.getByRole('button', { name: 'Исправить дату заявки ВИК' })).toBeHidden()
    await page.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeHidden()
    await expect.poll(() => readJoint(id)).toMatchObject({
      tvmt_result: 'годен', tvmt_conclusion_date: '2026-03-20',
      vik_request: '1503-2 исправлено', vik_request_date: '2026-03-16', vik_conclusion_date: '2026-03-25',
    })
  } finally {
    await page.close()
    if (id) await withE2eDatabase(async (client) => { await client.query('delete from weld_joints where id = $1', [id]) })
    await withE2eDatabase(async (client) => {
      if (previousNaming) await client.query("update app_settings set value = $1, updated_at = $2 where key = 'request-conclusion'", [previousNaming.value, previousNaming.updated_at])
      else await client.query("delete from app_settings where key = 'request-conclusion'")
    })
  }
})

test('новая заявка основного ВИК доступна до ПСТО в строгом режиме и не создает СП-01', async ({ page }) => {
  const joint = 'F544'
  let id = 0
  try {
    id = await seedJoint(joint, false)
    await page.goto('/lnk')
    const row = page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
    await row.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
    await page.getByRole('dialog').getByRole('group', { name: 'Этап контроля ЛНК' }).getByRole('button', { name: 'Основной', exact: true }).click()
    // The stage switch is a React transition: wait for the new composer,
    // not a checkbox/date input with the same label in the outgoing one.
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК', exact: true })).toBeVisible()
    const choice = page.getByRole('checkbox', { name: `Выбрать стык E2E-EARLY-L ${joint}`, exact: true })
    await expect(choice).toBeEnabled()
    await choice.check()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-03-15')
    await expect(page.getByLabel('Дата заявки', { exact: true })).toHaveValue('2026-03-15')
    await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК', exact: true })).toBeHidden()
    await expect.poll(() => readJoint(id)).toMatchObject({ vik_request_date: '2026-03-15', vik_result: 'ожидает НК', psto_request: null })
    await expect(row.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true })).toBeVisible()
    await expect.poll(() => withE2eDatabase(async (client) => {
      const state = (await client.query('select source_revision, computed_revision from dispatcher_task_index_state where id = 1')).rows[0]
      return state && state.source_revision === state.computed_revision
    })).toBe(true)
    expect(await withE2eDatabase(async (client) => (await client.query("select code from dispatcher_row_tasks where weld_joint_id = $1 and code in ('СП-01', 'ДЗ-20')", [id])).rows)).toEqual([])
  } finally {
    await page.close()
    if (id) await withE2eDatabase(async (client) => { await client.query('delete from weld_joints where id = $1', [id]) })
  }
})

async function seedJoint(joint: string, historical: boolean) {
  const id = await withE2eDatabase(async (client) => {
    const { rows: [inserted] } = await client.query<{ id: number }>(`insert into weld_joints (
      joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik,
      officiality, revision_actuality, material_group, connection_type, welding_method,
      d1, d2, t1, t2, wdi, vik_control_basis, pre_heat_treatment_lnk_exempt, stamp_1_k, stamp_1_k_fact
    ) values ($1, 'E2E early primary', 'P', 'E2E-EARLY-L', '2026-03-14', 'да', 'да',
      'действующий', 'актуальная', 'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект', $2, 'EARLY-K', 'EARLY-K') returning id`, [joint, historical])
    if (historical) await client.query(`update weld_joints set
      psto_request = 'P-EARLY', psto_request_date = '2026-03-15', psto_date = '2026-03-15',
      psto_result = 'проведено', heat_treatment_diagram = 'D-EARLY',
      tvmt_request = 'T-EARLY', tvmt_request_date = '2026-03-16', tvmt_result = 'ожидает НК',
      vik_request = '1503-2', vik_request_date = '2026-03-15', vik_result = 'годен',
      vik_conclusion = 'V-EARLY', vik_conclusion_date = '2026-03-25' where id = $1`, [inserted.id])
    await client.query('update dispatcher_task_index_state set source_revision = source_revision + 1, full_rebuild = true')
    return inserted.id
  })
  // Raw fixture inserts bypass the normal mutation's document-index sync.
  // Reproduce that sync even when earlier tests already initialized the index.
  await requireDb().transaction(async (tx) => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.id, id))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
  return id
}

async function readJoint(id: number) {
  return withE2eDatabase(async (client) => (await client.query(`select
    vik_request, vik_request_date::text, vik_result, vik_conclusion_date::text,
    tvmt_result, tvmt_conclusion_date::text, psto_request from weld_joints where id = $1`, [id])).rows[0])
}
