import { scrypt } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const PROJECT = 'E2E досрочная катушка'
const LINE = 'E2E-COIL-L1'
const SOURCE_JOINT = 'S951'
const EXPECTED_REPAIR = 'S951R1'
const COIL_JOINTS = ['S951Y1', 'S951Y2'] as const
const UNOFFICIALITY_PROJECT = 'E2E неофициальный стык'
const UNOFFICIALITY_LINE = 'E2E-UNOFFICIAL-L1'
const UNOFFICIALITY_JOINT = 'S955'
const UNOFFICIALITY_EXPECTED_REPAIR = 'S955R1'
const CHAIN_REBUILD_PROJECT = 'E2E перестройка официальности'
const CHAIN_REBUILD_LINE = 'E2E-REBUILD-L1'
const CHAIN_REBUILD_JOINTS = ['S956', 'S956R1', 'S956R1W1'] as const
const CHAIN_REBUILD_DOCUMENT_TITLE = 'E2E документ перестройки цепочки'
const SECURITY_SETTINGS_KEY = 'security'
const SETTINGS_PASSWORD = 'e2e-early-coil-settings'
const DELETE_PASSWORD = 'e2e-early-coil-delete'
const RECOVERY_PROJECT = 'E2E восстановление цепочки'
const RECOVERY_LINE = 'E2E-CHAIN-L1'
const RECOVERY_CHAIN = ['S961', 'S961R1', 'S961R2'] as const
const AUTOMATIC_COIL_CHAIN = ['S971', 'S971W1', 'S971W2', 'S971W3'] as const
const AUTOMATIC_COIL_JOINTS = ['S971Y1', 'S971Y2'] as const
const MOVE_PROJECT = 'E2E перенос цепочки'
const MOVE_SOURCE_LINE = 'E2E-MOVE-L1'
const MOVE_TARGET_LINE = 'E2E-MOVE-L2'
const MOVE_SOURCE_JOINT = 'S981'
const MOVE_EXPECTED_REPAIR = 'S981R1'
const MOVE_COIL_JOINTS = ['S981Y1', 'S981Y2'] as const
const MOVE_WELDER_STAMP = 'E2M9'
const MOVE_TARGET_ANCHOR = 'S990'
const DATA_LIST_SETTINGS_KEY = 'data-list'

let securitySettingSnapshot: { value: string; updated_at: Date } | null = null
let dataListSettingSnapshot: { value: string; updated_at: Date } | null = null

