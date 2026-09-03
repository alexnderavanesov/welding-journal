import { expect, test, type Page } from '@playwright/test'

import { withE2eDatabase } from '../database'

const JOINT = 'F217'
const WELD_DATE = '2026-08-15'
const STAMP = 'E2K7'
const CONTROL_SETTINGS_KEY = 'control-processes'
const LAYERED_INDEX_KEY = 'layered-control-document-index-version'

test('автоматически создает четыре послойных заключения для сваренного У-стыка', async ({ page }) => {
  await seedLayeredControlJoint()

  await page.goto('/lnk')
  await expect(page.getByText(JOINT, { exact: true }).first()).toBeVisible()

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

  await expect.poll(() => loadWorkflowFields()).toEqual({
    vikRequest: null,
    vikResult: null,
    pvkRequest: null,
    pvkResult: null,
  })
  const originalDocumentIdentities = await loadLayeredDocumentIdentities()

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

  await changeVikAssignment(page, 'Отменен')
  await expect.poll(() => loadVikAssignment()).toBe('отменен')
  await expect.poll(() => loadLayeredDocumentIdentities()).toEqual(originalDocumentIdentities)
  await expect.poll(() => loadNextNumbers()).toEqual({
    layeredPvkEdges: 2,
    layeredPvkLayers: 2,
    layeredVikEdges: 2,
    layeredVikLayers: 2,
  })

  await changeVikAssignment(page, 'Да')
  await expect.poll(() => loadVikAssignment()).toBe('да')
  await expect.poll(() => loadLayeredDocumentIdentities()).toEqual(originalDocumentIdentities)
})

async function seedLayeredControlJoint() {
  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into app_settings (key, value, updated_at)
      values ($1, $2, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `, [CONTROL_SETTINGS_KEY, JSON.stringify({
      layeredControlEnabled: true,
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
    `, [WELD_DATE, JOINT, STAMP])
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
    `, [STAMP])
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

async function changeVikAssignment(page: Page, value: 'Да' | 'Отменен') {
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
  const vikAssignment = editor.getByText('Назначение ВИК', { exact: true }).locator('..')
  await vikAssignment.getByRole('button', { name: new RegExp(`^${value}`) }).click()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
}

function formatDatabaseDate(value: string | Date) {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
