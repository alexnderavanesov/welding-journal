import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E layered planning'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('ожидание ПВК без документов не блокирует исправление даты сварки в карточке', async ({ page }) => {
  const id = await withE2eDatabase(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs
      (project_title, subtitle_code, line, category, group_name, weld_control_percent, pvk_control_percent)
      values ($1, 'PLAN', 'LAYER-PLANNED', 'II', 'A', 100, 10) returning id`, [project])
    const { rows: [joint] } = await db.query(`insert into weld_joints
      (line_program_id, project_title, subtitle_code, line, joint, weld_date, connection_type,
       category, group_name, weld_control_percent, pvk_control_percent, has_vik, has_pvk,
       layered_control_assigned, pvk_result, officiality, revision_actuality, welding_method,
       material_group, d1, d2, t1, t2, wdi)
      values ($1, $2, 'PLAN', 'LAYER-PLANNED', 'F988', '2026-09-01', 'У17', 'II', 'A', 100, 10,
        'да', 'да', true, 'ожидает заявку', 'действующий', 'актуальная', 'РД', 'M01', 108, 108, 4, 4, 0.42)
      returning id`, [line.id, project])
    return joint.id
  })
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await page.getByRole('button', { name: 'F988', exact: true }).locator('xpath=ancestor::tr')
    .getByRole('button', { name: 'Редактировать', exact: true }).click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка' }) })
  await editor.getByLabel('Дата сварки', { exact: true }).fill('')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  await withE2eDatabase(async db => {
    expect((await db.query(`select weld_date, layered_control_assigned,
      (select count(*)::integer from generated_document_weld_joints where weld_joint_id=w.id) as documents
      from weld_joints w where id=$1`, [id])).rows).toEqual([
      { weld_date: null, layered_control_assigned: true, documents: 0 },
    ])
  })
})
