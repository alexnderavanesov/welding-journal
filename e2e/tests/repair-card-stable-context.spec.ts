import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { getWeldJointById } from '@/server/weld-read'

const project = 'E2E stable repair card'
const ids: number[] = []
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from weld_joint_program_states where weld_joint_id=any($1::int[])', [ids.splice(0)]))
})

test('карточка ремонта после переименования сохраняет обязательный УЗК по ID предшественника', async () => {
  const [rootId, repairId] = await withE2eDatabase(async db => {
    const { rows } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik,vik_result,has_uzk,uzk_result)
      values ($1,'STABLE','REPAIR-STABLE','S1','2026-09-01','да','годен','да','ремонт'),
      ($1,'STABLE','REPAIR-STABLE','F996',null,'да',null,'да',null) returning id`, [project])
    const created = rows.map(row => row.id)
    ids.push(...created)
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id) values
      ($1,'primary',$1,null),($2,'repair',$1,$1)`, created)
    return created
  })
  const row = await getWeldJointById({ data: { id: repairId } })
  expect(row?.programRepairRequirements?.map(item => item.method)).toEqual(['ВИК', 'УЗК'])
  expect(row?.programRepairRequirements?.find(item => item.method === 'УЗК')?.sourceRowId).toBe(rootId)
  expect(row?.programChainState?.kind).toBe('repair')
})

test('сохранённый первичный стык с похожим на ремонт именем не получает чужие обязательства', async () => {
  const rootId = await withE2eDatabase(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint)
      values ($1,'STABLE','REPAIR-STABLE','S1R1') returning id`, [project])
    ids.push(row.id)
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      values ($1,'primary',$1)`, [row.id])
    return row.id
  })
  const row = await getWeldJointById({ data: { id: rootId } })
  expect(row?.programChainState?.kind).toBe('primary')
  expect(row?.programRepairRequirements ?? []).toEqual([])
})
