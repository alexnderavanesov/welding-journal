import { rpcName } from '../rpc'
import { expect, test, type Page } from '@playwright/test'
import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'

import { withE2eDatabase } from '../database'

const JOINT = 'F217'
const WELD_DATE = '2026-08-15'
const STAMP = 'E2K7'
const CONTROL_SETTINGS_KEY = 'control-processes'
const LAYERED_INDEX_KEY = 'layered-control-document-index-version'

test('создает комплект только по явному назначению и удаляет его отдельно от обычного ПВК', async ({ page }) => {
  await seedLayeredControlJoint()

  await page.goto('/lnk')
  await expect(page.getByText(JOINT, { exact: true }).first()).toBeVisible()
  expect(await loadLayeredDocuments()).toEqual([])
  const initialWorkflow = await loadWorkflowFields()
  await changeLayeredAssignment(page, true)

  await expect.poll(() => loadLayeredDocuments()).toEqual([
    {
      type: 'layeredPvkEdges',
      title: `ПВК - кромки - ${JOINT} - 15.08.2026`,
      documentNumber: 1,
      periodFrom: WELD_DATE,
      periodTo: WELD_DATE,
      rowCount: 1,
    },
    {
      type: 'layeredPvkLayers',
      title: `ПВК - слои - ${JOINT} - 15.08.2026`,
      documentNumber: 1,
      periodFrom: WELD_DATE,
      periodTo: WELD_DATE,
      rowCount: 1,
    },
    {
      type: 'layeredVikEdges',
      title: `ВИК - кромки - ${JOINT} - 15.08.2026`,
      documentNumber: 1,
      periodFrom: WELD_DATE,
      periodTo: WELD_DATE,
      rowCount: 1,
    },
    {
      type: 'layeredVikLayers',
      title: `ВИК - слои - ${JOINT} - 15.08.2026`,
      documentNumber: 1,
      periodFrom: WELD_DATE,
      periodTo: WELD_DATE,
      rowCount: 1,
    },
  ])

  await expect.poll(() => loadNextNumbers()).toEqual({
    layeredPvkEdges: 2,
    layeredPvkLayers: 2,
    layeredVikEdges: 2,
    layeredVikLayers: 2,
  })

  await expect.poll(() => loadWorkflowFields()).toEqual(initialWorkflow)
  const originalDocumentIdentities = await loadLayeredDocumentIdentities()

  const visibleFields = new Set(['joint', 'layeredVikDocuments', 'layeredPvkDocuments'])
  const hiddenFields = LNK_VISIBLE_FIELD_SECTIONS.flatMap((section) => section.fields.map((field) => field.key))
    .filter((key) => !visibleFields.has(key))
  await page.addInitScript((hiddenFieldKeys) => {
    localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys, customHiddenFieldKeys: hiddenFieldKeys,
      collapsedSections: [], savedViews: [],
    }))
  }, hiddenFields)
  await page.goto('/lnk')
  await page.waitForLoadState('networkidle')
  for (const method of ['ВИК', 'ПВК']) {
    await page.getByRole('button', { name: `Послойный ${method}. Открыть фильтр`, exact: true }).click()
    const filter = page.getByRole('dialog', { name: `Фильтр: Послойный ${method}` })
    const edges = filter.getByRole('button', { name: new RegExp(`${method} - кромки - ${JOINT}`) })
    const layers = filter.getByRole('button', { name: new RegExp(`${method} - слои - ${JOINT}`) })
    await expect(edges).toBeVisible()
    await expect(layers).toBeVisible()
    await edges.click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: `Выбрать стык ${JOINT}`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выбрать стык F1', exact: true })).toHaveCount(0)
    await filter.getByRole('button', { name: 'Очистить', exact: true }).click()
    await filter.getByRole('button', { name: /\(пусто\)/ }).click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: `Выбрать стык ${JOINT}`, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Выбрать стык F1', exact: true })).toBeVisible()
    await filter.getByRole('button', { name: 'Очистить', exact: true }).click()
    await filter.getByRole('button', { name: 'Закрыть', exact: true }).click()
  }

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Послойный ВИК', exact: true }).click()
  await expect(page.getByRole('button', {
    name: `ВИК - кромки - ${JOINT} - 15.08.2026`,
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('button', {
    name: `ВИК - слои - ${JOINT} - 15.08.2026`,
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Формирование', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Послойный ПВК', exact: true }).click()
  await expect(page.getByRole('button', {
    name: `ПВК - кромки - ${JOINT} - 15.08.2026`,
    exact: true,
  })).toBeVisible()
  await expect(page.getByRole('button', {
    name: `ПВК - слои - ${JOINT} - 15.08.2026`,
    exact: true,
  })).toBeVisible()

  await page.reload()
  await expect.poll(() => loadLayeredDocumentIdentities()).toEqual(originalDocumentIdentities)
  await expect.poll(() => loadNextNumbers()).toEqual({
    layeredPvkEdges: 2,
    layeredPvkLayers: 2,
    layeredVikEdges: 2,
    layeredVikLayers: 2,
  })

  await changeLayeredAssignment(page, false)
  await expect.poll(() => loadLayeredDocuments()).toEqual([])
  await expect.poll(() => loadWorkflowFields()).toEqual(initialWorkflow)
  await expect.poll(() => loadVikAssignment()).toBe('да')
})

test('послойное назначение вместе с результатом ПВК атомарно; ПКМ удаляет и возвращает только комплект', async ({ page }) => {
  const joint = 'F218'
  const pvkDate = '2026-08-17'
  await seedLayeredControlJoint(joint, 'E2K8')
  await withE2eDatabase(async (client) => {
    await client.query("update weld_joints set has_pvk = 'да', pvk_result = 'ожидает НК', pvk_conclusion = null, pvk_conclusion_date = null, pvk_request_date = $2 where joint = $1", [joint, pvkDate])
  })
  const loadState = () => withE2eDatabase(async (client) => (await client.query(`
    select w.layered_control_assigned, w.has_pvk, w.pvk_result, w.pvk_conclusion,
      w.pvk_request, w.pvk_request_date, w.pvk_conclusion_date,
      w.vik_result, w.vik_conclusion, w.rk_result, w.uzk_result,
      (select count(*)::integer from generated_documents d join generated_document_weld_joints a on a.document_id = d.id
        where a.weld_joint_id = w.id and d.type like 'layered%') as layered_count,
      (select count(*)::integer from generated_documents d join generated_document_weld_joints a on a.document_id = d.id
        where a.weld_joint_id = w.id and d.type = 'system:lnkConclusionPvk') as ordinary_count
    from weld_joints w where joint = $1`, [joint])).rows[0])
  await page.goto('/lnk')
  const row = () => page.getByRole('button', { name: `Выбрать стык ${joint}`, exact: true }).locator('xpath=ancestor::tr')
  await row().getByRole('button', { name: 'Выполнить: Внести результат основного НК', exact: true }).click()
  const resultDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
  await resultDialog.getByLabel('Метод контроля', { exact: true }).selectOption('pvkRequest')
  await resultDialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('годен')
  // A result before its request (but after welding) offers both date-correction actions.
  await resultDialog.getByLabel('Дата контроля', { exact: true }).fill('2026-08-16')
  const footer = resultDialog.getByRole('group', { name: 'Сохранение результата', exact: true })
  const layeredControl = resultDialog.getByRole('checkbox', { name: `Послойный контроль: E2E-LAYER-L1 · ${joint}`, exact: true })
  await expect(footer.getByRole('checkbox')).toHaveCount(0)
  const save = footer.getByRole('button', { name: 'Сохранить результат', exact: true })
  const warning = footer.getByText(/Сохранение заблокировано: ЗВ-/)
  await expect(warning).toBeVisible()
  await layeredControl.check()
  await expect(save).toBeDisabled()
  const correction = footer.getByRole('button', { name: 'Исправить дату заключения ПВК', exact: true })
  await expect(correction).toBeVisible()
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1000, height: 720 }]) {
    await page.setViewportSize(viewport)
    await layeredControl.scrollIntoViewIfNeeded()
    await expect(layeredControl).toBeInViewport()
    await expect(save).toBeInViewport()
    await expect(correction).toBeInViewport()
    await expect.poll(async () => {
      const [optionBox, saveBox, warningBox, correctionBox] = await Promise.all([
        layeredControl.locator('xpath=ancestor::label').boundingBox(), save.boundingBox(),
        warning.boundingBox(), correction.boundingBox(),
      ])
      if (!optionBox || !saveBox || !warningBox || !correctionBox) return false
      return optionBox.y + optionBox.height <= warningBox.y
        && Math.max(warningBox.y + warningBox.height, correctionBox.y + correctionBox.height) <= saveBox.y
        && saveBox.y + saveBox.height <= viewport.height
    }).toBe(true)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: 'outputs/lnk-layered-row-zv-20260927.png' })
  await correction.click()
  await expect(resultDialog.getByLabel('Дата контроля', { exact: true })).toBeFocused()
  await expect(layeredControl).toBeChecked()
  await resultDialog.getByLabel('Дата контроля', { exact: true }).fill(pvkDate)
  await expect(warning).toHaveCount(0)
  await expect(layeredControl).toBeChecked()
  await resultDialog.getByRole('tab', { name: /Заключения и имена/ }).click()
  await expect(layeredControl).toHaveCount(0)
  await resultDialog.getByRole('tab', { name: 'Стыки', exact: true }).click()
  await expect(layeredControl).toBeChecked()
  await resultDialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Назначить послойный контроль?', exact: true }) })
    .getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await loadState()).toMatchObject({ layered_control_assigned: false, pvk_result: 'ожидает НК', pvk_conclusion: null, layered_count: 0, ordinary_count: 0 })
  await resultDialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  await page.getByRole('button', { name: 'Назначить и сохранить', exact: true }).click()
  await expect(resultDialog).toBeHidden()
  await expect.poll(loadState).toMatchObject({ layered_control_assigned: true, has_pvk: 'да', pvk_result: 'годен', layered_count: 4, ordinary_count: 1 })
  const saved = await loadState()
  expect(saved).toMatchObject({ vik_result: 'годен', vik_conclusion: 'VIK-RESULT-E2E' })
  for (const result of [saved.rk_result, saved.uzk_result]) expect(['годен', 'ремонт', 'вырез']).not.toContain(result)

  await row().getByRole('button', { name: joint, exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click()
  await page.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
  await page.getByRole('button', { name: 'Убрать', exact: true }).click()
  await expect.poll(loadState).toEqual({ ...saved, layered_control_assigned: false, layered_count: 0 })
  await row().getByRole('button', { name: joint, exact: true }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Дополнительно', exact: true }).click()
  await page.getByRole('button', { name: 'Назначить послойный контроль', exact: true }).click()
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()
  await expect.poll(loadState).toEqual(saved)

  const requests: string[] = []
  page.on('request', (request) => {
    const id = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (!id) return
    try { requests.push(rpcName(request.url())) } catch { /* Non-RPC request. */ }
  })
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Все результаты ЛНК', exact: true }).click()
  const manager = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование результатов ЛНК', exact: true }) })
  await manager.getByLabel('Вид контроля в реестре').selectOption('pvkRequest')
  await manager.getByRole('button', { name: /E2E-LAYER-L1 · F218/ }).click()
  const removeLayered = manager.getByRole('button', { name: 'Убрать послойный контроль', exact: true })
  await expect(removeLayered).toBeEnabled()
  await expect(manager.getByText(/обычный ПВК сохранится/)).toBeVisible()
  await page.waitForLoadState('networkidle')
  const workflowReadsBefore = requests.filter((name) => name.startsWith('listLnkWorkflowRows_')).length
  const conclusionName = manager.getByPlaceholder('Наименование заключения для этого стыка')
  await conclusionName.fill('Несохранённое имя')
  await expect(removeLayered).toBeDisabled()
  await conclusionName.fill(saved.pvk_conclusion)
  await expect(removeLayered).toBeEnabled()
  await manager.screenshot({ path: 'outputs/lnk-manager-layered-removal-20260927.png' })
  await removeLayered.click()
  const removeConfirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Убрать послойный контроль?', exact: true }) })
  await expect(removeConfirmation.getByText('E2E-LAYER-L1 · F218', { exact: true })).toBeVisible()
  await removeConfirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(removeLayered).toBeEnabled()
  expect(await loadState()).toEqual(saved)
  expect(requests.filter((name) => name.startsWith('changeLayeredControl_'))).toHaveLength(0)
  await removeLayered.click()
  await removeConfirmation.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
  await expect.poll(loadState).toEqual({ ...saved, layered_control_assigned: false, layered_count: 0 })
  await expect(removeLayered).toHaveCount(0)
  await expect(manager.getByRole('status')).toContainText('Обычный результат ПВК, его заявка и заключение сохранены')
  await expect(manager.getByRole('heading', { name: 'E2E-LAYER-L1 · F218', exact: true })).toBeVisible()
  await expect(conclusionName).toHaveValue(saved.pvk_conclusion)
  await page.waitForLoadState('networkidle')
  expect(requests.filter((name) => name.startsWith('changeLayeredControl_'))).toHaveLength(1)
  expect(requests.filter((name) => name.startsWith('listLnkWorkflowRows_'))).toHaveLength(workflowReadsBefore)
  await manager.getByLabel('Вид контроля в реестре').selectOption('vikRequest')
  await expect(removeLayered).toHaveCount(0)
  await expect(manager.getByRole('status')).toHaveCount(0)
  await manager.getByRole('button', { name: 'Закрыть', exact: true }).click()
})

test('послойные отметки сохраняются отдельно для У-стыков смешанной заявки, назначенная отметка заблокирована', async ({ page }) => {
  const joints = ['F219', 'F220', 'F221', 'F222']
  for (let index = 0; index < joints.length; index++) await seedLayeredControlJoint(joints[index], `E2M${index}`)
  await withE2eDatabase(async (client) => {
    await client.query(`update weld_joints set pvk_request = 'PVK-MIX', spool = 'PVK-MIX', has_pvk = 'да',
      pvk_result = 'ожидает НК', pvk_conclusion = null, pvk_conclusion_date = null,
      layered_control_assigned = (joint = 'F219'), connection_type = case when joint = 'F222' then 'С17' else 'У17' end
      where joint = any($1::text[])`, [joints])
  })
  await page.goto('/lnk')
  await page.locator('header').getByRole('button', { name: 'Результат', exact: true }).click()
  await page.getByRole('button', { name: 'Внести результаты', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Внесение результатов ЛНК', exact: true }) })
  await dialog.getByLabel('Метод контроля', { exact: true }).selectOption('pvkRequest')
  const search = dialog.getByPlaceholder('Проект, шифр, линия, спул или стык')
  // The local list already contains these four rows before the debounced
  // server search finishes. Do not count that search as a checkbox request.
  const searchedRows = page.waitForResponse(response =>
    rpcName(response.url()).startsWith('listLnkWorkflowRows_') &&
    !!response.request().postData()?.includes('PVK-MIX') && response.ok())
  await search.fill('PVK-MIX')
  await (await searchedRows).finished()
  await expect(dialog.getByText('Найдено: 4 · Доступно: 4', { exact: true })).toBeVisible()
  for (const joint of joints) await expect(dialog.getByRole('checkbox', { name: `Выбрать стык E2E-LAYER-L1 ${joint}`, exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Выбрать все доступные', exact: true }).click()
  await dialog.getByLabel('Результат для всех выбранных', { exact: true }).selectOption('годен')
  await dialog.getByLabel('Дата контроля', { exact: true }).fill('2026-08-17')
  const layered = (joint: string) => dialog.getByRole('checkbox', { name: `Послойный контроль: E2E-LAYER-L1 · ${joint}`, exact: true })
  await expect(layered('F219')).toBeChecked()
  await expect(layered('F219')).toBeDisabled()
  await expect(layered('F219')).toHaveAccessibleDescription('Уже назначен · снятие — отдельной командой')
  await expect(layered('F222')).toHaveCount(0)
  await expect(dialog.getByRole('group', { name: 'Сохранение результата' }).getByRole('checkbox')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const rpc: string[] = []
  page.on('request', (request) => {
    const id = new URL(request.url()).pathname.split('/_serverFn/')[1]
    if (!id) return
    try { rpc.push(rpcName(request.url())) } catch { /* Non-RPC request. */ }
  })
  await layered('F220').check()
  await layered('F221').check()
  await layered('F221').uncheck()
  await expect(dialog.getByRole('checkbox', { name: 'Выбрать стык E2E-LAYER-L1 F220', exact: true })).toBeChecked()
  await page.waitForLoadState('networkidle')
  expect(rpc.filter((name) => name.startsWith('listLnkWorkflowRows_'))).toHaveLength(0)
  await dialog.screenshot({ path: 'outputs/lnk-layered-per-joint-20260927.png' })
  await dialog.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
  const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Назначить послойный контроль?', exact: true }) })
  await expect(confirm.getByText('Новых назначений: 1')).toBeVisible()
  await confirm.getByRole('button', { name: 'Назначить и сохранить', exact: true }).click()
  await expect(dialog).toBeHidden()
  const load = () => withE2eDatabase(async (client) => (await client.query(`select joint, layered_control_assigned, pvk_result,
    (select count(*)::integer from generated_document_weld_joints a join generated_documents d on d.id = a.document_id
      where a.weld_joint_id = w.id and d.type like 'layered%') as documents
    from weld_joints w where joint = any($1::text[]) order by joint`, [joints])).rows)
  await expect.poll(load).toEqual(joints.map((joint, index) => ({ joint, layered_control_assigned: index < 2, pvk_result: 'годен', documents: index < 2 ? 4 : 0 })))
})

async function seedLayeredControlJoint(joint = JOINT, stamp = STAMP) {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [CONTROL_SETTINGS_KEY, JSON.stringify({
      pvkGoodOnly: false,
      preHeatTreatmentLnkEnabled: true,
    })])
    await client.query('delete from app_settings where key = $1', [LAYERED_INDEX_KEY])
    await client.query(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact, has_vik, has_pvk,
        vik_control_basis, pvk_control_basis, final_status, welding_updated_at,
        lnk_created_at, lnk_updated_at
      ) values (
        $1, 'E2E послойный НК', 'E2E-LAYER', 'E2E-LAYER-L1', 'ISO-E2E-LAYER', $2, 'E2E-LAYER-S1',
        'действующий', 'актуальная', 'РД', 'У17', 'M01',
        108, 108, 4, 4, 0.42, $3, $3, 'да', 'дополнительный',
        'проект', 'проект', 'ожидает НК', now(), now(), now()
      )
    `, [WELD_DATE, joint, stamp])
    await client.query(`update weld_joints set vik_request = 'VIK-E2E', vik_request_date = $1,
      vik_result = 'годен', vik_conclusion = 'VIK-RESULT-E2E', vik_conclusion_date = $1,
      pvk_request = 'PVK-E2E', pvk_request_date = $1, pvk_result = 'годен',
      pvk_conclusion = 'PVK-RESULT-E2E', pvk_conclusion_date = $1 where joint = $2`, [WELD_DATE, joint])
    await client.query(`
      insert into welder_stamps (
        naks_stamp, welder_name, weld_type, material_groups,
        diameter_from, diameter_to, thickness_from, thickness_to,
        valid_from, valid_to, naks_permits
      ) values (
        $1, 'E2E послойный сварщик', 'РД', 'M01',
        '1', '1000', '1', '100', '2026-01-01', '2026-12-31',
        '[{"id":"e2e-layer-naks","weldType":"РД","materialGroups":"M01","diameterFrom":"1","diameterTo":"1000","thicknessFrom":"1","thicknessTo":"100","validFrom":"2026-01-01","validTo":"2026-12-31","note":"","archived":false}]'
      )
    `, [stamp])
  })
}

async function loadLayeredDocuments() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      type: string
      title: string
      document_number: number
      period_from: string | Date
      period_to: string | Date
      row_count: number
    }>(`
      select
        document.type,
        document.title,
        document.document_number,
        document.period_from,
        document.period_to,
        document.row_count
      from generated_documents document
      inner join generated_document_weld_joints assignment on assignment.document_id = document.id
      inner join weld_joints weld on weld.id = assignment.weld_joint_id
      where weld.joint = $1 and document.type like 'layered%'
      order by document.type
    `, [JOINT])
    return result.rows.map((row) => ({
      type: row.type,
      title: row.title,
      documentNumber: Number(row.document_number),
      periodFrom: formatDatabaseDate(row.period_from),
      periodTo: formatDatabaseDate(row.period_to),
      rowCount: Number(row.row_count),
    }))
  })
}

async function loadNextNumbers() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ key: string; value: string }>(`
      select key, value
      from app_settings
      where key like 'generated-document-next-number:layered%'
    `)
    return Object.fromEntries(result.rows.map((row) => [
      row.key.replace('generated-document-next-number:', ''),
      Number(JSON.parse(row.value)),
    ]))
  })
}

async function loadWorkflowFields() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      vik_request: string | null
      vik_result: string | null
      pvk_request: string | null
      pvk_result: string | null
    }>(`
      select vik_request, vik_result, pvk_request, pvk_result
      from weld_joints
      where joint = $1
    `, [JOINT])
    const row = result.rows[0]
    return {
      vikRequest: row?.vik_request ?? null,
      vikResult: row?.vik_result ?? null,
      pvkRequest: row?.pvk_request ?? null,
      pvkResult: row?.pvk_result ?? null,
    }
  })
}

async function loadLayeredDocumentIdentities() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      id: number
      type: string
      document_number: number
    }>(`
      select document.id, document.type, document.document_number
      from generated_documents document
      inner join generated_document_weld_joints assignment on assignment.document_id = document.id
      inner join weld_joints weld on weld.id = assignment.weld_joint_id
      where weld.joint = $1 and document.type like 'layered%'
      order by document.type
    `, [JOINT])
    return result.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      documentNumber: Number(row.document_number),
    }))
  })
}

async function loadVikAssignment() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ has_vik: string | null }>(
      'select has_vik from weld_joints where joint = $1',
      [JOINT],
    )
    return result.rows[0]?.has_vik ?? null
  })
}

async function changeLayeredAssignment(page: Page, assigned: boolean) {
  await page.goto('/journal')
  const row = page
    .getByRole('button', { name: `Выбрать стык ${JOINT}`, exact: true })
    .locator('xpath=ancestor::tr')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Редактировать', exact: true }).click()

  const editor = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Редактирование стыка' }),
  })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  if (assigned) {
    // The checkbox changes only after the custom confirmation is accepted.
    await editor.getByRole('checkbox', { name: 'Послойная замена РК/УЗК' }).click()
    const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Назначить послойный контроль?', exact: true }) })
    await confirmation.getByRole('button', { name: 'Перевести ПВК в «да»', exact: true }).click()
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(editor).toBeHidden()
  } else {
    const before = await loadLayeredDocumentIdentities()
    await editor.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
    const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Убрать послойный контроль?', exact: true }) })
    await expect(confirmation).toContainText(`E2E-LAYER-L1 · ${JOINT}`)
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(editor.getByRole('checkbox', { name: 'Послойная замена РК/УЗК' })).toBeChecked()
    expect(await loadLayeredDocumentIdentities()).toEqual(before)
    await editor.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Убрать послойный контроль', exact: true }).click()
    await expect(editor.getByRole('checkbox', { name: 'Послойная замена РК/УЗК' })).not.toBeChecked()
  }
}

function formatDatabaseDate(value: string | Date) {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
