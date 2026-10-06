import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import {
  listColumnFilterOptions, listReportPage, normalizeWeldColumnFilterOptionsRequest, normalizeWeldPageRequest,
} from '@/server/weld-read'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import type { WeldReportKind } from '@/server/weld-contracts'
import { LAYERED_CONTROL_WAITING_LABEL } from '@/lib/layered-control-documents'
import { LNK_VISIBLE_FIELD_SECTIONS } from '@/lib/lnk-visible-field-layout'

const project = 'E2E document filters'
const ids: number[] = []

test.beforeAll(async () => {
  await withE2eDatabase(async (client) => {
    for (let i = 1; i <= 6; i++) {
      const result = await client.query(`insert into weld_joints
        (project_title, line, joint, weld_date, has_vik, psto_required, vik_control_basis)
        values ($1, 'DF-LINE', $2, $3, $4, $5, 'DOC-FILTER') returning id`,
      [project, `DF${i}`, i === 4 ? null : '2026-09-01', i === 5 ? null : 'да', i <= 3 ? 'да' : null])
      ids.push(result.rows[0].id)
    }
    for (const [index, type, title] of [
      [0, 'layeredPvkEdges', 'ПВК общий'],
      [0, 'layeredPvkLayers', 'ПВК общий'], // Same title on two stages counts this joint only once.
      [1, 'layeredPvkEdges', 'ПВК общий'], // Partial legacy set is not empty.
      [0, 'layeredVikEdges', 'ВИК первый'],
      [1, 'layeredVikLayers', 'ВИК второй'],
      [3, 'layeredPvkEdges', 'ПВК без даты'],
      [4, 'layeredPvkEdges', 'ПВК без назначения'],
      [5, 'layeredPvkLayers', 'ПВК без ПСТО'],
    ] as const) {
      const document = await client.query(`insert into generated_documents
        (type, title, file_name, mime_type, row_count) values ($1, $2, 'filter-test.xlsx', 'application/octet-stream', 1) returning id`, [type, title])
      await client.query('insert into generated_document_weld_joints (document_id, weld_joint_id) values ($1, $2)', [document.rows[0].id, ids[index]])
    }
  })
})

for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
  test(`${report}: послойные фильтры учитывают документы, границы отчета и составные условия`, async () => {
    const options = (fieldKey: 'layeredPvkDocuments' | 'layeredVikDocuments', columnFilters: Record<string, string> = {}) =>
      listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({
        report, fieldKey, columnFilters: { projectTitle: `=${project}`, ...columnFilters },
      }))
    const base = await options('layeredPvkDocuments')
    expect(base).toContainEqual({ value: '', label: '(пусто)', count: 1 })
    expect(base).toContainEqual({ value: 'ПВК общий', label: 'ПВК общий', count: 2 })
    expect(base.map((option) => option.value).sort()).toEqual([
      '', 'ПВК общий', ...(report !== 'heatTreatment' ? ['ПВК без ПСТО'] : []),
      ...(report === 'weldingJournal' ? ['ПВК без даты', 'ПВК без назначения'] : []),
    ].sort())
    // Own selection does not remove alternatives; a derived pre-TO filter must preserve document titles.
    expect(await options('layeredPvkDocuments', { layeredPvkDocuments: '=ПВК общий' })).toEqual(base)
    expect(await options('layeredPvkDocuments', { preVikConclusion: '=' })).toEqual(base)
    expect(await options('layeredPvkDocuments', { layeredVikDocuments: '=ВИК первый' })).toEqual([
      { value: 'ПВК общий', label: 'ПВК общий', count: 1 },
    ])
    expect(await options('layeredPvkDocuments', { joint: '=нет такого стыка' })).toEqual([])

    for (const extra of [{}, { preVikConclusion: '=' }]) {
      expect(await filteredIds(report, { layeredPvkDocuments: '=ПВК общий', ...extra })).toEqual(ids.slice(0, 2))
      expect(await filteredIds(report, { layeredPvkDocuments: buildWeldColumnValueFilter(['']), ...extra })).toEqual([ids[2]])
      expect(await filteredIds(report, { layeredPvkDocuments: buildWeldColumnValueFilter(['ПВК общий', '']), ...extra })).toEqual(ids.slice(0, 3))
      expect(await filteredIds(report, { layeredPvkDocuments: '=ПВК общий', layeredVikDocuments: '=ВИК второй', ...extra })).toEqual([ids[1]])
    }
    if (report !== 'heatTreatment') {
      expect(await options('layeredPvkDocuments', { controlBasisSummary: 'DOC-FILTER' })).toEqual(base)
      expect(await filteredIds(report, { layeredPvkDocuments: '=ПВК общий', controlBasisSummary: 'DOC-FILTER' })).toEqual(ids.slice(0, 2))
    }
  })
}

async function filteredIds(report: WeldReportKind, columnFilters: Record<string, string>) {
  const result = await listReportPage(report, normalizeWeldPageRequest({
    report, columnFilters: { projectTitle: `=${project}`, ...columnFilters },
  }))
  expect(result.total).toBe(result.rows.length)
  return result.rows.map((row) => row.id).sort((a, b) => a - b)
}

