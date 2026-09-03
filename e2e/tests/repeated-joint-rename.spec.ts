import { expect, test } from '@playwright/test'

import { withE2eDatabase } from '../database'

const PROJECT = 'E2E пересчет цепочки'
const LINE = 'E2E-RENAME-L1'
const ORIGINAL_JOINTS = ['S991', 'S991R1', 'S991R2'] as const
const EXPECTED_JOINTS = ['S991', 'S991W1', 'S991W1R1'] as const

test.afterEach(async () => {
  await withE2eDatabase(async (client) => {
    await client.query('delete from weld_joints where project_title = $1', [PROJECT])
  })
})

test('recalculates R/W counters for the whole remaining chain in one user action', async ({ page }) => {
  const ids = await seedRenameChain()

  await page.goto('/journal')
  const changedRow = page.locator(`tr[data-weld-row-id="${ids.get('S991R1')}"]`)
  await expect(changedRow).toBeVisible()
  await changedRow.getByRole('button', { name: 'S991R1', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Картина стыка S991R1', exact: true })).toBeVisible()
  await expect(page.getByText('Создать S991W1', { exact: true })).toHaveCount(0)
  await page.getByRole('button', {
    name: 'Переименовать S991R1 -> S991W1 (+1 далее)',
    exact: true,
  }).click()

  await expect(page.getByRole('heading', { name: 'Исправить имена цепочки', exact: true })).toBeVisible()
  await expect(page.getByText(/S991R1 -> S991W1; S991R2 -> S991W1R1/)).toBeVisible()
  await expect(page.getByText(/S991W1R2/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Исправить цепочку', exact: true }).click()

  await expect.poll(loadRenameState).toEqual([
    { id: ids.get('S991'), joint: EXPECTED_JOINTS[0], note: 'base-note', conclusion: 'Conclusion S991' },
    { id: ids.get('S991R1'), joint: EXPECTED_JOINTS[1], note: 'first-note', conclusion: 'Conclusion S991R1' },
    { id: ids.get('S991R2'), joint: EXPECTED_JOINTS[2], note: 'second-note', conclusion: 'Conclusion S991R2' },
  ])

  await expect(page.getByRole('status')).toContainText('Цепочка исправлена: переименовано стыков - 2')
  await page.reload()
  const renamedRow = page.locator(`tr[data-weld-row-id="${ids.get('S991R1')}"]`)
  await renamedRow.getByRole('button', { name: 'S991W1', exact: true }).click()
  await expect(page.getByRole('button', { name: /Переименовать S991R1/ })).toHaveCount(0)
})

async function seedRenameChain() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{ id: number; joint: string }>(`
      insert into weld_joints (
        weld_date, project_title, subtitle_code, line, isometry, joint, spool,
        officiality, revision_actuality, welding_method, connection_type, material_group,
        d1, d2, t1, t2, wdi, stamp_1_k, stamp_1_k_fact,
        has_vik, vik_control_basis, vik_request, vik_request_date,
        vik_result, vik_conclusion_date, vik_conclusion,
        welding_journal_note, final_status,
        welding_updated_at, lnk_created_at, lnk_updated_at
      ) values
        ('2026-09-01', $1, 'E2E-RENAME', $2, 'ISO-E2E-RENAME', 'S991', 'E2E-RENAME-S1',
          null, 'актуальная', 'РД', 'СШ', 'M01',
          108, 108, 4, 4, 0.42, 'E2E-K1', 'E2E-K1',
          'да', 'проект', 'Request S991', '2026-09-01',
          'вырез', '2026-09-01', 'Conclusion S991',
          'base-note', 'вырез', now(), now(), now()),
        ('2026-09-02', $1, 'E2E-RENAME', $2, 'ISO-E2E-RENAME', 'S991R1', 'E2E-RENAME-S1',
          null, 'актуальная', 'РД', 'СШ', 'M01',
          108, 108, 4, 4, 0.42, 'E2E-K1', 'E2E-K1',
          'да', 'проект', 'Request S991R1', '2026-09-02',
          'ремонт', '2026-09-02', 'Conclusion S991R1',
          'first-note', 'ремонт', now(), now(), now()),
        ('2026-09-03', $1, 'E2E-RENAME', $2, 'ISO-E2E-RENAME', 'S991R2', 'E2E-RENAME-S1',
          null, 'актуальная', 'РД', 'СШ', 'M01',
          108, 108, 4, 4, 0.42, 'E2E-K1', 'E2E-K1',
          'да', 'проект', 'Request S991R2', '2026-09-03',
          'годен', '2026-09-03', 'Conclusion S991R2',
          'second-note', 'годен', now(), now(), now())
      returning id, joint
    `, [PROJECT, LINE])
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

async function loadRenameState() {
  return withE2eDatabase(async (client) => {
    const result = await client.query<{
      id: number
      joint: string
      welding_journal_note: string | null
      vik_conclusion: string | null
    }>(`
      select id, joint, welding_journal_note, vik_conclusion
      from weld_joints
      where project_title = $1 and line = $2
      order by id
    `, [PROJECT, LINE])
    return result.rows.map((row) => ({
      id: row.id,
      joint: row.joint,
      note: row.welding_journal_note,
      conclusion: row.vik_conclusion,
    }))
  })
}
