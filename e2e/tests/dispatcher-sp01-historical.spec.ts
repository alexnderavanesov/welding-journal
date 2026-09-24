import { expect, test } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { DISPATCHER_TASK_CALCULATION_VERSION } from '@/lib/dispatcher-task-index-payload'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { attachDispatcherTaskCodesToPage } from '@/server/weld-read'
import { withE2eDatabase } from '../database'

for (const report of ['/journal', '/lnk', '/psto']) test(`СП-01 из ${report}: единые требования, сохранность ПСТО/ТВМТ и довнесение до ТО`, async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  const joint = 'F626'
  const ids: number[] = []
  let previousSetting: { value: string; updated_at: Date } | undefined
  let settingsChanged = false
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`) })
  try {
    await withE2eDatabase(async (client) => {
      previousSetting = (await client.query("select value, updated_at from app_settings where key = 'control-processes'")).rows[0]
      await client.query(`insert into app_settings (key, value) values ('control-processes', $1)
        on conflict (key) do update set value = excluded.value`, [JSON.stringify({
        ...DEFAULT_CONTROL_PROCESS_SETTINGS, ...JSON.parse(previousSetting?.value ?? '{}'),
        preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: false,
      })])
      settingsChanged = true
      const inserted = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik,
        officiality, revision_actuality, material_group, connection_type, welding_method,
        d1, d2, t1, t2, wdi, vik_control_basis, stamp_1_k, stamp_1_k_fact,
        pre_heat_treatment_lnk_exempt, final_status,
        psto_request, psto_request_date, psto_result, psto_date, heat_treatment_diagram,
        tvmt_request, tvmt_request_date, tvmt_result, tvmt_conclusion, tvmt_conclusion_date,
        vik_request, vik_request_date, vik_result, vik_conclusion, vik_conclusion_date
      ) values ($1, 'E2E historical SP', 'P', 'L-HISTORY', '2026-07-10', 'да', 'да',
        'действующий', 'актуальная', 'M01', 'СШ', 'РД', 108, 108, 4, 4, 0.42, 'проект', 'SP-K', 'SP-K',
        true, 'годен', 'P-626', '2026-07-10', 'проведено', '2026-07-10', 'D-626',
        'T-626', '2026-07-10', 'годен', 'TC-626', '2026-07-10',
        'V-До ТО', '2026-07-11', 'годен', 'VC-626', '2026-07-11') returning id`, [joint])
      ids.push(inserted.rows[0].id)
    })
    const id = ids[0]!
    await requireDb().transaction(async (tx) => {
      const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    })
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()

    // Simulate a clean-but-obsolete pre-fix index. A version bump must repair
    // both saved row codes and the report's virtual field without editing a weld.
    await withE2eDatabase(async (client) => {
      await client.query("delete from dispatcher_row_tasks where weld_joint_id = $1 and code = 'СП-01'", [id])
      await client.query(`update dispatcher_task_index_state set repeated_tasks =
        jsonb_set(repeated_tasks::jsonb, '{version}', to_jsonb($1::int))::text`, [DISPATCHER_TASK_CALCULATION_VERSION - 1])
    })
    await ensureDispatcherTaskIndexFresh()
    await expectWarning(id, true)
    await expectFinalStatus(id, 'ожидает заявку')
    const before = await readPreservedState(id)
    expect(before.documents.length).toBeGreaterThan(0)

    await page.goto(report)
    await page.getByRole('button', { name: `Открыть картину стыка ${joint}`, exact: true }).click()
    const pictureHeading = page.getByRole('heading', { name: `Картина стыка ${joint}`, exact: true })
    await expect(pictureHeading).toBeVisible()
    const picture = page.getByRole('dialog').filter({ has: pictureHeading })
    await expect(picture).toContainText('Создать заявку НК до ТО')
    await expect(picture).not.toContainText('Работа по стыку завершена')
    await page.keyboard.press('Escape')
    await expect(pictureHeading).toBeHidden()
    const panel = page.getByLabel('Диспетчер задач', { exact: true })
    const workspace = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
    async function openWarning() {
      if (!await workspace.isVisible()) await panel.getByRole('button', { name: 'Открыть диспетчер', exact: true }).click()
      const search = workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' })
      await search.fill(joint)
      await search.press('Enter')
      const task = workspace.locator('[data-dispatcher-workspace-task-row]').filter({ hasText: 'СП-01' })
      await expect(task).toHaveCount(1)
      return task
    }
    let warning = await openWarning()
    await expect(warning).toContainText('заявка ВИК до ТО')
    // Merely opening and cancelling the backfill must not touch old documents.
    await warning.getByRole('button', { name: 'Создать заявку НК до ТО', exact: true }).click()
    const requestHeading = page.getByRole('heading', { name: 'Заявка ЛНК до ТО', exact: true })
    await expect(requestHeading).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(requestHeading).toBeHidden()
    expect(await readPreservedState(id)).toEqual(before)
    await expectWarning(id, true)

    // Another operator disables the stage after this warning was displayed.
    // The action must re-check fresh server metadata, not an old UI setting.
    warning = await openWarning()
    await withE2eDatabase(async (client) => {
      await client.query(`update app_settings set value =
        jsonb_set(value::jsonb, '{preHeatTreatmentLnkEnabled}', 'false')::text where key = 'control-processes'`)
    })
    await warning.getByRole('button', { name: 'Создать заявку НК до ТО', exact: true }).click()
    await expect(page.getByText('Этап НК до ТО уже изменился или выключен. Обновите расчет диспетчера и повторите действие.', { exact: true })).toBeVisible()
    await expect(requestHeading).toBeHidden()
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()
    await expectWarning(id, false)
    await expectFinalStatus(id, 'годен')
    expect(await readPreservedState(id)).toEqual(before)
    await withE2eDatabase(async (client) => {
      await client.query(`update app_settings set value =
        jsonb_set(value::jsonb, '{preHeatTreatmentLnkEnabled}', 'true')::text where key = 'control-processes'`)
    })
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()
    await expectWarning(id, true)
    await expectFinalStatus(id, 'ожидает заявку')
    await page.reload()

    warning = await openWarning()
    await warning.getByRole('button', { name: 'Создать заявку НК до ТО', exact: true }).click()
    await page.getByLabel('Дата заявки', { exact: true }).fill('2026-07-10')
    await expect(page.getByRole('button', { name: 'Создать заявку до ТО', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Создать заявку до ТО', exact: true }).click()
    await expect(requestHeading).toBeHidden()
    await expect.poll(() => withE2eDatabase(async (client) =>
      (await client.query('select count(*)::int as count from pre_heat_treatment_controls where weld_joint_id = $1', [id])).rows[0].count,
    )).toBe(1)
    await expectWarning(id, true)

    warning = await openWarning()
    await expect(warning).toContainText('результат ВИК до ТО')
    await warning.getByRole('button', { name: 'Внести результат НК до ТО', exact: true }).click()
    const resultHeading = page.getByRole('heading', { name: 'Внесение результатов ЛНК до ТО', exact: true })
    await expect(resultHeading).toBeVisible()
    await page.getByLabel('Дата контроля', { exact: true }).fill('2026-07-10')
    await page.getByRole('dialog').getByRole('button', { name: 'годен', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Сохранить результат до ТО', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Сохранить результат до ТО', exact: true }).click()
    await expect(resultHeading).toBeHidden()
    await expect.poll(() => withE2eDatabase(async (client) =>
      (await client.query("select code from dispatcher_row_tasks where weld_joint_id = $1 and code = 'СП-01'", [id])).rows,
    )).toEqual([])
    await expectWarning(id, false)
    await expectFinalStatus(id, 'годен')
    expect(await readPreservedState(id)).toEqual(before)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await withE2eDatabase(async (client) => {
      if (ids.length) await client.query('delete from weld_joints where id = any($1::int[])', [ids])
      if (settingsChanged) {
        if (previousSetting) await client.query("update app_settings set value = $1, updated_at = $2 where key = 'control-processes'", [previousSetting.value, previousSetting.updated_at])
        else await client.query("delete from app_settings where key = 'control-processes'")
      }
    })
    await markDispatcherTaskIndexDirty(requireDb())
  }
})