test('назначенный послойный контроль без основного ПВК виден как ожидание и отдельно фильтруется', async ({ page }) => {
  const waitingProject = 'E2E layered waiting'
  const cases = [
    { joint: 'WAIT-1', assigned: true, result: 'ожидает НК' },
    { joint: 'WAIT-2', assigned: false, result: null },
    { joint: 'WAIT-3', assigned: true, result: null }, // Partial historical documents must stay visible.
    ...['годен', 'ремонт', 'вырез', 'да', 'проведено', ' ГОДЕН (ОТМЕНЕН) ', 'проведено (отменен)']
      .flatMap(result => [result, `${result.trim()} · назначение отменено`]).map((result, index) =>
      ({ joint: `DONE-${index}`, assigned: true, result })),
    { joint: 'WAIT-4', assigned: true, result: null }, // Pre-TO and duplicate PVK do not complete primary PVK.
  ]
  await withE2eDatabase(async (client) => {
    for (const item of cases) {
      const record = await client.query(`insert into weld_joints
        (project_title, line, joint, weld_date, has_vik, has_pvk, psto_required, layered_control_assigned, pvk_result)
        values ($1, 'WAIT-LINE', $2, '2026-09-01', 'да', 'да', 'да', $3, $4) returning id`,
      [waitingProject, item.joint, item.assigned, item.result])
      const id = record.rows[0].id
      if (item.joint === 'WAIT-3') {
        for (const type of ['layeredVikEdges', 'layeredPvkEdges']) {
          const doc = await client.query(`insert into generated_documents (type, title, file_name, mime_type, row_count)
            values ($1, 'Исторические кромки', 'historical.xlsx', 'application/octet-stream', 1) returning id`, [type])
          await client.query('insert into generated_document_weld_joints (document_id, weld_joint_id) values ($1, $2)', [doc.rows[0].id, id])
        }
      }
      if (item.joint === 'WAIT-4') {
        await client.query("insert into pre_heat_treatment_controls (weld_joint_id, method, result) values ($1, 'ПВК', 'годен')", [id])
        await client.query("insert into duplicate_controls (weld_joint_id, method, result) values ($1, 'ПВК', 'годен')", [id])
      }
    }
  })

  for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) {
    for (const fieldKey of ['layeredVikDocuments', 'layeredPvkDocuments'] as const) {
      const base = { projectTitle: `=${waitingProject}` }
      const options = await listColumnFilterOptions(normalizeWeldColumnFilterOptionsRequest({ report, fieldKey, columnFilters: base }))
      expect(options).toEqual(expect.arrayContaining([
        { value: LAYERED_CONTROL_WAITING_LABEL, label: LAYERED_CONTROL_WAITING_LABEL, count: 2 },
        { value: '', label: '(пусто)', count: 15 },
        { value: 'Исторические кромки', label: 'Исторические кромки', count: 1 },
      ]))
      for (const filter of [`=${LAYERED_CONTROL_WAITING_LABEL}`, 'ожидает основного', buildWeldColumnValueFilter([LAYERED_CONTROL_WAITING_LABEL])]) {
        const result = await listReportPage(report, normalizeWeldPageRequest({ report, columnFilters: { ...base, [fieldKey]: filter } }))
        expect(result.rows.map((row) => row.joint).sort()).toEqual(['WAIT-1', 'WAIT-4'])
        expect(result.total).toBe(2)
      }
      const empty = await listReportPage(report, normalizeWeldPageRequest({ report, columnFilters: { ...base, [fieldKey]: '=' } }))
      expect(empty.total).toBe(15)
      expect(empty.rows.map((row) => row.joint)).not.toContain('WAIT-1')
    }
  }

  const visible = new Set(['joint', 'layeredVikDocuments', 'layeredPvkDocuments'])
  const hidden = LNK_VISIBLE_FIELD_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)).filter((key) => !visible.has(key))
  await page.addInitScript((hiddenFieldKeys) => {
    localStorage.setItem('welding-report-view:v1:lnk', JSON.stringify({
      activePreset: 'custom', hiddenFieldKeys, customHiddenFieldKeys: hiddenFieldKeys, collapsedSections: [], savedViews: [],
    }))
  }, hidden)
  await page.goto('/lnk')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(waitingProject)
  const row = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'WAIT-1', exact: true }) })
  await expect(row.getByText(LAYERED_CONTROL_WAITING_LABEL, { exact: true })).toHaveCount(2)
  await expect(row.getByRole('button', { name: 'Кромки', exact: true })).toHaveCount(0)
  await row.screenshot({ path: 'outputs/layered-waiting-state-20260927.png' })
  await page.getByRole('button', { name: 'Послойный ПВК. Открыть фильтр', exact: true }).click()
  const filter = page.getByRole('dialog', { name: 'Фильтр: Послойный ПВК' })
  await filter.getByRole('button', { name: new RegExp(LAYERED_CONTROL_WAITING_LABEL) }).click()
  await expect(row).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать стык WAIT-2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Выбрать стык WAIT-3', exact: true })).toHaveCount(0)
  await filter.getByRole('button', { name: 'Очистить', exact: true }).click()
  await filter.getByRole('button', { name: /\(пусто\)/ }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Выбрать стык WAIT-2', exact: true })).toBeVisible()
})