test.beforeEach(async () => {
  const settingSnapshots = await withE2eDatabase(async (client) => {
    const result = await client.query<{ key: string; value: string; updated_at: Date }>(`
      select key, value, updated_at from app_settings where key = any($1::text[])
    `, [[SECURITY_SETTINGS_KEY, DATA_LIST_SETTINGS_KEY]])
    return new Map(result.rows.map((row) => [row.key, row]))
  })
  securitySettingSnapshot = settingSnapshots.get(SECURITY_SETTINGS_KEY) ?? null
  dataListSettingSnapshot = settingSnapshots.get(DATA_LIST_SETTINGS_KEY) ?? null
  await configureEarlyCoilSecurity()
})

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query(`
      delete from dispatcher_accepted_warnings
      where key in (
        select 'early-coil:' || id::text
        from weld_joints
        where project_title = $1
      )
    `, [MOVE_PROJECT])
    await client.query('delete from weld_joints where project_title = $1', [MOVE_PROJECT])
    await client.query('delete from weld_joints where project_title = $1', [UNOFFICIALITY_PROJECT])
    await client.query('delete from generated_documents where title = $1', [CHAIN_REBUILD_DOCUMENT_TITLE])
    await client.query('delete from weld_joints where project_title = $1', [CHAIN_REBUILD_PROJECT])
    await client.query('delete from welder_stamps where naks_stamp = $1', [MOVE_WELDER_STAMP])
    await client.query('delete from app_settings where key = $1', [SECURITY_SETTINGS_KEY])
    if (securitySettingSnapshot) {
      await client.query(`
        insert into app_settings (key, value, updated_at) values ($1, $2, $3)
      `, [SECURITY_SETTINGS_KEY, securitySettingSnapshot.value, securitySettingSnapshot.updated_at])
    }
    await client.query('delete from app_settings where key = $1', [DATA_LIST_SETTINGS_KEY])
    if (dataListSettingSnapshot) {
      await client.query(`
        insert into app_settings (key, value, updated_at) values ($1, $2, $3)
      `, [DATA_LIST_SETTINGS_KEY, dataListSettingSnapshot.value, dataListSettingSnapshot.updated_at])
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
  await expect(page.getByText('Цепочка продолжена катушкой', { exact: true })).toBeVisible()
  await expect(page.getByText('Ожидается решение по негодному результату', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Стык превратился в катушку')).toBeVisible()
  await page.getByRole('region', { name: 'Продолжение цепочки катушкой' })
    .getByRole('button', { name: COIL_JOINTS[0], exact: true })
    .click()
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
  const repeatedJointGroup = await openDispatcherObjectGroup(page, SOURCE_JOINT, 'ДЗ-07')
  await expect(repeatedJointGroup.getByText(`Создать ${EXPECTED_REPAIR}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Катушка досрочно', exact: true }).click()
  await confirmEarlyCoil(page)
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })

  await assertDirectEarlyCoilSourceDeletionIsBlocked(page, sourceRowId)
  await assertDirectCoilDeletionIsBlocked(page)
  await assertDirectCoilPairDeletionIsBlocked(page)
  await markFirstCoilJointAsEdited()
  await openAcceptedDecisions(page)
  await revokeEarlyCoil(page, true)
  await expect(page.getByText(/Нельзя отменить решение: стык S951Y1 уже содержит данные/)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })

  await removeCoilJointsOutOfBand([COIL_JOINTS[1]])
  await openAcceptedDecisions(page)
  await revokeEarlyCoil(page, true)
  await expect(page.getByText(/Нельзя отменить решение: пара стыков катушки .* неполна/)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [COIL_JOINTS[0]],
  })

  await recreateCoilFromDispatcher(page, [COIL_JOINTS[1]])
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })

  await removeCoilJointsOutOfBand([...COIL_JOINTS])
  await recreateCoilFromDispatcher(page, [...COIL_JOINTS])
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })
})

test('opens the selected rejected joint in LNK officiality and changes it only after save', async ({ page }) => {
  const sourceRowId = await seedUnofficialityChoice()

  const taskGroup = await openDispatcherObjectGroup(page, UNOFFICIALITY_JOINT, 'ДЗ-07')
  const target = taskGroup.getByText(UNOFFICIALITY_EXPECTED_REPAIR, { exact: true })
  const taskCard = target.locator('xpath=ancestor::div[contains(@class,"grid")][1]')
  await taskCard
    .getByRole('button', { name: `Сделать ${UNOFFICIALITY_JOINT} неофициальным`, exact: true })
    .click()
  await expect(page).toHaveURL(/\/lnk$/)
  let officialityDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }),
  })
  await expect(officialityDialog).toBeVisible()
  await expect(officialityDialog.getByRole('button', { name: /^Неофициальный/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await officialityDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect.poll(loadUnofficialityChoice).toBe('действующий')

  await page.goto('/journal')
  const sourceRow = page.locator(`tr[data-weld-row-id="${sourceRowId}"]`)
  await expect(sourceRow).toBeVisible()
  await sourceRow.getByRole('button', { name: UNOFFICIALITY_JOINT, exact: true }).click()

  const continuationPanel = page.getByRole('region', { name: 'Продолжение цепочки стыка' })
  await expect(continuationPanel.getByRole('button')).toHaveText([
    `Создать ${UNOFFICIALITY_EXPECTED_REPAIR}`,
    `Сделать ${UNOFFICIALITY_JOINT} неофициальным`,
    'Врезать катушку досрочно',
  ])
  await continuationPanel
    .getByRole('button', { name: `Сделать ${UNOFFICIALITY_JOINT} неофициальным`, exact: true })
    .click()

  await expect(page).toHaveURL(/\/lnk$/)
  officialityDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }),
  })
  await expect(officialityDialog).toBeVisible()
  await expect(officialityDialog.getByRole('button', { name: /^Неофициальный/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    officialityDialog.getByRole('button').filter({
      hasText: `${UNOFFICIALITY_LINE} · ${UNOFFICIALITY_JOINT}`,
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(loadUnofficialityChoice).toBe('действующий')

  await officialityDialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()
  await expect(officialityDialog).toBeHidden()
  await expect.poll(loadUnofficialityChoice).toBe('неофициальный')
})

test('rebuilds the later chain while preserving row data and document assignments', async ({ page }) => {
  const seeded = await seedOfficialityChainRebuild()

  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Официальность', exact: true }).click()

  const officialityDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }),
  })
  await expect(officialityDialog).toBeVisible()
  await officialityDialog
    .getByPlaceholder('Проект, шифр, линия, спул или стык')
    .fill(CHAIN_REBUILD_JOINTS[1])
  const middleRowButton = officialityDialog.getByRole('button').filter({
    hasText: `${CHAIN_REBUILD_LINE} · ${CHAIN_REBUILD_JOINTS[1]}`,
  })
  await expect(middleRowButton).toBeVisible()
  await middleRowButton.click()
  await officialityDialog.getByRole('button', { name: /^Неофициальный/ }).click()
  await officialityDialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()

  const rebuildDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Изменить официальность и перестроить цепочку', exact: true }),
  })
  await expect(rebuildDialog).toContainText(
    `${CHAIN_REBUILD_JOINTS[2]} -> ${CHAIN_REBUILD_JOINTS[1]}`,
  )
  await expect.poll(loadOfficialityChainRebuildState).toEqual({
    rows: [
      {
        id: seeded.rootRowId,
        joint: CHAIN_REBUILD_JOINTS[0],
        officiality: 'действующий',
        lnkNote: 'E2E корневой стык',
        rkConclusion: 'E2E заключение ремонт',
      },
      {
        id: seeded.middleRowId,
        joint: CHAIN_REBUILD_JOINTS[1],
        officiality: 'действующий',
        lnkNote: 'E2E история вырезанного стыка',
        rkConclusion: 'E2E заключение вырез',
      },
      {
        id: seeded.continuationRowId,
        joint: CHAIN_REBUILD_JOINTS[2],
        officiality: 'действующий',
        lnkNote: 'E2E данные продолжения',
        rkConclusion: 'E2E заключение годен',
      },
    ],
    documentAssignmentRowId: seeded.continuationRowId,
  })

  await rebuildDialog.getByRole('button', { name: 'Сохранить и перестроить', exact: true }).click()
  await expect(officialityDialog).toBeHidden()
  await expect.poll(loadOfficialityChainRebuildState).toEqual({
    rows: [
      {
        id: seeded.rootRowId,
        joint: CHAIN_REBUILD_JOINTS[0],
        officiality: 'действующий',
        lnkNote: 'E2E корневой стык',
        rkConclusion: 'E2E заключение ремонт',
      },
      {
        id: seeded.middleRowId,
        joint: CHAIN_REBUILD_JOINTS[1],
        officiality: 'неофициальный',
        lnkNote: 'E2E история вырезанного стыка',
        rkConclusion: 'E2E заключение вырез',
      },
      {
        id: seeded.continuationRowId,
        joint: CHAIN_REBUILD_JOINTS[1],
        officiality: null,
        lnkNote: 'E2E данные продолжения',
        rkConclusion: 'E2E заключение годен',
      },
    ],
    documentAssignmentRowId: seeded.continuationRowId,
  })
})

test('stops the whole officiality rebuild when another user changes the selected joint', async ({ page }) => {
  const seeded = await seedOfficialityChainRebuild()

  await page.goto('/lnk')
  await page.getByRole('button', { name: 'Официальность', exact: true }).click()
  const officialityDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Официальность стыков', exact: true }),
  })
  await officialityDialog
    .getByPlaceholder('Проект, шифр, линия, спул или стык')
    .fill(CHAIN_REBUILD_JOINTS[1])
  await officialityDialog.getByRole('button').filter({
    hasText: `${CHAIN_REBUILD_LINE} · ${CHAIN_REBUILD_JOINTS[1]}`,
  }).click()
  await officialityDialog.getByRole('button', { name: /^Неофициальный/ }).click()
  await officialityDialog.getByRole('button', { name: 'Сохранить официальность', exact: true }).click()

  const rebuildDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Изменить официальность и перестроить цепочку', exact: true }),
  })
  await expect(rebuildDialog).toBeVisible()
  await simulateConcurrentOfficialityEdit(seeded.middleRowId)
  await rebuildDialog.getByRole('button', { name: 'Сохранить и перестроить', exact: true }).click()

  await expect(page.getByText(/уже изменен другим пользователем или в другом окне/)).toBeVisible()
  await expect.poll(loadOfficialityChainRebuildState).toEqual({
    rows: [
      {
        id: seeded.rootRowId,
        joint: CHAIN_REBUILD_JOINTS[0],
        officiality: 'действующий',
        lnkNote: 'E2E корневой стык',
        rkConclusion: 'E2E заключение ремонт',
      },
      {
        id: seeded.middleRowId,
        joint: CHAIN_REBUILD_JOINTS[1],
        officiality: 'действующий',
        lnkNote: 'E2E параллельная правка',
        rkConclusion: 'E2E заключение вырез',
      },
      {
        id: seeded.continuationRowId,
        joint: CHAIN_REBUILD_JOINTS[2],
        officiality: 'действующий',
        lnkNote: 'E2E данные продолжения',
        rkConclusion: 'E2E заключение годен',
      },
    ],
    documentAssignmentRowId: seeded.continuationRowId,
  })
})

test('keeps dispatcher recovery actions after chain and automatic coil rows are deleted', async ({ page }) => {
  test.setTimeout(120_000)
  const rowIds = await seedDeletionRecoveryChains()

  await page.goto('/journal')
  await expect(page.locator(`tr[data-weld-row-id="${rowIds.get(RECOVERY_CHAIN[0])}"]`)
    .getByText(`Цепочка продолжена стыком ${RECOVERY_CHAIN[1]}`, { exact: true })).toBeVisible()
  await expect(page.locator(`tr[data-weld-row-id="${rowIds.get(RECOVERY_CHAIN[1])}"]`)
    .getByText(`Цепочка продолжена стыком ${RECOVERY_CHAIN[2]}`, { exact: true })).toBeVisible()
  await expect(page.locator(`tr[data-weld-row-id="${rowIds.get(AUTOMATIC_COIL_CHAIN[3])}"]`)
    .getByText('Цепочка продолжена катушкой', { exact: true })).toBeVisible()

  await deleteJournalRows(page, [{ id: rowIds.get(RECOVERY_CHAIN[1])!, joint: RECOVERY_CHAIN[1] }])
  const integrityGroup = await openDispatcherObjectGroup(page, RECOVERY_CHAIN[0], 'ДЗ-13')
  const recoverySourceRow = page.locator(`tr[data-weld-row-id="${rowIds.get(RECOVERY_CHAIN[0])}"]`)
  await expect(recoverySourceRow.getByText(`Создать ${RECOVERY_CHAIN[1]}`, { exact: true })).toBeVisible()
  await expect(recoverySourceRow.getByText(
    `Цепочка продолжена стыком ${RECOVERY_CHAIN[1]}`,
    { exact: true },
  )).toHaveCount(0)
  await expect(integrityGroup.getByText('Проверить целостность цепочки', { exact: true })).toBeVisible()
  let taskGroup = await openDispatcherObjectGroup(page, RECOVERY_CHAIN[0], 'ДЗ-07')
  await expectDispatcherCreateAction(taskGroup, RECOVERY_CHAIN[1])
  await expectDispatcherCreateAction(taskGroup, 'S961R2W1')

  await clickDispatcherAction(taskGroup, RECOVERY_CHAIN[1], 'Создать')
  await expect.poll(() => loadExistingJoints(RECOVERY_PROJECT, RECOVERY_LINE, [RECOVERY_CHAIN[1]]))
    .toEqual([RECOVERY_CHAIN[1]])

  await deleteJournalRows(page, [{ id: rowIds.get(AUTOMATIC_COIL_JOINTS[0])!, joint: AUTOMATIC_COIL_JOINTS[0] }])
  const automaticIntegrityGroup = await openDispatcherObjectGroup(page, AUTOMATIC_COIL_CHAIN[0], 'ДЗ-13')
  const automaticCoilSourceRow = page.locator(
    `tr[data-weld-row-id="${rowIds.get(AUTOMATIC_COIL_CHAIN[3])}"]`,
  )
  await expect(automaticCoilSourceRow.getByText('Цепочка продолжена катушкой', { exact: true })).toHaveCount(0)
  await expect(automaticIntegrityGroup.getByText('Проверить целостность цепочки', { exact: true })).toBeVisible()
  taskGroup = await openDispatcherObjectGroup(page, AUTOMATIC_COIL_CHAIN[0], 'ДЗ-09')
  await expectDispatcherCoilAction(taskGroup, [AUTOMATIC_COIL_JOINTS[0]])
  await clickDispatcherAction(taskGroup, `катушка ${AUTOMATIC_COIL_JOINTS[0]}`, 'Катушка')
  await expect.poll(() => loadExistingJoints(RECOVERY_PROJECT, RECOVERY_LINE, [AUTOMATIC_COIL_JOINTS[0]]))
    .toEqual([AUTOMATIC_COIL_JOINTS[0]])

  const refreshedIds = await loadJointIds(RECOVERY_PROJECT, RECOVERY_LINE, [
    AUTOMATIC_COIL_CHAIN[1],
    AUTOMATIC_COIL_CHAIN[2],
    ...AUTOMATIC_COIL_JOINTS,
  ])
  await deleteJournalRows(page, [
    { id: refreshedIds.get(AUTOMATIC_COIL_CHAIN[1])!, joint: AUTOMATIC_COIL_CHAIN[1] },
    { id: refreshedIds.get(AUTOMATIC_COIL_CHAIN[2])!, joint: AUTOMATIC_COIL_CHAIN[2] },
    { id: refreshedIds.get(AUTOMATIC_COIL_JOINTS[0])!, joint: AUTOMATIC_COIL_JOINTS[0] },
    { id: refreshedIds.get(AUTOMATIC_COIL_JOINTS[1])!, joint: AUTOMATIC_COIL_JOINTS[1] },
  ])

  const finalIntegrityGroup = await openDispatcherObjectGroup(page, AUTOMATIC_COIL_CHAIN[0], 'ДЗ-13')
  const integrityChecks = finalIntegrityGroup.getByText('Проверить целостность цепочки', { exact: true })
  await expect(integrityChecks).toHaveCount(2)
  await expect(integrityChecks.first()).toBeVisible()
  taskGroup = await openDispatcherObjectGroup(page, AUTOMATIC_COIL_CHAIN[0], 'ДЗ-09')
  await expectDispatcherCoilAction(taskGroup, [...AUTOMATIC_COIL_JOINTS])
  await expect(taskGroup.getByText('S971W4', { exact: true })).toHaveCount(0)
  await clickDispatcherAction(
    taskGroup,
    `катушка ${AUTOMATIC_COIL_JOINTS.join(' + ')}`,
    'Катушка',
  )
  await expect.poll(() => loadExistingJoints(
    RECOVERY_PROJECT,
    RECOVERY_LINE,
    [...AUTOMATIC_COIL_JOINTS],
  )).toEqual([...AUTOMATIC_COIL_JOINTS])
})

test('moves an accepted coil chain through its base and preserves each row workflow', async ({ page }) => {
  test.setTimeout(120_000)
  const sourceRowId = await seedChainLineMoveCase()

  await page.goto('/journal')
  const sourceRow = page.locator(`tr[data-weld-row-id="${sourceRowId}"]`)
  await expect(sourceRow).toBeVisible()
  await sourceRow.getByRole('button', { name: MOVE_SOURCE_JOINT, exact: true }).click()
  await page.getByRole('button', { name: 'Врезать катушку досрочно', exact: true }).click()
  await expect(page.getByText(
    `${MOVE_SOURCE_JOINT} -> ${MOVE_COIL_JOINTS.join(' + ')}`,
    { exact: true },
  )).toBeVisible()
  await page.getByRole('button', { name: 'Врезать катушку', exact: true }).click()
  await expect.poll(() => loadExistingJoints(
    MOVE_PROJECT,
    MOVE_SOURCE_LINE,
    MOVE_COIL_JOINTS,
  )).toEqual([...MOVE_COIL_JOINTS])

  await addCompletedPreControl(MOVE_COIL_JOINTS[0])
  const movedIds = await loadJointIds(MOVE_PROJECT, MOVE_SOURCE_LINE, [
    MOVE_SOURCE_JOINT,
    ...MOVE_COIL_JOINTS,
  ])

  await page.goto('/journal')
  const childRow = page.locator(`tr[data-weld-row-id="${movedIds.get(MOVE_COIL_JOINTS[0])}"]`)
  await childRow.getByRole('button', { name: 'Редактировать', exact: true }).click()
  let editor = getWeldEditor(page)
  await changeEditorLine(editor, MOVE_TARGET_LINE)
  await expect(editor.getByText(/входит в цепочку S981.*через базовый стык S981/i).first()).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()

  const refreshedSourceRow = page.locator(`tr[data-weld-row-id="${sourceRowId}"]`)
  await refreshedSourceRow.getByRole('button', { name: 'Редактировать', exact: true }).click()
  editor = getWeldEditor(page)
  await changeEditorLine(editor, MOVE_TARGET_LINE)

  const moveDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: `Перенос цепочки ${MOVE_SOURCE_JOINT}` }),
  })
  await expect(moveDialog).toBeVisible()
  await expect(moveDialog.getByText(MOVE_COIL_JOINTS.join(', '), { exact: false })).toBeVisible()
  const firstCoilDecision = moveDialog
    .getByText(MOVE_COIL_JOINTS[0], { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"border-b")][1]')
  await firstCoilDecision.getByRole('button', { name: /Перенести завершенный НК до ТО/ }).click()
  await moveDialog.getByRole('button', { name: 'Подтвердить перенос цепочки', exact: true }).click()

  await expect(editor.getByText(/Подтвержден перенос всей цепочки S981: записей 3/)).toBeVisible()
  const saveChainMove = editor.getByRole('button', { name: 'Сохранить', exact: true })
  await expect(saveChainMove).toBeEnabled()
  await saveChainMove.click()
  await expect(editor).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Цепочка стыка перенесена · записей: 3')

  await expect.poll(loadChainLineMoveState).toEqual({
    acceptedDecisionContextHasTargetLine: true,
    completedPreControlCount: 0,
    movedJoints: [MOVE_SOURCE_JOINT, ...MOVE_COIL_JOINTS],
    sourceHistory: {
      pstoResult: 'проведено',
      tvmtConclusion: 'Заключение ТВМТ S981',
      tvmtResult: 'годен',
    },
    sourceLineJoints: [],
    targetLineJoints: [MOVE_SOURCE_JOINT, ...MOVE_COIL_JOINTS, MOVE_TARGET_ANCHOR],
    promotedControl: {
      conclusion: 'Заключение ВИК до ТО S981Y1',
      result: 'годен',
    },
  })
})

async function confirmEarlyCoil(page: Page) {
  await expect(page.getByRole('heading', { name: 'Врезать катушку досрочно' })).toBeVisible()
  await expect(page.getByText(`${SOURCE_JOINT} -> ${COIL_JOINTS.join(' + ')}`)).toBeVisible()
  await page.getByRole('button', { name: 'Врезать катушку', exact: true }).click()
}

async function openAcceptedDecisions(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Принятые исключения', exact: true }).click()
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

async function seedUnofficialityChoice() {
  return withE2eDatabase(async (client) => {
    const source = await client.query<{ id: number }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi,
        stamp_1_k, stamp_1_k_fact,
        has_vik, vik_control_basis, vik_request, vik_request_date,
        vik_result, vik_conclusion_date, vik_conclusion, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-09-01', $1, 'E2E-UNOFFICIAL', $2, 'ISO-E2E-UNOFFICIAL', $3, 'E2E-UNOFFICIAL-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42,
        'E2E-K1', 'E2E-K1',
        'да', 'проект', 'Заявка ВИК E2E', '2026-09-01',
        'ремонт', '2026-09-01', 'Заключение ВИК E2E', 'ремонт',
        now(), now(), now()
      )
      returning id
    `, [UNOFFICIALITY_PROJECT, UNOFFICIALITY_LINE, UNOFFICIALITY_JOINT])
    await client.query(`
      insert into dispatcher_task_index_state
        (id, source_revision, computed_revision, full_rebuild, updated_at)
      values (1, 1, -1, true, now())
      on conflict (id) do update
      set source_revision = dispatcher_task_index_state.source_revision + 1,
          full_rebuild = true,
          updated_at = now()
    `)
    return source.rows[0]!.id
  })
}

async function loadUnofficialityChoice() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ officiality: string | null }>(`
      select officiality
      from weld_joints
      where project_title = $1 and line = $2 and joint = $3
      limit 1
    `, [UNOFFICIALITY_PROJECT, UNOFFICIALITY_LINE, UNOFFICIALITY_JOINT])
    return result.rows[0]?.officiality ?? null
  })
}