async function expectWarning(id: number, expected: boolean) {
  const codes = await withE2eDatabase(async (client) => (await client.query(
    "select code from dispatcher_row_tasks where weld_joint_id = $1 and code = 'СП-01'", [id],
  )).rows)
  expect(codes.length).toBe(expected ? 1 : 0)
  const [visible] = await attachDispatcherTaskCodesToPage([{ id }]) as Array<{ id: number; dispatcherTasks: string }>
  expect(visible.dispatcherTasks.split(', ').includes('СП-01')).toBe(expected)
}

async function readPreservedState(id: number) {
  return withE2eDatabase(async (client) => ({
    weld: (await client.query(`select psto_request, psto_request_date, psto_date, psto_result,
      heat_treatment_diagram, tvmt_request, tvmt_request_date, tvmt_result, tvmt_conclusion,
      tvmt_conclusion_date, vik_request, vik_request_date, vik_result, vik_conclusion,
      vik_conclusion_date, pre_heat_treatment_lnk_exempt from weld_joints where id = $1`, [id])).rows[0],
    cycles: (await client.query('select * from psto_repeat_cycles where weld_joint_id = $1 order by id', [id])).rows,
    documents: (await client.query(`select d.id, d.type, d.title, d.period_from, d.period_to,
      d.document_number, d.source_metadata
      from generated_document_weld_joints link join generated_documents d on d.id = link.document_id
      where link.weld_joint_id = $1 and coalesce(d.source_metadata::jsonb ->> 'sourceKind', '') <> 'beforeHeatTreatment'
      order by d.id`, [id])).rows,
  }))
}

async function expectFinalStatus(id: number, expected: string) {
  expect(await withE2eDatabase(async (client) =>
    (await client.query('select final_status from weld_joints where id = $1', [id])).rows[0].final_status,
  )).toBe(expected)
}
