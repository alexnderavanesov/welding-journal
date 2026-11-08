import { expect, test } from '@playwright/test'
import { getDispatcherTaskIndexSnapshot } from '../../src/server/dispatcher-task-index'
import { attachDispatcherTaskCodesToPage } from '../../src/server/weld-read'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'

const project = 'E2E T-OP stored dispatcher'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('stored support violations and live own quotas update persisted and virtual dispatcher fields', async () => {
  const { lineId, ids } = await withLineProgramFixture(async db => {
    const lineId = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,support_uzk_control_percent,support_pvk_control_percent)
      values($1,'T21','T-DISPATCH','II','A',10,10,100,0.5) returning id`, [project])).rows[0].id
    const ids = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,category,group_name,weld_control_percent,pvk_control_percent,weld_date,welding_method,material_group,d1,t1,weld_length,stamp_1_k,stamp_1_z,has_vik,vik_result,has_uzk,has_pvk)
      values($1,$2,'T21','T-DISPATCH','ОП1','Т1','II','A',10,10,'2026-09-01','РАД+РД','М01 + М05',57,6,600,'A','B','да','годен','да','да'),
      ($1,$2,'T21','T-DISPATCH','ОП2','Т1','II','A',10,10,'2026-09-01','РД','М01',57,6,null,'A',null,'да','годен',null,null) returning id`, [lineId, project])).rows.map(row => row.id as number)
    return { lineId, ids }
  })
  const read = async () => {
    expect((await getDispatcherTaskIndexSnapshot({ ensureFresh: true })).isFresh).toBe(true)
    const stored = await withE2eDatabase(async db => (await db.query('select weld_joint_id,code from dispatcher_row_tasks where weld_joint_id=any($1::int[])', [ids])).rows)
    const visible = await attachDispatcherTaskCodesToPage(ids.map(id => ({ id, dispatcherTasks: '' })))
    for (const id of ids) {
      const persisted = [...new Set(stored.filter(row => row.weld_joint_id === id).map(row => row.code))].sort()
      const virtual = String(visible.find(row => row.id === id)?.dispatcherTasks ?? '').split(', ').filter(Boolean).sort()
      expect(virtual).toEqual(persisted)
    }
    return stored
  }
  const before = await read()
  expect(before).toContainEqual({ weld_joint_id: ids[0], code: 'СП-13' })
  expect(before).toContainEqual({ weld_joint_id: ids[1], code: 'СП-03' })
  expect(before.some(row => row.code === 'СП-01')).toBe(true)
  await withLineProgramFixture(db => db.query('update line_programs set support_uzk_control_percent=50 where id=$1', [lineId]))
  const after = await read()
  expect(after.some(row => row.code === 'СП-01')).toBe(false)
  expect(after).toContainEqual({ weld_joint_id: ids[0], code: 'СП-13' })
  // Own norms are read from the line; they are not copied into or rounded through weld storage.
  expect(await withE2eDatabase(async db => (await db.query('select distinct weld_control_percent::text from weld_joints where project_title=$1', [project])).rows))
    .toEqual([{ weld_control_percent: '10.000' }])
})
