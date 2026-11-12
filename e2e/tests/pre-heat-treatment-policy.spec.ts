import { lnkRow as lnkGridRow, revealLnkColumn, lnkActionRow } from './lnk-grid-helpers'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test('НК до ТО: PostgreSQL и серверные правила совпадают после снятия и установки отметки', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-pre-heat-treatment-policy.ts'], {
    env: { ...process.env, FORCE_COLOR: undefined, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toMatchObject({ comparisons: 510, obsoleteFlagsUnchanged: true, settingLookupFree: true, fixtureRolledBack: true })
})

for (const historical of [false, true]) test(`НК до ТО доступен: ${historical ? 'исторический стык с завершённой ПСТО' : 'старый флаг и «ожидает заявку»'}`, async ({ page }) => {
  const joint = historical ? 'E2E-F52-history' : 'E2E-F43-legacy'
  let id = 0
  try {
    id = await withE2eDatabase(async (client) => {
      const result = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik,
        pre_heat_treatment_lnk_exempt, pre_heat_treatment_required, psto_result, officiality, material_group, connection_type,
        welding_method, d1, d2, t1, t2, wdi, vik_control_basis
      ) values ($1, 'E2E legacy pre-TO', 'P', '330-P42/P59-01-000', '2026-09-16', 'да', 'да',
        true, true, 'ожидает заявку', 'действующий', 'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект') returning id`, [joint])
      return result.rows[0].id
    })
    if (historical) await withE2eDatabase(async (client) => {
      await client.query(`update weld_joints set psto_request = 'P-HISTORY', psto_request_date = '2026-09-19',
        psto_result = 'проведено', psto_date = '2026-09-20', heat_treatment_diagram = 'D-HISTORY',
        tvmt_request = 'T-HISTORY', tvmt_request_date = '2026-09-20', tvmt_result = 'годен',
        tvmt_conclusion_date = '2026-09-20', tvmt_conclusion = 'C-HISTORY' where id = $1`, [id])
    })
    await page.goto('/lnk')
    // Other scenarios leave hundreds of rows: locate this joint through server search,
    // not by assuming it is rendered on the first virtualized page.
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
    await revealLnkColumn(page, 'jointNextAction')
    const row = () => lnkGridRow(page, joint)
    await row().getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeVisible()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-17')
    await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeHidden()
    await row().getByRole('button', { name: 'Выполнить: Внести результат НК до ТО', exact: true }).click()
    await page.getByLabel('Дата контроля', { exact: true }).fill('2026-09-18')
    await page.getByRole('dialog').getByRole('group', { name: 'Результат для всех выбранных', exact: true })
      .getByRole('button', { name: 'годен', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить результат до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeHidden()
    await expect(row().getByRole('button', { name: historical ? 'Выполнить: Создать заявку основного НК' : 'Выполнить: Создать заявку ПСТО', exact: true })).toBeVisible()
    await expect.poll(() => withE2eDatabase(async (client) => (await client.query('select result from pre_heat_treatment_controls where weld_joint_id = $1', [id])).rows)).toEqual([{ result: 'годен' }])
    const audit = await withE2eDatabase(async db => (await db.query(`select changes from audit_changes
      where joint_id=$1 and entity='pre_heat_treatment_controls' and changes ? 'result' order by id desc limit 1`, [id])).rows[0])
    expect(audit.changes.result.origin).toBe('user')
    expect(audit.changes.conclusionDate.origin).toBe('user')
    expect(audit.changes.conclusionName.origin).toBe('automatic')
    expect(audit.changes.defectDescription.origin).toBe('automatic')
    if (historical) await expect.poll(() => withE2eDatabase(async (client) => (await client.query('select psto_request, heat_treatment_diagram, tvmt_conclusion, pre_heat_treatment_lnk_exempt from weld_joints where id = $1', [id])).rows)).toEqual([
      { psto_request: 'P-HISTORY', heat_treatment_diagram: 'D-HISTORY', tvmt_conclusion: 'C-HISTORY', pre_heat_treatment_lnk_exempt: true },
    ])
  } finally {
    await page.close()
    if (id) await withE2eDatabase(async (client) => { await client.query('delete from weld_joints where id = $1', [id]) })
  }
})

test('открытая заявка не обходит выключение этапа другим пользователем', async ({ page }) => {
  const joint = 'E2E-PRE-STALE-SETTING'
  let id = 0
  try {
    id = await withE2eDatabase(async (client) => {
      const inserted = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik, officiality,
        material_group, connection_type, welding_method, d1, d2, t1, t2, wdi, vik_control_basis, pre_heat_treatment_required
      ) values ($1, 'E2E stale setting', 'P', 'L-STALE', '2026-09-16', 'да', 'да', 'действующий',
        'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект',true) returning id`, [joint])
      return inserted.rows[0].id
    })
    await page.goto('/lnk')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(joint)
    const row = await lnkActionRow(page, joint)
    await row.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeVisible()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-17')
    await expect(page.getByRole('button', { name: 'Создать заявку до ТО', exact: true })).toBeEnabled()
    await withE2eDatabase(async (client) => {
      await client.query('update weld_joints set pre_heat_treatment_required=false where id=$1', [id])
    })
    await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
    // The operator now changes the joint itself, not a global setting; its
    // version guard must reject the stale dialog before checking the stage.
    await expect(page.getByText('Стык L-STALE · E2E-PRE-STALE-SETTING уже изменен другим пользователем или в другом окне. Ничего не сохранено. Обновите отчет и повторите действие.', { exact: true })).toBeVisible()
    expect(await withE2eDatabase(async (client) => (await client.query('select id from pre_heat_treatment_controls where weld_joint_id = $1', [id])).rows)).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async (client) => {
      if (id) await client.query('delete from weld_joints where id = $1', [id])
    })
  }
})
