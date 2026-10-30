import { asE2eOwner } from '../with-owner-access'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { readAcrossCommittedWrite } from '../interleaved-read'
import { listLnkWorkflowRows as raw_listLnkWorkflowRows } from '../../src/server/lnk-workflow-context'
import { listPstoWorkflowRows as raw_listPstoWorkflowRows } from '../../src/server/psto-workflow-context'
import { loadDuplicateControlCandidatePage, loadDuplicateControlCandidateRowsByIds, loadDuplicateControlRegistryPage } from '../../src/server/duplicate-controls'

const project = 'E2E workflow coherent source'
test.afterEach(() => cleanupLineProgramProjects([project]))

for (const workflow of ['LNK', 'PSTO', 'duplicate-page', 'duplicate-selected'] as const) for (const action of ['change', 'delete'] as const) {
  test(`${workflow}: ${action} between source and relations cannot mix workflow histories`, async () => {
    const id = await withLineProgramFixture(async db => {
      const row = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date,connection_type,
        officiality,revision_actuality,psto_required,has_vik)
        values($1,'OLD-LINE','S1','2026-09-01','С17','действующий','актуальная','да','да') returning id`, [project])).rows[0]
      await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,conclusion_name,conclusion_date)
        values($1,'ВИК','годен','OLD-VIK','2026-09-01')`, [row.id])
      await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date)
        values($1,2,'OLD-PSTO','2026-09-02')`, [row.id])
      await db.query(`insert into duplicate_controls(weld_joint_id,method,result,conclusion,conclusion_date)
        values($1,'ВИК','годен','OLD-DUP','2026-09-02')`, [row.id])
      return row.id as number
    })
    const read = () => workflow === 'duplicate-page' ? loadDuplicateControlCandidatePage({ search: project }).then(result => result.rows)
      : workflow === 'duplicate-selected' ? loadDuplicateControlCandidateRowsByIds([id])
      : (workflow === 'LNK' ? listLnkWorkflowRows : listPstoWorkflowRows)({ scope: 'fieldRows', rowIds: [id] })
    const expectedAt = (prefix: string) => ({ id, line: `${prefix}-LINE`, ...(workflow.startsWith('duplicate')
      ? { duplicateControls: [expect.objectContaining({ conclusion: `${prefix}-DUP` })] }
      : { preHeatTreatmentControls: [expect.objectContaining({ conclusionName: `${prefix}-VIK` })],
        pstoRepeatCycles: [expect.objectContaining({ pstoRequest: `${prefix}-PSTO` })] }) })
    const expected = expectedAt('OLD')
    expect(await read()).toEqual([expect.objectContaining(expected)])
    const snapshot = await readAcrossCommittedWrite(read,
      sql => sql.includes('from "weld_joints"') && sql.includes('"connection_type"'),
      () => withLineProgramFixture(async db => {
        if (action === 'delete') await db.query('delete from weld_joints where id=$1', [id])
        else {
          await db.query("update weld_joints set line='NEW-LINE' where id=$1", [id])
          await db.query("update pre_heat_treatment_controls set conclusion_name='NEW-VIK' where weld_joint_id=$1", [id])
          await db.query("update psto_repeat_cycles set psto_request='NEW-PSTO' where weld_joint_id=$1", [id])
          await db.query("update duplicate_controls set conclusion='NEW-DUP' where weld_joint_id=$1", [id])
        }
      }))
    expect(snapshot).toEqual([expect.objectContaining(expected)])
    expect(await read()).toEqual(action === 'delete' ? [] : [expect.objectContaining(expectedAt('NEW'))])
  })
}

test('duplicate registry: count and page remain coherent when a control is deleted between their reads', async () => {
  const id = await withLineProgramFixture(async db => {
    const weld = (await db.query(`insert into weld_joints(project_title,line,joint) values($1,'REGISTRY','F1') returning id`, [project])).rows[0]
    return (await db.query(`insert into duplicate_controls(weld_joint_id,method,result,conclusion)
      values($1,'ВИК','годен','SNAPSHOT-DUP') returning id`, [weld.id])).rows[0].id as number
  })
  const read = () => loadDuplicateControlRegistryPage({ page: 1, pageSize: 100 })
  const before = await read()
  expect(before.rows.some(row => row.id === id)).toBe(true)
  const snapshot = await readAcrossCommittedWrite(read,
    sql => sql.includes('from "duplicate_controls"') && sql.includes('count('),
    () => withLineProgramFixture(db => db.query('delete from duplicate_controls where id=$1', [id])),
    sql => sql.includes('from "duplicate_controls"') && sql.includes('"weld_joint_id"'))
  expect(snapshot).toEqual(before)
  const after = await read()
  expect(after.totalCount).toBe(before.totalCount! - 1)
  expect(after.rows.some(row => row.id === id)).toBe(false)
})

test('workflow relation reads remain constant for one and 500 selected joints', async ({}, info) => {
  const ids = await withLineProgramFixture(async db => (await db.query<{ id: number }>(`insert into weld_joints
    (project_title,line,joint,weld_date,connection_type,officiality,revision_actuality,psto_required,has_vik)
    select $1,'BOUNDS','F'||n,'2026-09-01','С17','действующий','актуальная','да','да'
    from generate_series(1,500) n returning id`, [project])).rows.map(row => row.id))
  const readers = [
    ['LNK', (rowIds: number[]) => listLnkWorkflowRows({ scope: 'fieldRows', rowIds })],
    ['PSTO', (rowIds: number[]) => listPstoWorkflowRows({ scope: 'fieldRows', rowIds })],
    ['duplicate-selected', (rowIds: number[]) => loadDuplicateControlCandidateRowsByIds(rowIds)],
  ] as const
  const samples: { workflow: string; size: number; statements: number; milliseconds: number }[] = []
  for (const [workflow, read] of readers) {
    await read(ids) // Initialize any derived index before measuring its reads.
    for (const size of [1, 500]) {
      const original = pg.Client.prototype.query
      let statements = 0
      pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
        statements++
        return (original as (...args: unknown[]) => unknown).apply(this, args)
      } as typeof original
      const started = performance.now()
      try { expect(await read(ids.slice(0, size))).toHaveLength(size) }
      finally { pg.Client.prototype.query = original }
      samples.push({ workflow, size, statements, milliseconds: Math.round(performance.now() - started) })
      expect(statements).toBeLessThanOrEqual(20)
    }
    const [one, many] = samples.slice(-2)
    expect(many.statements).toBeLessThanOrEqual(one.statements + 1)
  }
  console.log('WORKFLOW_READ_COUNTS', JSON.stringify(samples))
  await writeFile(info.outputPath('workflow-read-counts.json'), JSON.stringify(samples, null, 2))
})

const listLnkWorkflowRows = asE2eOwner(raw_listLnkWorkflowRows, 'lnk.view')
const listPstoWorkflowRows = asE2eOwner(raw_listPstoWorkflowRows, 'psto.view')
