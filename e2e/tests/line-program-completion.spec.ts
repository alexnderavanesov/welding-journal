import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test('годный ремонт и две годные стороны катушки завершают линию; исключение финала и удаление стороны возвращают незавершённость', async ({ page }) => {
  const project = 'E2E physical chain completion', allIds: number[] = []
  const fixtures = await withE2eDatabase(async db => {
    const result = []
    for (const mode of ['REPAIR', 'COIL']) {
      const name = `COMPLETE-${mode}`
      const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent) values ($1,'C',$2,'II','A',10,0) returning id`, [project, name])
      const joints = mode === 'COIL' ? ['S1', 'S1R1', 'S1Y1', 'S1Y2'] : ['S1', 'S1R1']
      const ids = []
      for (const [index, joint] of joints.entries()) {
        const result = index === 0 || mode === 'COIL' && index === 1 ? 'ремонт' : 'годен'
        const { rows: [row] } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,stamp_1_k,has_vik,vik_result,has_uzk,uzk_result) values ($1,$2,'C',$3,$4,$5,'С17','A','да','годен','да',$6) returning id`, [line.id, project, name, joint, `2026-09-0${index + 1}`, result])
        ids.push(row.id); allIds.push(row.id)
      }
      if (mode === 'COIL') {
        await db.query(`insert into dispatcher_accepted_warnings(key,weld_joint_id,kind,code,title,context) values ($1,$2,'early-coil','ДЗ-09','Досрочная катушка','E2E')`, [`early-coil:${ids[1]}`, ids[1]])
        await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil,replacement_coil_ids) values ($1,'primary',$1,true,$2)`, [ids[0], ids.slice(2)])
        for (const [side, id] of ids.slice(2).entries()) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side) values ($1,'coil',$1,$2,$3,$4)`, [id, ids[1], ids[0], side + 1])
      }
      result.push({ name, ids })
    }
    return result
  })
  try {
    for (const fixture of fixtures) {
      await page.goto('/line-program')
      await page.getByLabel('Поиск программы линий').fill(fixture.name)
      const line = page.getByRole('button', { name: `Расчёт линии ${fixture.name}`, exact: true })
      await expect(line.getByTestId('program-finished-label')).toBeVisible()
      if (fixture.name.endsWith('REPAIR')) {
        await withE2eDatabase(db => db.query(`update weld_joints set officiality='неофициальный' where id=$1`, [fixture.ids[1]]))
      } else {
        await withE2eDatabase(db => db.query('delete from weld_joints where id=$1', [fixture.ids[2]]))
      }
      await page.reload()
      await page.getByLabel('Поиск программы линий').fill(fixture.name)
      await expect(line).toBeVisible()
      await expect(line.getByTestId('program-finished-label')).toHaveCount(0)
    }
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from weld_joint_program_states where weld_joint_id=any($1::int[])', [allIds]))
  }
})