async function seedOfficialityChainRebuild() {
  return withE2eDatabase(async (client) => {
    const rows = await client.query<{ id: number; joint: string }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi,
        stamp_1_k, stamp_1_k_fact,
        has_rk, rk_control_basis, rk_request, rk_request_date,
        rk_result, rk_conclusion_date, rk_conclusion, lnk_note, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values (
        '2026-09-01', $1, 'E2E-REBUILD', $2, 'ISO-E2E-REBUILD', $3, 'E2E-REBUILD-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42,
        'E2E-K1', 'E2E-K1',
        'да', 'проект', 'E2E заявка ремонт', '2026-09-01',
        'ремонт', '2026-09-01', 'E2E заключение ремонт', 'E2E корневой стык', 'ремонт',
        now(), now(), now()
      ), (
        '2026-09-02', $1, 'E2E-REBUILD', $2, 'ISO-E2E-REBUILD', $4, 'E2E-REBUILD-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42,
        'E2E-K1', 'E2E-K1',
        'да', 'проект', 'E2E заявка вырез', '2026-09-02',
        'вырез', '2026-09-02', 'E2E заключение вырез', 'E2E история вырезанного стыка', 'вырез',
        now(), now(), now()
      ), (
        '2026-09-03', $1, 'E2E-REBUILD', $2, 'ISO-E2E-REBUILD', $5, 'E2E-REBUILD-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'M01',
        108, 108, 4, 4, 0.42,
        'E2E-K1', 'E2E-K1',
        'да', 'проект', 'E2E заявка годен', '2026-09-03',
        'годен', '2026-09-03', 'E2E заключение годен', 'E2E данные продолжения', 'годен',
        now(), now(), now()
      )
      returning id, joint
    `, [
      CHAIN_REBUILD_PROJECT,
      CHAIN_REBUILD_LINE,
      CHAIN_REBUILD_JOINTS[0],
      CHAIN_REBUILD_JOINTS[1],
      CHAIN_REBUILD_JOINTS[2],
    ])
    const rowIds = new Map(rows.rows.map((row) => [row.joint, row.id]))
    const rootRowId = rowIds.get(CHAIN_REBUILD_JOINTS[0])!
    const middleRowId = rowIds.get(CHAIN_REBUILD_JOINTS[1])!
    const continuationRowId = rowIds.get(CHAIN_REBUILD_JOINTS[2])!
    const document = await client.query<{ id: number }>(`
      insert into generated_documents (
        type, title, file_name, mime_type, row_count, source_metadata
      ) values (
        'e2e-chain-rebuild', $1, 'e2e-chain-rebuild.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, '{}'
      )
      returning id
    `, [CHAIN_REBUILD_DOCUMENT_TITLE])
    await client.query(`
      insert into generated_document_weld_joints (document_id, weld_joint_id)
      values ($1, $2)
    `, [document.rows[0]!.id, continuationRowId])
    await client.query(`
      insert into dispatcher_task_index_state
        (id, source_revision, computed_revision, full_rebuild, updated_at)
      values (1, 1, -1, true, now())
      on conflict (id) do update
      set source_revision = dispatcher_task_index_state.source_revision + 1,
          full_rebuild = true,
          updated_at = now()
    `)
    return { rootRowId, middleRowId, continuationRowId }
  })
}

async function loadOfficialityChainRebuildState() {
  return withE2eDatabase(async (client) => {
    const rows = await client.query<{
      id: number
      joint: string
      officiality: string | null
      lnk_note: string | null
      rk_conclusion: string | null
    }>(`
      select id, joint, officiality, lnk_note, rk_conclusion
      from weld_joints
      where project_title = $1 and line = $2
      order by id
    `, [CHAIN_REBUILD_PROJECT, CHAIN_REBUILD_LINE])
    const assignment = await client.query<{ weld_joint_id: number }>(`
      select assignment.weld_joint_id
      from generated_document_weld_joints assignment
      inner join generated_documents document on document.id = assignment.document_id
      where document.title = $1
    `, [CHAIN_REBUILD_DOCUMENT_TITLE])
    return {
      rows: rows.rows.map((row) => ({
        id: row.id,
        joint: row.joint,
        officiality: row.officiality,
        lnkNote: row.lnk_note,
        rkConclusion: row.rk_conclusion,
      })),
      documentAssignmentRowId: assignment.rows[0]?.weld_joint_id ?? null,
    }
  })
}

async function simulateConcurrentOfficialityEdit(rowId: number) {
  await withE2eDatabase(async (client) => {
    await client.query(`
      update weld_joints
      set lnk_note = 'E2E параллельная правка', updated_at = now()
      where id = $1
    `, [rowId])
  })
}

async function seedChainLineMoveCase() {
  return withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [DATA_LIST_SETTINGS_KEY, JSON.stringify({
      weldingTypes: ['РАД', 'РД'],
      connectionTypes: ['СШ'],
      materialGroups: ['М01'],
      testTypes: ['ГИ', 'ПИ'],
    })])
    const source = await client.query<{ id: number }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi,
        stamp_1_k, stamp_1_z, stamp_1_o,
        stamp_1_k_fact, stamp_1_z_fact, stamp_1_o_fact,
        has_vik, vik_control_basis, vik_request, vik_request_date,
        vik_result, vik_conclusion_date, vik_conclusion,
        psto_required, psto_request, psto_request_date, psto_date,
        heat_treatment_diagram, psto_result,
        tvmt_request, tvmt_request_date, tvmt_result,
        tvmt_conclusion_date, tvmt_conclusion, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at, psto_created_at, psto_updated_at
      ) values (
        '2026-09-01', $1, 'E2E-MOVE', $2, 'ISO-E2E-MOVE', $3, 'E2E-MOVE-S1',
        'действующий', 'актуальная', 'РД', 'СШ', 'М01',
        108, 108, 4, 4, 0.42,
        $4, $4, $4, $4, $4, $4,
        'да', 'проект', 'Заявка ВИК S981', '2026-09-01',
        'ремонт', '2026-09-01', 'Заключение ВИК S981',
        'да', 'Заявка ПСТО S981', '2026-09-01', '2026-09-01',
        'Диаграмма S981', 'проведено',
        'Заявка ТВМТ S981', '2026-09-01', 'годен',
        '2026-09-01', 'Заключение ТВМТ S981', 'ремонт',
        now(), now(), now(), now(), now()
      )
      returning id
    `, [MOVE_PROJECT, MOVE_SOURCE_LINE, MOVE_SOURCE_JOINT, MOVE_WELDER_STAMP])
    await client.query(`
      insert into weld_joints (
        project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, d1, d2, t1, t2, wdi,
        has_vik, vik_control_basis, psto_required, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at, psto_created_at, psto_updated_at
      ) values (
        $1, 'E2E-MOVE', $2, 'ISO-E2E-MOVE', $3, 'E2E-MOVE-S1',
        null, 'актуальная', 108, 108, 4, 4, 0.42,
        'да', 'проект', 'да', 'ожидает сварку',
        now(), now(), now(), now(), now()
      ), (
        $1, 'E2E-MOVE', $4, 'ISO-E2E-MOVE-TARGET', $5, 'E2E-MOVE-T1',
        null, 'актуальная', 108, 108, 4, 4, 0.42,
        'да', 'проект', null, 'ожидает сварку',
        now(), now(), now(), now(), now()
      )
    `, [MOVE_PROJECT, MOVE_SOURCE_LINE, MOVE_EXPECTED_REPAIR, MOVE_TARGET_LINE, MOVE_TARGET_ANCHOR])
    await client.query(`
      insert into welder_stamps (
        naks_stamp, welder_name, weld_type, material_groups,
        diameter_from, diameter_to, thickness_from, thickness_to,
        valid_from, valid_to, naks_permits
      ) values (
        $1, 'E2E сварщик переноса цепочки', 'РД', 'М01',
        '1', '1000', '1', '100', '2026-01-01', '2026-12-31',
        '[{"id":"e2e-chain-move","weldType":"РД","materialGroups":"М01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","note":"","archived":false}]'
      )
    `, [MOVE_WELDER_STAMP])
    return source.rows[0]!.id
  })
}

