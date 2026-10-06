import { scrypt } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const CONTROL_SETTINGS_KEY = 'control-processes'
const OTHER_SETTINGS_KEY = 'other'
const SECURITY_SETTINGS_KEY = 'security'
const SETTINGS_PASSWORD = 'e2e-process-settings'
const TEST_PROJECT = 'E2E процессы контроля'
const LAYERED_JOINT = 'F-PROCESS-LAYER'
const PRE_JOINTS = ['F-PRE-A1', 'F-PRE-A2', 'F-PRE-B1', 'F-PRE-B2'] as const

type AppSettingSnapshot = {
  key: string
  value: string
  updated_at: Date
}

type WeldSnapshot = {
  id: number
  pre_heat_treatment_lnk_exempt: boolean
  updated_at: Date
}

let appSettingsSnapshot: AppSettingSnapshot[] = []
let weldSnapshot: WeldSnapshot[] = []

test.beforeEach(async () => {
  await withE2eDatabase(async (client) => {
    appSettingsSnapshot = (await client.query<AppSettingSnapshot>(
      'select key, value, updated_at from app_settings order by key',
    )).rows
    weldSnapshot = (await client.query<WeldSnapshot>(`
      select id, pre_heat_treatment_lnk_exempt, updated_at
      from weld_joints
      order by id
    `)).rows
  })
})

test.afterEach(async ({ page }) => {
  await page.close()
  await restoreDatabaseSnapshot()
})

test('shows the protected process tab before locking and keeps RK exposures there', async ({ page }) => {
  await configureSettingsPassword()
  await configureRkExposureTable()
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()

  const tabButtons = page
    .getByRole('searchbox', { name: 'Поиск по настройкам' })
    .locator('xpath=../following-sibling::div[1]/button')
  await expect.poll(() => tabButtons.allTextContents()).toEqual([
    'Документы',
    'Заявки и заключения',
    'Данные',
    'Системные индексы',
    'Диспетчер задач и напоминаний',
    'Принятые исключения',
    'Проверки при сохранении',
    'Прочее',
    'Процессы контроля',
    'Блокировка',
  ])

  await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()
  await expect(page.getByRole('switch', { name: /^ПВК — только годен/ })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: /^НК до ТО/ })).toBeChecked()
  await expect(page.getByRole('switch', { name: /^Разрешать основной НК/ })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: /^Разрешать основной НК/ })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Параметры РК', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Экспозиции по диаметрам', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Прочее', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Экспозиции по диаметрам', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()

  await page.getByRole('button', { name: /^(Редактировать|Заполнить) справочник$/ }).click()
  await page.getByRole('button', { name: 'Сохранить справочник', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Изменение настроек', exact: true })).toBeVisible()
  await page.getByLabel('Пароль', { exact: true }).fill(SETTINGS_PASSWORD)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Экспозиции по диаметрам', exact: true })).toHaveCount(1)

  const layeredSwitch = page.getByRole('switch', { name: /^ПВК — только годен/ })
  await layeredSwitch.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Включить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Изменение настроек', exact: true })).toBeVisible()
  await expect.poll(() => loadControlSettings()).toEqual({
    pvkGoodOnly: false,
    preHeatTreatmentLnkEnabled: true,
    allowPrimaryLnkBeforePreviousStagesComplete: false,
  })

  await page.getByLabel('Пароль', { exact: true }).fill(SETTINGS_PASSWORD)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(layeredSwitch).toBeChecked()
  await expect(page.getByText('ПВК — только годен включен для проекта.', { exact: true })).toBeVisible()
  await expect.poll(() => loadControlSettings()).toEqual({
    pvkGoodOnly: true,
    preHeatTreatmentLnkEnabled: true,
    allowPrimaryLnkBeforePreviousStagesComplete: false,
  })

  await layeredSwitch.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Выключить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Изменение настроек', exact: true })).toBeVisible()
  await page.getByLabel('Пароль', { exact: true }).fill(SETTINGS_PASSWORD)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(layeredSwitch).not.toBeChecked()
})

test('PVK-only-good never starts the removed automatic layered-document workflow', async ({ page }) => {
  await seedLayeredJoint()
  await page.goto('/lnk')
  await expect(page.getByText(LAYERED_JOINT, { exact: true }).first()).toBeVisible()
  expect(await loadLayeredDocumentTypes()).toEqual([])
  await openControlProcesses(page)
  const toggle = page.getByRole('switch', { name: /^ПВК — только годен/ })
  await expect(toggle).not.toBeChecked()
  await toggle.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Включить', exact: true }).click()
  await expect(toggle).toBeChecked()
  expect(await loadLayeredDocumentTypes()).toEqual([])
  await toggle.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Выключить', exact: true }).click()
  await expect(toggle).not.toBeChecked()
  expect(await loadLayeredDocumentTypes()).toEqual([])
})

