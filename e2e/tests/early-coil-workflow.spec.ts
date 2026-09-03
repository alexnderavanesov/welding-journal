import { scrypt } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const PROJECT = 'E2E досрочная катушка'
const LINE = 'E2E-COIL-L1'
const SOURCE_JOINT = 'S951'
const EXPECTED_REPAIR = 'S951R1'
const COIL_JOINTS = ['S951Y1', 'S951Y2'] as const
const SECURITY_SETTINGS_KEY = 'security'
const SETTINGS_PASSWORD = 'e2e-early-coil-settings'
const DELETE_PASSWORD = 'e2e-early-coil-delete'

let securitySettingSnapshot: { value: string; updated_at: Date } | null = null

test.beforeEach(async () => {
  securitySettingSnapshot = await withE2eDatabase(async (client) => {
    const result = await client.query<{ value: string; updated_at: Date }>(`
      select value, updated_at from app_settings where key = $1
    `, [SECURITY_SETTINGS_KEY])
    return result.rows[0] ?? null
  })
  await configureEarlyCoilSecurity()
})

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query('delete from app_settings where key = $1', [SECURITY_SETTINGS_KEY])
    if (securitySettingSnapshot) {
      await client.query(`
        insert into app_settings (key, value, updated_at) values ($1, $2, $3)
      `, [SECURITY_SETTINGS_KEY, securitySettingSnapshot.value, securitySettingSnapshot.updated_at])
    }
  })
})

test('creates, navigates, revokes and safely protects an early coil', async ({ page }) => {
  const sourceRowId = await seedEarlyCoilChain()

  await page.goto('/journal')
  const sourceRow = page.locator(`tr[data-weld-row-id="${sourceRowId}"]`)
  await expect(sourceRow).toBeVisible()
  await sourceRow.getByRole('button', { name: SOURCE_JOINT, exact: true }).click()

  await expect(page.getByRole('heading', { name: `Картина стыка ${SOURCE_JOINT}` })).toBeVisible()
  await page.getByRole('button', { name: 'Врезать катушку досрочно', exact: true }).click()
  await confirmEarlyCoil(page)

  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })
  await expect(page.getByText('Стык превратился в катушку')).toBeVisible()
  await page.getByRole('button', { name: COIL_JOINTS[0], exact: true }).click()
  await expect(page.getByText(`${COIL_JOINTS[0]} является стыком катушки`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Предыдущий: ${SOURCE_JOINT}` })).toBeVisible()
  await page.getByRole('button', { name: `Парный: ${COIL_JOINTS[1]}` }).click()
  await expect(page.getByText(`${COIL_JOINTS[1]} является стыком катушки`)).toBeVisible()

  await openAcceptedDecisions(page)
  await revokeEarlyCoil(page, true)
  await expect(page.getByText(/Решение о досрочной катушке отменено/)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: false,
    expectedRepairExists: false,
    coilJoints: [],
  })

  await page.goto('/journal')
  const repeatedJointGroup = page
    .locator('details')
    .filter({ hasText: `Создать ${EXPECTED_REPAIR}` })
    .first()
  await repeatedJointGroup.locator('summary').click()
  await page.getByRole('button', { name: 'Катушка досрочно', exact: true }).click()
  await confirmEarlyCoil(page)
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })

  await assertDirectCoilDeletionIsBlocked(page)
  await markFirstCoilJointAsEdited()
  await openAcceptedDecisions(page)
  await revokeEarlyCoil(page, true)
  await expect(page.getByText(/Нельзя отменить решение: стык S951Y1 уже содержит данные/)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })

  await removeSecondCoilJointOutOfBand()
  await openAcceptedDecisions(page)
  await revokeEarlyCoil(page, true)
  await expect(page.getByText(/Нельзя отменить решение: пара стыков катушки .* неполна/)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [COIL_JOINTS[0]],
  })
})

async function confirmEarlyCoil(page: Page) {
  await expect(page.getByRole('heading', { name: 'Врезать катушку досрочно' })).toBeVisible()
  await expect(page.getByText(`${SOURCE_JOINT} -> ${COIL_JOINTS.join(' + ')}`)).toBeVisible()
  await page.getByRole('button', { name: 'Врезать катушку', exact: true }).click()
}

async function openAcceptedDecisions(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Диспетчер задач и напоминаний', exact: true }).click()
  await expect(page.getByText(`Досрочная врезка катушки ${COIL_JOINTS.join(' + ')}`)).toBeVisible()
}

async function revokeEarlyCoil(page: Page, authenticate = false) {
  const decisionTitle = page.getByText(`Досрочная врезка катушки ${COIL_JOINTS.join(' + ')}`, { exact: true })
  const decisionRow = decisionTitle.locator('xpath=ancestor::div[contains(@class,"flex")][.//button[normalize-space()="Отменить"]][1]')
  await decisionRow.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Отменить досрочную врезку катушки' })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить решение', exact: true }).click()
  if (authenticate) {
    await expect(page.getByRole('heading', { name: 'Изменение настроек', exact: true })).toBeVisible()
    await page.getByLabel('Пароль', { exact: true }).fill(SETTINGS_PASSWORD)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Подтверждение удаления', exact: true })).toBeVisible()
    await page.getByLabel('Пароль', { exact: true }).fill(DELETE_PASSWORD)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  }
}

async function configureEarlyCoilSecurity() {
  const settingsSalt = 'e2e-early-coil-settings-salt'
  const deleteSalt = 'e2e-early-coil-delete-salt'
  const [settingsPasswordHash, deletePasswordHash] = await Promise.all([
    derivePassword(SETTINGS_PASSWORD, settingsSalt),
    derivePassword(DELETE_PASSWORD, deleteSalt),
  ])
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [SECURITY_SETTINGS_KEY, JSON.stringify({
      scopes: {
        settings: {
          enabled: true,
          salt: settingsSalt,
          passwordHash: settingsPasswordHash.toString('base64url'),
          version: 'e2e-early-coil-settings-version',
        },
        delete: {
          enabled: true,
          salt: deleteSalt,
          passwordHash: deletePasswordHash.toString('base64url'),
          version: 'e2e-early-coil-delete-version',
        },
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

async function seedEarlyCoilChain() {
  return withE2eDatabase(async (client) => {
    const source = await client.query<{ id: number }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality,
        d1, d2, t1, t2, wdi,
        has_vik, vik_control_basis, vik_request, vik_request_date,
        vik_result, vik_conclusion_date, vik_conclusion, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-09-01', $1, 'E2E-COIL', $2, 'ISO-E2E-COIL', $3, 'E2E-COIL-S1',
        'действующий', 'актуальная',
        108, 108, 4, 4, 0.42,
        'да', 'проект', 'Заявка ВИК E2E', '2026-09-01',
        'ремонт', '2026-09-01', 'Заключение ВИК E2E', 'ремонт',
        now(), now(), now()
      )
      returning id
    `, [PROJECT, LINE, SOURCE_JOINT])
    await client.query(`
      insert into weld_joints (
        project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality,
        d1, d2, t1, t2, wdi,
        has_vik, vik_control_basis, final_status, welding_updated_at
      ) values (
        $1, 'E2E-COIL', $2, 'ISO-E2E-COIL', $3, 'E2E-COIL-S1',
        null, 'актуальная',
        108, 108, 4, 4, 0.42,
        'да', 'проект', 'ожидает сварку', now()
      )
    `, [PROJECT, LINE, EXPECTED_REPAIR])
    return source.rows[0]!.id
  })
}

