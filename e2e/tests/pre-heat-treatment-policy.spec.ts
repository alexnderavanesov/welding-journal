import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test('НК до ТО: PostgreSQL и серверные правила совпадают после выключения и включения', async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verify-pre-heat-treatment-policy.ts'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
  })
  expect(stderr).toBe('')
  expect(JSON.parse(stdout.trim())).toMatchObject({ comparisons: 162, obsoleteFlagsUnchanged: true, settingInitPlan: true, fixtureRolledBack: true })
})

for (const historical of [false, true]) test(`НК до ТО доступен: ${historical ? 'исторический стык с завершённой ПСТО' : 'старый флаг и «ожидает заявку»'}`, async ({ page }) => {
  const joint = historical ? 'E2E-F52-history' : 'E2E-F43-legacy'
  let id = 0
  try {
    id = await withE2eDatabase(async (client) => {
      const result = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik,
        pre_heat_treatment_lnk_exempt, psto_result, officiality, material_group, connection_type,
        welding_method, d1, d2, t1, t2, wdi, vik_control_basis
      ) values ($1, 'E2E legacy pre-TO', 'P', '330-P42/P59-01-000', '2026-09-16', 'да', 'да',
        true, 'ожидает заявку', 'действующий', 'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект') returning id`, [joint])
      return result.rows[0].id
    })
    if (historical) await withE2eDatabase(async (client) => {
      await client.query(`update weld_joints set psto_request = 'P-HISTORY', psto_request_date = '2026-09-19',
        psto_result = 'проведено', psto_date = '2026-09-20', heat_treatment_diagram = 'D-HISTORY',
        tvmt_request = 'T-HISTORY', tvmt_request_date = '2026-09-20', tvmt_result = 'годен',
        tvmt_conclusion_date = '2026-09-20', tvmt_conclusion = 'C-HISTORY' where id = $1`, [id])
    })
    await page.goto('/lnk')
    const row = () => page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
    await row().getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeVisible()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-17')
    await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeHidden()
    await row().getByRole('button', { name: 'Выполнить: Внести результат НК до ТО', exact: true }).click()
    await page.getByLabel('Дата контроля', { exact: true }).fill('2026-09-18')
    await page.getByRole('button', { name: 'годен', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить результат до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО' })).toBeHidden()
    await expect(row().getByRole('button', { name: historical ? 'Выполнить: Создать заявку основного НК' : 'Выполнить: Создать заявку ПСТО', exact: true })).toBeVisible()
    await expect.poll(() => withE2eDatabase(async (client) => (await client.query('select result from pre_heat_treatment_controls where weld_joint_id = $1', [id])).rows)).toEqual([{ result: 'годен' }])
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
  let previousSetting: { value: string; updated_at: Date } | undefined
  let settingChanged = false
  try {
    id = await withE2eDatabase(async (client) => {
      previousSetting = (await client.query('select value, updated_at from app_settings where key = $1', ['control-processes'])).rows[0]
      const inserted = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik, officiality,
        material_group, connection_type, welding_method, d1, d2, t1, t2, wdi, vik_control_basis
      ) values ($1, 'E2E stale setting', 'P', 'L-STALE', '2026-09-16', 'да', 'да', 'действующий',
        'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект') returning id`, [joint])
      return inserted.rows[0].id
    })
    await page.goto('/lnk')
    const row = page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
    await row.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })).toBeVisible()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-17')
    await expect(page.getByRole('button', { name: 'Создать заявку до ТО', exact: true })).toBeEnabled()
    await withE2eDatabase(async (client) => {
      const value = JSON.stringify({ ...JSON.parse(previousSetting?.value ?? '{}'), preHeatTreatmentLnkEnabled: false })
      await client.query(`insert into app_settings (key, value) values ('control-processes', $1)
        on conflict (key) do update set value = excluded.value`, [value])
      settingChanged = true
    })
    await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
    await expect(page.getByText('НК до ТО выключен в настройках проекта. Существующая история доступна только для просмотра.', { exact: true })).toBeVisible()
    expect(await withE2eDatabase(async (client) => (await client.query('select id from pre_heat_treatment_controls where weld_joint_id = $1', [id])).rows)).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async (client) => {
      if (id) await client.query('delete from weld_joints where id = $1', [id])
      if (settingChanged) {
        if (previousSetting) await client.query('update app_settings set value = $1, updated_at = $2 where key = $3', [previousSetting.value, previousSetting.updated_at, 'control-processes'])
        else await client.query('delete from app_settings where key = $1', ['control-processes'])
      }
    })
  }
})