test('программа линий пересчитывает сохранённый ПВК при выключении и включении НК до ТО, не удаляя историю', async ({ page }) => {
  const line = 'E2E-PROGRAM-PRE-POLICY'
  await withE2eDatabase(async (client) => {
    const { rows: [program] } = await client.query(`insert into line_programs
      (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      values ($1, 'LP', $2, 'II', 'A', 30, 10) returning id`, [TEST_PROJECT, line])
    await client.query(`insert into weld_joints (line_program_id, project_title, subtitle_code, line, joint, weld_date,
      connection_type, category, group_name, weld_control_percent, pvk_control_percent, has_vik, stamp_1_k, has_pvk)
      select $1, $2, 'LP', $3, 'F' || (800+n)::text, '2026-09-01', 'СШ', 'II', 'A', 30, 10, 'да', 'PRE-POLICY',
      case when n=1 then 'отменен' end from generate_series(1,20) n`, [program.id, TEST_PROJECT, line])
    await client.query(`insert into pre_heat_treatment_controls (weld_joint_id, method, result, request_name, request_date, conclusion_name, conclusion_date)
      select id, 'ПВК', 'годен', 'P-POLICY', '2026-09-02', 'C-POLICY', '2026-09-03' from weld_joints where line=$1 and joint='F801'`, [line])
  })
  const history = () => withE2eDatabase(async (client) => (await client.query(`select p.* from pre_heat_treatment_controls p
    join weld_joints w on w.id=p.weld_joint_id where w.line=$1`, [line])).rows)
  const initialHistory = await history()
  const openProgram = async () => {
    await page.getByRole('button', { name: 'Программа линий', exact: true }).click()
    const program = page.getByTestId('line-program')
    await program.getByLabel('Поиск программы линий').fill(line)
    await program.getByRole('button', { name: new RegExp(line) }).click()
    return program.getByTestId('line-program-card').getByTestId('program-quota-summary')
  }
  await page.goto('/settings')
  let pvk = await openProgram()
  await expect(pvk.getByRole('button', { name: 'ПВК · зачтено / нужно 1 / 2', exact: true })).toBeVisible()
  for (const enabled of [false, true]) {
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()
    const toggle = page.getByRole('switch', { name: /^НК до ТО/ })
    await toggle.locator('xpath=..').click()
    await page.getByRole('button', { name: enabled ? 'Включить' : 'Выключить', exact: true }).click()
    await expect(toggle).toBeChecked({ checked: enabled })
    pvk = await openProgram()
    await expect(pvk.getByRole('button', { name: `ПВК · зачтено / нужно ${enabled ? 1 : 0} / 2`, exact: true })).toBeVisible()
    expect(await history()).toEqual(initialHistory)
  }
})