async function loadEarlyCoilState() {
  return withE2eDatabase(async (client) => {
    const joints = await client.query<{ joint: string }>(`
      select joint
      from weld_joints
      where project_title = $1 and line = $2 and joint in ($3, $4, $5)
      order by joint
    `, [PROJECT, LINE, EXPECTED_REPAIR, ...COIL_JOINTS])
    const warning = await client.query<{ count: number }>(`
      select count(*)::int as count
      from dispatcher_accepted_warnings warning
      inner join weld_joints source on warning.key = 'early-coil:' || source.id::text
      where source.project_title = $1 and source.line = $2 and source.joint = $3
    `, [PROJECT, LINE, SOURCE_JOINT])
    const names = joints.rows.map((row) => row.joint)
    return {
      accepted: Number(warning.rows[0]?.count) === 1,
      expectedRepairExists: names.includes(EXPECTED_REPAIR),
      coilJoints: names.filter((joint) => COIL_JOINTS.includes(joint as typeof COIL_JOINTS[number])),
    }
  })
}

async function markFirstCoilJointAsEdited() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      update weld_joints
      set welding_journal_note = 'Пользователь изменил стык', updated_at = now() + interval '1 second'
      where project_title = $1 and line = $2 and joint = $3
    `, [PROJECT, LINE, COIL_JOINTS[0]])
  })
}

async function removeSecondCoilJointOutOfBand() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      delete from weld_joints
      where project_title = $1 and line = $2 and joint = $3
    `, [PROJECT, LINE, COIL_JOINTS[1]])
  })
}

async function assertDirectCoilDeletionIsBlocked(page: Page) {
  const rowId = await loadJointId(COIL_JOINTS[0])
  await page.goto('/journal')
  const row = page.locator(`tr[data-weld-row-id="${rowId}"]`)
  await row.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Подтверждение удаления', exact: true })).toBeVisible()
  await page.getByLabel('Пароль', { exact: true }).fill(DELETE_PASSWORD)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Удалить стык' })).toBeVisible()
  const confirmDialog = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/создан принятым решением.*нельзя удалить обычным действием/i)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })
}

async function loadJointId(joint: string) {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ id: number }>(`
      select id
      from weld_joints
      where project_title = $1 and line = $2 and joint = $3
      limit 1
    `, [PROJECT, LINE, joint])
    const id = result.rows[0]?.id
    if (!id) throw new Error(`Не найден тестовый стык ${joint}`)
    return id
  })
}