async function addCompletedPreControl(joint: string) {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into pre_heat_treatment_controls (
        weld_joint_id, method, request_name, request_date,
        result, conclusion_date, conclusion_name
      )
      select id, 'ВИК', 'Заявка ВИК до ТО S981Y1', '2026-09-02',
        'годен', '2026-09-02', 'Заключение ВИК до ТО S981Y1'
      from weld_joints
      where project_title = $1 and line = $2 and joint = $3
    `, [MOVE_PROJECT, MOVE_SOURCE_LINE, joint])
  })
}

function getWeldEditor(page: Page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Редактирование стыка' }),
  })
}

async function changeEditorLine(editor: ReturnType<Page['getByRole']>, line: string) {
  const lineInput = editor.getByText('Линия', { exact: true }).locator('..').getByRole('textbox')
  await lineInput.fill(line)
  await lineInput.press('Tab')
}

async function loadChainLineMoveState() {
  return withE2eDatabase(async (client) => {
    const rows = await client.query<{
      joint: string
      line: string
      psto_result: string | null
      tvmt_result: string | null
      tvmt_conclusion: string | null
      vik_result: string | null
      vik_conclusion: string | null
    }>(`
      select joint, line, psto_result, tvmt_result, tvmt_conclusion, vik_result, vik_conclusion
      from weld_joints
      where project_title = $1 and subtitle_code = 'E2E-MOVE'
      order by joint
    `, [MOVE_PROJECT])
    const source = rows.rows.find((row) => row.joint === MOVE_SOURCE_JOINT)
    const promoted = rows.rows.find((row) => row.joint === MOVE_COIL_JOINTS[0])
    const preControls = await client.query<{ count: number }>(`
      select count(*)::int as count
      from pre_heat_treatment_controls control
      inner join weld_joints weld on weld.id = control.weld_joint_id
      where weld.project_title = $1 and weld.joint = $2
    `, [MOVE_PROJECT, MOVE_COIL_JOINTS[0]])
    const warning = await client.query<{ context: string | null }>(`
      select warning.context
      from dispatcher_accepted_warnings warning
      inner join weld_joints source on warning.key = 'early-coil:' || source.id::text
      where source.project_title = $1 and source.joint = $2
    `, [MOVE_PROJECT, MOVE_SOURCE_JOINT])
    const movedJoints = rows.rows
      .filter((row) => row.line === MOVE_TARGET_LINE && row.joint !== MOVE_TARGET_ANCHOR)
      .map((row) => row.joint)
    return {
      acceptedDecisionContextHasTargetLine: String(warning.rows[0]?.context ?? '').includes(`Линия: ${MOVE_TARGET_LINE}`),
      completedPreControlCount: Number(preControls.rows[0]?.count ?? 0),
      movedJoints,
      sourceHistory: {
        pstoResult: source?.psto_result ?? null,
        tvmtConclusion: source?.tvmt_conclusion ?? null,
        tvmtResult: source?.tvmt_result ?? null,
      },
      sourceLineJoints: rows.rows.filter((row) => row.line === MOVE_SOURCE_LINE).map((row) => row.joint),
      targetLineJoints: rows.rows.filter((row) => row.line === MOVE_TARGET_LINE).map((row) => row.joint),
      promotedControl: {
        conclusion: promoted?.vik_conclusion ?? null,
        result: promoted?.vik_result ?? null,
      },
    }
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

async function removeCoilJointsOutOfBand(joints: string[]) {
  await withE2eDatabase(async (client) => {
    await client.query(`
      delete from weld_joints
      where project_title = $1 and line = $2 and joint = any($3::text[])
    `, [PROJECT, LINE, joints])
    await client.query(`
      insert into dispatcher_task_index_state
        (id, source_revision, computed_revision, full_rebuild, updated_at)
      values (1, 1, -1, true, now())
      on conflict (id) do update
      set source_revision = dispatcher_task_index_state.source_revision + 1,
          full_rebuild = true,
          updated_at = now()
    `)
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
  await expect(page.getByText(/создан принятым решением.*нельзя удалить отдельно/i)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })
}

async function assertDirectEarlyCoilSourceDeletionIsBlocked(page: Page, sourceRowId: number) {
  await page.goto('/journal')
  const row = page.locator(`tr[data-weld-row-id="${sourceRowId}"]`)
  await row.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Подтверждение удаления', exact: true })).toBeVisible()
  await page.getByLabel('Пароль', { exact: true }).fill(DELETE_PASSWORD)
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Удалить стык', exact: true })).toBeVisible()
  const confirmDialog = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/является основанием.*исходный стык нельзя удалить/i)).toBeVisible()
  await expect.poll(() => loadExistingJoints(PROJECT, LINE, [SOURCE_JOINT])).toEqual([SOURCE_JOINT])
}

async function assertDirectCoilPairDeletionIsBlocked(page: Page) {
  const rowIds = await Promise.all(COIL_JOINTS.map(loadJointId))
  await page.goto('/journal')
  for (const [index, rowId] of rowIds.entries()) {
    const row = page.locator(`tr[data-weld-row-id="${rowId}"]`)
    await row.getByRole('button', { name: `Выбрать стык ${COIL_JOINTS[index]}`, exact: true }).click()
  }

  await page.getByRole('button', { name: 'Действия', exact: true }).click()
  const deleteSelectedAction = page.getByRole('button', { name: 'Удалить выбранные (2)', exact: true })
  await deleteSelectedAction.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await deleteSelectedAction.click()
  const passwordHeading = page.getByRole('heading', { name: 'Подтверждение удаления', exact: true })
  if (await passwordHeading.isVisible()) {
    await page.getByLabel('Пароль', { exact: true }).fill(DELETE_PASSWORD)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Удалить выбранные стыки', exact: true })).toBeVisible()
  const confirmDialog = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/создан принятым решением.*нельзя удалить отдельно/i)).toBeVisible()
  await expect.poll(loadEarlyCoilState).toEqual({
    accepted: true,
    expectedRepairExists: false,
    coilJoints: [...COIL_JOINTS],
  })
}

async function recreateCoilFromDispatcher(page: Page, targets: string[]) {
  const taskGroup = await openDispatcherObjectGroup(page, SOURCE_JOINT, 'ДЗ-09')
  await expect(taskGroup).toContainText(`Создать ${targets.join(' + ')}`)
  await taskGroup.getByRole('button', { name: 'Катушка', exact: true }).click()
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

async function seedDeletionRecoveryChains() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ id: number; joint: string }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality,
        d1, d2, t1, t2, wdi,
        has_vik, vik_control_basis, vik_request, vik_request_date,
        vik_result, vik_conclusion_date, vik_conclusion, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values
        ('2026-09-01', $1, 'E2E-CHAIN', $2, 'ISO-E2E-CHAIN', 'S961', 'E2E-CHAIN-S1',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S961', '2026-09-01', 'ремонт', '2026-09-01', 'Заключение S961', 'ремонт', now(), now(), now()),
        ('2026-09-02', $1, 'E2E-CHAIN', $2, 'ISO-E2E-CHAIN', 'S961R1', 'E2E-CHAIN-S1',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S961R1', '2026-09-02', 'ремонт', '2026-09-02', 'Заключение S961R1', 'ремонт', now(), now(), now()),
        ('2026-09-03', $1, 'E2E-CHAIN', $2, 'ISO-E2E-CHAIN', 'S961R2', 'E2E-CHAIN-S1',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S961R2', '2026-09-03', 'ремонт', '2026-09-03', 'Заключение S961R2', 'ремонт', now(), now(), now()),
        ('2026-09-01', $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971', 'E2E-CHAIN-S2',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S971', '2026-09-01', 'вырез', '2026-09-01', 'Заключение S971', 'вырез', now(), now(), now()),
        ('2026-09-02', $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971W1', 'E2E-CHAIN-S2',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S971W1', '2026-09-02', 'вырез', '2026-09-02', 'Заключение S971W1', 'вырез', now(), now(), now()),
        ('2026-09-03', $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971W2', 'E2E-CHAIN-S2',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S971W2', '2026-09-03', 'вырез', '2026-09-03', 'Заключение S971W2', 'вырез', now(), now(), now()),
        ('2026-09-04', $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971W3', 'E2E-CHAIN-S2',
          'действующий', 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', 'Заявка S971W3', '2026-09-04', 'вырез', '2026-09-04', 'Заключение S971W3', 'вырез', now(), now(), now()),
        (null, $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971Y1', 'E2E-CHAIN-S2',
          null, 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', null, null, null, null, null, 'ожидает сварку', now(), now(), now()),
        (null, $1, 'E2E-CHAIN', $2, 'ISO-E2E-COIL', 'S971Y2', 'E2E-CHAIN-S2',
          null, 'актуальная', 108, 108, 4, 4, 0.42,
          'да', 'проект', null, null, null, null, null, 'ожидает сварку', now(), now(), now())
      returning id, joint
    `, [RECOVERY_PROJECT, RECOVERY_LINE])
    await client.query(`
      insert into dispatcher_task_index_state
        (id, source_revision, computed_revision, full_rebuild, updated_at)
      values (1, 1, -1, true, now())
      on conflict (id) do update
      set source_revision = dispatcher_task_index_state.source_revision + 1,
          full_rebuild = true,
          updated_at = now()
    `)
    return new Map(result.rows.map((row) => [row.joint, row.id]))
  })
}