test('blocks disabling unfinished pre-TO; re-enabling requires pre-TO even for PSTO started while off', async ({ page }) => {
  await seedPreHeatTreatmentLines()
  await openControlProcesses(page)

  let preSwitch = page.getByRole('switch', { name: /^НК до ТО/ })
  await expect(preSwitch).toBeDisabled()
  await expect(page.getByText(/Нельзя выключить: незавершенных заявок или негодных результатов/)).toBeVisible()
  await expect.poll(() => loadControlSettings()).toEqual({
    pvkGoodOnly: false,
    preHeatTreatmentLnkEnabled: true,
    allowPrimaryLnkBeforePreviousStagesComplete: false,
  })

  await completePreHeatTreatmentBlocker()
  await page.reload()
  await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()
  preSwitch = page.getByRole('switch', { name: /^НК до ТО/ })
  await expect(preSwitch).toBeEnabled()
  await preSwitch.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Выключить', exact: true }).click()
  await expect(preSwitch).not.toBeChecked()
  await expect(page.getByRole('switch', { name: /^Разрешать основной НК/ })).toBeDisabled()
  await expect.poll(() => loadPreHeatTreatmentExemptions()).toEqual([
    ['F-PRE-A1', false],
    ['F-PRE-A2', false],
    ['F-PRE-B1', false],
    ['F-PRE-B2', false],
  ])

  await page.goto('/lnk')
  await expect(page.getByText('F-PRE-A1', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'НК до ТО', exact: true })).toHaveCount(0)
  await expect(page.getByText('Создать заявку ПСТО', { exact: false }).first()).toBeVisible()

  const unstarted = page.getByRole('button', { name: 'Выбрать стык F-PRE-A2', exact: true }).locator('xpath=ancestor::tr')
  await unstarted.getByRole('button', { name: 'Выполнить: Создать заявку ПСТО', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО', exact: true })).toBeVisible()
  await page.getByLabel('Дата заявки', { exact: true }).fill('2026-09-02')
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Заявка ПСТО', exact: true })).toBeHidden()
  await openControlProcesses(page)
  preSwitch = page.getByRole('switch', { name: /^НК до ТО/ })
  await preSwitch.locator('xpath=..').click()
  await page.getByRole('button', { name: 'Включить', exact: true }).click()
  await expect(preSwitch).toBeChecked()
  await expect(page.getByRole('switch', { name: /^Разрешать основной НК/ })).toBeEnabled()
  await expect.poll(() => loadPreHeatTreatmentExemptions()).toEqual([
    ['F-PRE-A1', false],
    ['F-PRE-A2', false],
    ['F-PRE-B1', false],
    ['F-PRE-B2', false],
  ])
  await page.goto('/lnk')
  const started = page.getByRole('button', { name: 'Выбрать стык F-PRE-A2', exact: true }).locator('xpath=ancestor::tr')
  await expect(started.getByRole('button', { name: 'Выполнить: Создать заявку НК до ТО', exact: true })).toBeVisible()
})

async function openControlProcesses(page: Page) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Процессы контроля', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Доступность процессов', exact: true })).toBeVisible()
}

async function configureSettingsPassword() {
  const salt = 'e2e-process-settings-salt'
  const passwordHash = (await derivePassword(SETTINGS_PASSWORD, salt)).toString('base64url')
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [SECURITY_SETTINGS_KEY, JSON.stringify({
      scopes: {
        settings: {
          enabled: true,
          salt,
          passwordHash,
          version: 'e2e-process-settings-version',
        },
      },
    })])
  })
}

async function configureRkExposureTable() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [OTHER_SETTINGS_KEY, JSON.stringify({
      rkExposureTable: {
        fileName: 'E2E экспозиции РК',
        uploadedAt: '2026-09-02T00:00:00.000Z',
        entries: [{
          diameter: 18,
          options: [{
            label: '0-0',
            values: ['0-0'],
            isDefault: true,
            note: '',
          }],
        }],
      },
    })])
  })
}

function derivePassword(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(derivedKey)
    })
  })
}

async function seedLayeredJoint() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, has_vik, has_pvk, vik_control_basis, pvk_control_basis,
        final_status, welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-09-01', $1, 'E2E-PROCESS-LAYER', 'E2E-PROCESS-LAYER-L1',
        'ISO-E2E-PROCESS-LAYER', $2, 'E2E-PROCESS-LAYER-S1',
        'действующий', 'актуальная', 'РД', 'У17', 'M01',
        108, 108, 4, 4, 0.42, 'да', 'дополнительный', 'проект', 'проект',
        'ожидает НК', now(), now(), now()
      )
    `, [TEST_PROJECT, LAYERED_JOINT])
  })
}

async function seedPreHeatTreatmentLines() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, has_vik, vik_control_basis, psto_required,
        final_status, welding_updated_at, psto_created_at, psto_updated_at,
        lnk_created_at, lnk_updated_at
      ) values
        ('2026-09-01', $1, 'E2E-PROCESS-PRE', 'E2E-PRE-A', 'ISO-E2E-PRE', $2, 'E2E-PRE-SA', 'действующий', 'актуальная', 'РД', 'СШ', 'M01', 108, 108, 4, 4, 0.42, 'да', 'проект', 'да', 'ожидает НК', now(), now(), now(), now(), now()),
        ('2026-09-01', $1, 'E2E-PROCESS-PRE', 'E2E-PRE-A', 'ISO-E2E-PRE', $3, 'E2E-PRE-SA', 'действующий', 'актуальная', 'РД', 'СШ', 'M01', 108, 108, 4, 4, 0.42, 'да', 'проект', 'да', 'ожидает НК', now(), now(), now(), now(), now()),
        ('2026-09-01', $1, 'E2E-PROCESS-PRE', 'E2E-PRE-B', 'ISO-E2E-PRE', $4, 'E2E-PRE-SB', 'действующий', 'актуальная', 'РД', 'СШ', 'M01', 108, 108, 4, 4, 0.42, 'да', 'проект', 'да', 'ожидает НК', now(), now(), now(), now(), now()),
        ('2026-09-01', $1, 'E2E-PROCESS-PRE', 'E2E-PRE-B', 'ISO-E2E-PRE', $5, 'E2E-PRE-SB', 'действующий', 'актуальная', 'РД', 'СШ', 'M01', 108, 108, 4, 4, 0.42, 'да', 'проект', 'да', 'ожидает НК', now(), now(), now(), now(), now())
    `, [TEST_PROJECT, ...PRE_JOINTS])
    await client.query(`
      insert into pre_heat_treatment_controls (
        weld_joint_id, method, request_name, request_date, result, created_at, updated_at
      )
      select id, 'ВИК', 'E2E заявка ВИК до ТО', '2026-09-01', 'ожидает НК', now(), now()
      from weld_joints
      where project_title = $1 and joint = $2
    `, [TEST_PROJECT, PRE_JOINTS[0]])
  })
}

