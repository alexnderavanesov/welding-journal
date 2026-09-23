import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'

test('негодный НК до ТО неофициального стыка задаёт ожидание ремонта официальному одноимённому', async ({ page }) => {
  const project = 'E2E pre-TO same-name repair'
  let ids: number[] = []
  try {
    ids = await withE2eDatabase(async (client) => {
      const rows = (await client.query<{ id: number }>(`insert into weld_joints (
        joint, project_title, subtitle_code, line, weld_date, officiality, has_vik, psto_required
      ) values ('F99', $1, 'P', 'L', '2026-09-16', 'неофициальный', 'да', 'да'),
        ('F99', $1, 'P', 'L', null, 'действующий', 'да', 'да') returning id`, [project])).rows
      await client.query(`insert into pre_heat_treatment_controls (weld_joint_id, method, request_name, request_date, result, conclusion_name, conclusion_date)
        values ($1, 'ВИК', 'PRE-REPAIR', '2026-09-16', 'ремонт', 'PRE-REPAIR-C', '2026-09-17')`, [rows[0].id])
      return rows.map((row) => row.id)
    })
    const [{ loadCurrentFinalStatusRowsContext }, { calculateFinalStatusInRows }] = await Promise.all([
      import('../../src/server/weld-read'), import('../../src/lib/weld-status'),
    ])
    const context = await loadCurrentFinalStatusRowsContext()
    // Only the continuation is available on this simulated report page.
    const continuation = { id: ids[1], joint: 'F99', projectTitle: project, subtitleCode: 'P', line: 'L', officiality: 'действующий' }
    expect(calculateFinalStatusInRows(continuation, [continuation], context)).toBe('ожидает ремонт')
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await expect(page.getByRole('button', { name: 'Выбрать стык F99', exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Наборы', exact: true }).click()
    await page.getByRole('button', { name: /^Компактно/ }).click()
    const continuationRow = page.locator(`tr[data-weld-row-id="${ids[1]}"]`)
    await expect(continuationRow.getByRole('button', { name: 'ожидает ремонт', exact: true })).toBeVisible()
  } finally {
    await page.close()
    if (ids.length) await withE2eDatabase(async (client) => { await client.query('delete from weld_joints where id = any($1::integer[])', [ids]) })
  }
})
