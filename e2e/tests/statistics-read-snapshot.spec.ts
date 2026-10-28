import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { computeStatisticsServerResult } from '../../src/server/statistics'
import { readAcrossCommittedWrite } from '../interleaved-read'

const project = 'E2E statistics coherent topology'
test.afterEach(() => cleanupLineProgramProjects([project]))

for (const tab of ['general', 'lineSummary'] as const) test(`${tab}: статистика не смешивает старые стыки с новой физической заменой`, async () => {
  const root = await withLineProgramFixture(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,
      connection_type,weld_date,officiality,revision_actuality,has_vik,vik_result,has_uzk,uzk_result)
      values($1,'SNAP','SNAP-L','S1','С17','2026-09-01','действующий','актуальная','да','годен','да','вырез') returning id`, [project])
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,replaced_by_coil)
      values($1,'primary',$1,false)`, [row.id])
    return row.id as number
  })
  const input = { tab, projectFilter: project.toLowerCase(), unit: 'joints' as const }
  const read = async () => {
    const result = await computeStatisticsServerResult(input)
    return tab === 'general' ? result.generalProgressSummary : result.lineSummary
  }
  expect(await read()).toMatchObject({ total: 1, completed: 1 })

  const replaceWithCoil = () => withLineProgramFixture(async db => {
    // Two valid database states: one physical connection, then two welded
    // sides. An intervening read must never report zero surviving connections.
    const { rows } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,
      connection_type,weld_date,officiality,revision_actuality,has_vik,vik_result,has_uzk,uzk_result)
      select $1,'SNAP','SNAP-L','S1Y'||n,'С17','2026-09-03','действующий','актуальная','да','годен','да','годен'
      from generate_series(1,2) n returning id`, [project])
    await db.query(`update weld_joint_program_states set replaced_by_coil=true,replacement_coil_ids=$2
      where weld_joint_id=$1`, [root, rows.map(row => row.id)])
    for (const [index, row] of rows.entries()) await db.query(`insert into weld_joint_program_states
      (weld_joint_id,kind,physical_root_id,source_row_id,coil_parent_id,coil_side)
      values($1,'coil',$1,$2,$2,$3)`, [row.id, root, index + 1])
  })
  const snapshot = await readAcrossCommittedWrite(read,
    statement => statement.includes('from "weld_joints"') && statement.includes('"connection_type"'), replaceWithCoil)
  expect(snapshot).toMatchObject({ total: 1, completed: 1 })
  expect(await read()).toMatchObject({ total: 2, completed: 2 })
})