async function deleteJournalRows(page: Page, rows: Array<{ id: number; joint: string }>) {
  await page.goto('/journal')
  if (rows.length === 1) {
    const row = page.locator(`tr[data-weld-row-id="${rows[0].id}"]`)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Удалить', exact: true }).click()
  } else {
    for (const rowInfo of rows) {
      const row = page.locator(`tr[data-weld-row-id="${rowInfo.id}"]`)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: `Выбрать стык ${rowInfo.joint}`, exact: true }).click()
    }
    await page.getByRole('button', { name: 'Действия', exact: true }).click()
    const deleteAction = page.getByRole('button', { name: `Удалить выбранные (${rows.length})`, exact: true })
    await deleteAction.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await deleteAction.click()
  }

  const passwordHeading = page.getByRole('heading', { name: 'Подтверждение удаления', exact: true })
  if (await passwordHeading.isVisible()) {
    await page.getByLabel('Пароль', { exact: true }).fill(DELETE_PASSWORD)
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  }
  const confirmTitle = rows.length === 1 ? 'Удалить стык' : 'Удалить выбранные стыки'
  await expect(page.getByRole('heading', { name: confirmTitle, exact: true })).toBeVisible()
  const confirmDialog = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmDialog.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(() => loadExistingJoints(
    RECOVERY_PROJECT,
    RECOVERY_LINE,
    rows.map((row) => row.joint),
  )).toEqual([])
}

