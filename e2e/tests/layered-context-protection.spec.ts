import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E layered context protection'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('меню ЛНК заранее объясняет запрет послойного контроля: официальность, актуальность, дубль и брак', async ({ page }) => {
  const rows = await withE2eDatabase(async db => {
    const { rows } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,
      weld_date,connection_type,officiality,revision_actuality,has_vik,vik_result,has_pvk,pvk_result,has_uzk,uzk_result)
      select $1,'MENU','LAYER-MENU','F'||(n+760),'2026-09-01','У17',
        case when n=1 then 'неофициальный' else 'действующий' end,
        case when n=2 then 'не актуален' end,'да','годен','да','годен','да',
        case when n in (1,4) then 'ремонт' else 'годен' end
      from generate_series(1,5) n returning id,joint`, [project])
    await db.query(`insert into duplicate_controls(weld_joint_id,method,result,control_date,conclusion,conclusion_date)
      values ($1,'УЗК','годен','2026-09-03','LAYER-MENU-DUP','2026-09-03')`, [rows[2].id])
    return rows as Array<{ id: number; joint: string }>
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/lnk')
  await page.waitForLoadState('networkidle')
  const reasons = ['официального актуального', 'официального актуального', 'дубль-контролем', 'нельзя сохранить', null]
  for (const [index, row] of rows.entries()) {
    // Reopen on the joint cell after Escape, including a horizontal scroll to
    // that cell. A queued scroll from before opening must not close the menu.
    await page.locator(`tr[data-weld-row-id="${row.id}"]`).getByRole('button', { name: row.joint, exact: true }).click({ button: 'right' })
    await page.getByRole('button', { name: 'Дополнительно', exact: true }).click()
    const assign = page.getByRole('button', { name: 'Назначить послойный контроль', exact: true })
    if (reasons[index]) {
      await expect(assign).toBeDisabled()
      await expect(assign).toHaveAttribute('title', new RegExp(reasons[index]!))
    } else await expect(assign).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-action-menu')).toBeHidden()
  }
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as count from weld_joints where project_title=$1 and layered_control_assigned', [project])).rows[0].count)).toBe(0)
  expect(errors).toEqual([])
})