async function completePreHeatTreatmentBlocker() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      update pre_heat_treatment_controls control
      set result = 'годен', conclusion_date = '2026-09-01',
          conclusion_name = 'E2E заключение ВИК до ТО', updated_at = now()
      from weld_joints weld
      where weld.id = control.weld_joint_id
        and weld.project_title = $1
        and weld.joint = $2
    `, [TEST_PROJECT, PRE_JOINTS[0]])
  })
}

async function loadControlSettings() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ value: string }>(
      'select value from app_settings where key = $1',
      [CONTROL_SETTINGS_KEY],
    )
    if (!result.rows[0]) {
      return {
        pvkGoodOnly: false,
        preHeatTreatmentLnkEnabled: true,
        allowPrimaryLnkBeforePreviousStagesComplete: false,
      }
    }
    return JSON.parse(result.rows[0].value) as {
      pvkGoodOnly: boolean
      preHeatTreatmentLnkEnabled: boolean
      allowPrimaryLnkBeforePreviousStagesComplete: boolean
    }
  })
}

async function loadLayeredDocumentTypes() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ type: string }>(`
      select document.type
      from generated_documents document
      inner join generated_document_weld_joints assignment on assignment.document_id = document.id
      inner join weld_joints weld on weld.id = assignment.weld_joint_id
      where weld.project_title = $1 and weld.joint = $2 and document.type like 'layered%'
      order by document.type
    `, [TEST_PROJECT, LAYERED_JOINT])
    return result.rows.map((row) => row.type)
  })
}

async function loadPreHeatTreatmentExemptions() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      joint: string
      pre_heat_treatment_lnk_exempt: boolean
    }>(`
      select joint, pre_heat_treatment_lnk_exempt
      from weld_joints
      where project_title = $1 and joint = any($2::text[])
      order by joint
    `, [TEST_PROJECT, [...PRE_JOINTS]])
    return result.rows.map((row) => [row.joint, row.pre_heat_treatment_lnk_exempt] as const)
  })
}

async function restoreDatabaseSnapshot() {
  await withE2eDatabase(async (client) => {
    await client.query('begin')
    try {
      const documents = await client.query<{ id: number }>(`
        select distinct document.id
        from generated_documents document
        inner join generated_document_weld_joints assignment on assignment.document_id = document.id
        inner join weld_joints weld on weld.id = assignment.weld_joint_id
        where weld.project_title = $1 and document.type like 'layered%'
      `, [TEST_PROJECT])
      await client.query('delete from weld_joints where project_title = $1', [TEST_PROJECT])
      if (documents.rows.length > 0) {
        await client.query(
          'delete from generated_documents where id = any($1::int[])',
          [documents.rows.map((row) => row.id)],
        )
      }

      await client.query('delete from app_settings')
      for (const setting of appSettingsSnapshot) {
        await client.query(`
          insert into app_settings (key, value, updated_at) values ($1, $2, $3)
        `, [setting.key, setting.value, setting.updated_at])
      }
      for (const weld of weldSnapshot) {
        await client.query(`
          update weld_joints
          set pre_heat_treatment_lnk_exempt = $2, updated_at = $3
          where id = $1
        `, [weld.id, weld.pre_heat_treatment_lnk_exempt, weld.updated_at])
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}
