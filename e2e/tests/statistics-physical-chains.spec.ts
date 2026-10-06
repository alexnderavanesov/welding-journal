import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

test('статистика: план 9 из 11, затем 11 → 9 → 10, физические цепочки и подтверждение', async ({ page }) => {
  test.setTimeout(120_000)
  const project = 'E2E statistics physical chains', line = 'STATS-PHYSICAL'
  const ids: number[] = [], calls: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  const { lineId, rootId } = await withE2eDatabase(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values ($1,'STAT',$2,'II','A',10,0) returning id`, [project, line])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,
      stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,category,group_name,weld_control_percent,pvk_control_percent)
      select $1,$2,'STAT',$3,'S'||(9100+n),'С17','2026-09-01','A','да','годен','да','годен','II','A',10,0
      from generate_series(1,10) n returning id`, [program.id, project, line])
    ids.push(...rows.map(row => row.id))
    return { lineId: program.id, rootId: rows[0].id }
  })
  async function expectStatistics(count: number, completed = count) {
    await page.goto('/statistics')
    await page.getByRole('button', { name: 'Настройки отчета', exact: true }).click()
    await page.getByRole('combobox', { name: 'Проект', exact: true }).selectOption(project.toLowerCase())
    await page.getByRole('button', { name: 'Стыки', exact: true }).click()
    await expect(page.getByText(`${completed} выполнено из ${count}`, { exact: true })).toBeVisible()
    const before = calls.filter(name => name.startsWith('getStatisticsServerResult_')).length
    await page.getByRole('button', { name: 'Полинейная сводка', exact: true }).click()
    await page.getByRole('button', { name: 'Стыки', exact: true }).click()
    await expect(page.getByText(`${completed} из ${count}`, { exact: true })).toBeVisible()
    await expect(page.getByText('По датам сварки, без оценки годности НК', { exact: true })).toBeVisible()
    const after = calls.filter(name => name.startsWith('getStatisticsServerResult_')).length
    expect(after - before).toBeLessThanOrEqual(2) // New tab, then its independent unit setting.
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
    await page.waitForTimeout(300)
    expect(calls.filter(name => name.startsWith('getStatisticsServerResult_')).length).toBe(after)
  }
  async function expectProgramCount(count: number) {
    await page.goto('/line-program')
    const program = page.getByTestId('line-program')
    await program.getByLabel('Поиск программы линий').fill(line)
    await expect(program.getByTestId('line-program-card')).toHaveCount(1)
    await expect(program.getByLabel('Итоги раздела').getByRole('button', {
      name: `Учитываемых соединений ${count}`, exact: true,
    })).toBeVisible()
  }
  try {
    await invalidateFixtureStatistics()
    await expectStatistics(10)
    const coils = await withE2eDatabase(async db => {
      const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,weld_date,
        stamp_1_k,has_vik,vik_result,has_uzk,uzk_result,category,group_name,weld_control_percent,pvk_control_percent)
        select $1,$2,'STAT',$3,'S9101Y'||n,'С17',null,'A','да',null,'да',null,'II','A',10,0
        from generate_series(1,2) n returning id`, [lineId, project, line])
      const coilIds = rows.map(row => row.id)
      ids.push(...coilIds)
      await db.query(`update weld_joints set uzk_result='вырез' where id=$1`, [rootId])
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil,replacement_coil_ids)
        values ($1,'primary',$1,false,$2)`, [rootId, coilIds])
      for (const [index, id] of coilIds.entries()) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side)
        values ($1,'coil',$1,$2,$2,$3)`, [id, rootId, index + 1])
      return coilIds
    })
    await invalidateFixtureStatistics()
    await expectStatistics(11, 9)
    await expectProgramCount(10)
    await withE2eDatabase(async db => {
      await db.query(`update weld_joints set weld_date='2026-09-03',vik_result='годен',uzk_result='годен' where id=any($1::int[])`, [coils])
      await db.query(`update weld_joint_program_states set replaced_by_coil=true where weld_joint_id=$1`, [rootId])
    })
    await invalidateFixtureStatistics()
    await expectStatistics(11)
    await expectProgramCount(11)
    await withE2eDatabase(async db => {
      await db.query('delete from weld_joints where id=any($1::int[])', [coils])
      await db.query(`update weld_joints set uzk_result='годен' where id=$1`, [rootId])
    })
    await invalidateFixtureStatistics()
    await expectStatistics(9)

    await page.goto('/lnk')
    await page.getByLabel('Диспетчер задач', { exact: true }).getByRole('button', { name: 'Открыть диспетчер' }).click()
    const workspace = page.getByRole('dialog', { name: 'Диспетчер задач', exact: true })
    await workspace.getByRole('textbox', { name: 'Поиск задач диспетчера' }).fill(line)
    await workspace.getByRole('button', { name: 'Найти', exact: true }).click()
    await workspace.getByRole('button', { name: 'Проверить отмену ошибочной катушки', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Отменить ошибочно внесённую катушку', exact: true })
    await expect(dialog.getByText('Физические соединения:', { exact: false })).toContainText('9 → 10')
    // The agreed helper no longer asks for a person's name. Keep the actual
    // recovery and statistics assertions; do not restore the obsolete field.
    await expect(dialog.getByLabel('ФИО подтвердившего', { exact: true })).toHaveCount(0)
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Восстановить исходное соединение', exact: true }).click()
    await expect(dialog).toBeHidden()
    // No test-side cache invalidation here: the real confirmation must invalidate it.
    await expectStatistics(10)
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await cleanupLineProgramProjects([project])
    await withE2eDatabase(db => db.query('delete from weld_joint_program_states where weld_joint_id=any($1::int[])', [ids]))
    await invalidateFixtureStatistics()
  }
})

async function invalidateFixtureStatistics() {
  await withE2eDatabase(async db => {
    await db.query('delete from derived_calculation_cache')
    await db.query('update derived_calculation_state set source_revision=source_revision+1,updated_at=now() where id=1')
    await db.query('update dispatcher_task_index_state set source_revision=source_revision+1,full_rebuild=true,updated_at=now() where id=1')
  })
}