async function openDispatcherObjectGroup(page: Page, baseJoint: string, code: string) {
  await page.goto('/journal')
  const codeGroup = page.getByLabel('Диспетчер задач', { exact: true })
    .locator('[data-dispatcher-code-group]')
    .filter({ has: page.getByText(code, { exact: true }) })
  await expect(codeGroup).toBeVisible()
  await codeGroup.locator('summary').first().click()
  const summary = codeGroup.locator('[data-dispatcher-object-summary]')
    .filter({ hasText: baseJoint })
    .first()
  for (let batch = 0; batch < 100 && !await summary.isVisible(); batch += 1) {
    const showMore = codeGroup.getByRole('button', { name: 'Показать ещё' })
    if (!await showMore.isVisible()) break
    await showMore.click()
  }
  await expect(summary).toBeVisible({ timeout: 15_000 })
  await summary.click()
  return summary.locator('..')
}

async function expectDispatcherCreateAction(taskGroup: ReturnType<Page['locator']>, targetJoint: string) {
  const target = taskGroup.getByText(targetJoint, { exact: true })
  await expect(target).toBeVisible()
  const card = target.locator('xpath=ancestor::div[contains(@class,"grid")][1]')
  await expect(card.getByRole('button', { name: 'Создать', exact: true })).toBeVisible()
}

