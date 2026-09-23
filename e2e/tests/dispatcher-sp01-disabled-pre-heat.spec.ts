import { expect, test } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { attachDispatcherTaskCodesToPage } from '@/server/weld-read'
import { withE2eDatabase } from '../database'

for (const report of ['/psto', '/lnk']) test(`СП-01 при выключенном НК до ТО из ${report}: индекс, переход к ТВМТ и закрытие предупреждения`, async ({ page }) => {
  test.setTimeout(120_000)
  let previousSetting: { value: string; updated_at: Date } | undefined
  let settingsChanged = false
  const ids: number[] = []
  try {
    await withE2eDatabase(async (client) => {
      previousSetting = (await client.query("select value, updated_at from app_settings where key = 'control-processes'")).rows[0]
      await client.query(`insert into app_settings (key, value) values ('control-processes', $1)
        on conflict (key) do update set value = excluded.value`, [JSON.stringify({
        ...DEFAULT_CONTROL_PROCESS_SETTINGS, ...JSON.parse(previousSetting?.value ?? '{}'),
        preHeatTreatmentLnkEnabled: false, allowPrimaryLnkBeforePreviousStagesComplete: false,
      })])
      settingsChanged = true
      const inserted = await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, psto_required, has_vik,
        officiality, revision_actuality, material_group, connection_type, welding_method,
        d1, d2, t1, t2, wdi, vik_control_basis, stamp_1_k, stamp_1_k_fact,
        vik_request, vik_request_date, vik_result, vik_conclusion, vik_conclusion_date
      ) select joint, 'E2E SP disabled', 'P', 'L-SP-OFF', '2026-03-14', 'да', 'да',
        'действующий', 'актуальная', 'M01', 'СШ', 'РД',
        108, 108, 4, 4, 0.42, 'проект', 'SP-K', 'SP-K',
        'V-SP-' || joint, '2026-03-15', 'годен', 'C-SP-' || joint, '2026-03-25'
      from unnest(array['F701', 'F702', 'F703', 'F704']) as joint returning id`)
      ids.push(...inserted.rows.map(({ id }) => id))
      // F701 lacks PSTO, F702 lacks TVMT, F703 is only an early request,
      // F704 has a complete cycle. All belong to the same line.
      await client.query(`update weld_joints set vik_result = 'ожидает НК',
        vik_conclusion = null, vik_conclusion_date = null where id = $1`, [ids[2]])
      await client.query(`update weld_joints set psto_request = 'P-SP-' || joint,
        psto_request_date = '2026-03-15', psto_result = 'проведено', psto_date = '2026-03-17',
        heat_treatment_diagram = 'D-SP-' || joint, tvmt_request = 'T-SP-' || joint,
        tvmt_request_date = '2026-03-18', tvmt_result = 'ожидает НК'
        where id = any($1::int[])`, [[ids[1], ids[3]]])
      await client.query(`update weld_joints set tvmt_result = 'годен',
        tvmt_conclusion = 'TC-SP-F704', tvmt_conclusion_date = '2026-03-20' where id = $1`, [ids[3]])
    })
    await requireDb().transaction(async (tx) => {
      const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    })
    await markDispatcherTaskIndexDirty(requireDb())
    await ensureDispatcherTaskIndexFresh()
    await expectWarningIds(ids, [ids[0], ids[1]])

    await page.goto(report)
    const panel = page.getByLabel('Диспетчер задач', { exact: true })
    await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
    const dialog = page.getByRole('dialog', { name: 'Диспетчер задач' })
    const search = dialog.getByRole('textbox', { name: 'Поиск задач диспетчера' })
    await search.fill('F702')
    await search.press('Enter')
    const warning = dialog.locator('[data-dispatcher-workspace-task-row]').filter({ hasText: 'СП-01' })
    await expect(warning).toHaveCount(1)
    await expect(warning).toContainText('ожидает ТВМТ')
    await expect(warning).not.toContainText('до ТО')
    await warning.getByRole('button', { name: 'Открыть ТВМТ', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeVisible()
    await page.getByLabel('Дата ТВМТ', { exact: true }).fill('2026-03-20')
    await page.getByLabel('Результат для выбранных', { exact: true }).selectOption({ label: 'годен' })
    await expect(page.getByRole('button', { name: 'Сохранить результат', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Сохранить результат', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Внесение результатов ТВМТ' })).toBeHidden()
    await expect.poll(() => withE2eDatabase(async (client) =>
      (await client.query("select code from dispatcher_row_tasks where weld_joint_id = $1 and code = 'СП-01'", [ids[1]])).rows,
    )).toEqual([])
    await expectWarningIds(ids, [ids[0]])

    await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
    await search.fill('F702')
    await search.press('Enter')
    await expect(warning).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await withE2eDatabase(async (client) => (await client.query(`select vik_request,
      vik_request_date::text, vik_conclusion, vik_conclusion_date::text,
      tvmt_result, tvmt_conclusion_date::text from weld_joints where id = $1`, [ids[1]])).rows[0])).toEqual({
      vik_request: 'V-SP-F702', vik_request_date: '2026-03-15',
      vik_conclusion: 'C-SP-F702', vik_conclusion_date: '2026-03-25',
      tvmt_result: 'годен', tvmt_conclusion_date: '2026-03-20',
    })
    expect(await withE2eDatabase(async (client) =>
      (await client.query('select id from pre_heat_treatment_controls where weld_joint_id = any($1::int[])', [ids])).rows,
    )).toEqual([])

    // Opening a missing stage must offer its creation, but cancellation must
    // leave the weld and its documents untouched.
    const beforeCancel = await readStoredState(ids[0]!)
    await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
    await search.fill('F701')
    await search.press('Enter')
    await warning.getByRole('button', { name: 'Открыть ПСТО', exact: true }).click()
    const requestHeading = page.getByRole('heading', { name: 'Заявка ПСТО', exact: true })
    await expect(requestHeading).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(requestHeading).toBeHidden()
    expect(await readStoredState(ids[0]!)).toEqual(beforeCancel)
    await expectWarningIds(ids, [ids[0]])

    // Another operator creates the missing request after this card was loaded.
    // The old action must not open the wrong stage or overwrite that request.
    await panel.getByRole('button', { name: 'Открыть диспетчер' }).click()
    await search.fill('F701')
    await search.press('Enter')
    const oldAction = warning.getByRole('button', { name: 'Открыть ПСТО', exact: true })
    await expect(oldAction).toBeVisible()
    await withE2eDatabase(async (client) => {
      await client.query(`update weld_joints set psto_request = 'P-SP-concurrent',
        psto_request_date = '2026-03-15', updated_at = updated_at + interval '1 second'
        where id = $1`, [ids[0]])
    })
    const afterConcurrentChange = await readStoredState(ids[0]!)
    await oldAction.click()
    await expect(page.getByText('Этап ПСТО/ТВМТ уже изменился. Обновите расчет диспетчера и повторите действие.', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(requestHeading).toBeHidden()
    expect(await readStoredState(ids[0]!)).toEqual(afterConcurrentChange)
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

async function readStoredState(id: number) {
  return withE2eDatabase(async (client) => ({
    weld: (await client.query('select * from weld_joints where id = $1', [id])).rows[0],
    cycles: (await client.query('select * from psto_repeat_cycles where weld_joint_id = $1 order by id', [id])).rows,
    documents: (await client.query(`select d.*, to_jsonb(link) as position
      from generated_document_weld_joints link join generated_documents d on d.id = link.document_id
      where link.weld_joint_id = $1 order by d.id`, [id])).rows,
  }))
}

async function expectWarningIds(ids: number[], expected: number[]) {
  const indexed = await withE2eDatabase(async (client) => (await client.query<{ weld_joint_id: number }>(
    "select weld_joint_id from dispatcher_row_tasks where weld_joint_id = any($1::int[]) and code = 'СП-01' order by weld_joint_id", [ids],
  )).rows.map(({ weld_joint_id }) => weld_joint_id))
  expect(indexed).toEqual(expected)
  const visible = await attachDispatcherTaskCodesToPage(ids.map((id) => ({ id }))) as Array<{ id: number; dispatcherTasks: string }>
  expect(visible.filter((row) => row.dispatcherTasks.split(', ').includes('СП-01')).map(({ id }) => id)).toEqual(expected)
}