async function expectDispatcherCoilAction(taskGroup: ReturnType<Page['locator']>, targetJoints: string[]) {
  const label = `катушка ${targetJoints.join(' + ')}`
  const target = taskGroup.getByText(label, { exact: true })
  await expect(target).toBeVisible()
  const card = target.locator('xpath=ancestor::div[contains(@class,"grid")][1]')
  await expect(card.getByRole('button', { name: 'Катушка', exact: true })).toBeVisible()
}

async function clickDispatcherAction(
  taskGroup: ReturnType<Page['locator']>,
  targetText: string,
  action: 'Создать' | 'Катушка',
) {
  const target = taskGroup.getByText(targetText, { exact: true })
  const card = target.locator('xpath=ancestor::div[contains(@class,"grid")][1]')
  await card.getByRole('button', { name: action, exact: true }).click()
}

async function loadJointIds(project: string, line: string, joints: readonly string[]) {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ id: number; joint: string }>(`
      select id, joint
      from weld_joints
      where project_title = $1 and line = $2 and joint = any($3::text[])
    `, [project, line, joints])
    return new Map(result.rows.map((row) => [row.joint, row.id]))
  })
}

async function loadExistingJoints(project: string, line: string, joints: readonly string[]) {
  const ids = await loadJointIds(project, line, joints)
  return joints.filter((joint) => ids.has(joint))
}
