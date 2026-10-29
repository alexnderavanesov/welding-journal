import { expect, test } from '@playwright/test'
import pg from 'pg'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { readJournalGrid, summarizeJournalGridSelection } from '../../src/server/journal-grid'

const project = 'E2E coherent journal read'

for (const report of ['weldingJournal', 'lnk', 'heatTreatment'] as const) test(`${report}: concurrent save cannot mix a page with newer relations or starve its initial read`, async () => {
  await withLineProgramFixture(async db => {
    const { rows: [row] } = await db.query(`insert into weld_joints(project_title,line,joint,isometry,connection_type,
      weld_date,officiality,revision_actuality,psto_required,has_vik) values($1,'SNAP','S1','before','С17','2026-09-01','действующий','актуальная','да','да') returning id`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date)
      values($1,'ВИК','before','2026-09-02')`, [row.id])
  })
  const input = { report, columnFilters: { search: project }, groupBy: [], route: [], start: 0, end: 100 }
  const original = pg.Client.prototype.query
  let committed = false
  try {
    await readJournalGrid(input) // Initialize the cache/dispatcher before the controlled race.
    const saveConcurrently = () => withLineProgramFixture(async db => {
      await db.query('update weld_joints set isometry=$2 where project_title=$1', [project, 'after'])
      await db.query(`update pre_heat_treatment_controls set request_name='after'
        where weld_joint_id in (select id from weld_joints where project_title=$1)`, [project])
      await db.query(`insert into weld_joints(project_title,line,joint,connection_type,weld_date,officiality,revision_actuality,psto_required,has_vik)
        values($1,'SNAP','S2','С17','2026-09-01','действующий','актуальная','да','да')`, [project])
    })
    pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
      const statement = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string }).text ?? ''
      if (committed || !statement.includes('from "weld_joints"') || !statement.includes('"connection_type"') || !statement.includes('limit')) {
        return (original as (...values: unknown[]) => unknown).apply(this, args)
      }
      committed = true
      // Pool.query uses Client's callback; a transaction uses its promise.
      // Delay the actual delivery in both cases until the other save commits.
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        args[args.length - 1] = (error: Error | null, result: unknown) => {
          if (error) { callback(error); return }
          void saveConcurrently().then(() => callback(null, result), failure => callback(failure))
        }
        return (original as (...values: unknown[]) => unknown).apply(this, args)
      }
      return Promise.resolve((original as (...values: unknown[]) => unknown).apply(this, args)).then(async result => {
        await saveConcurrently()
        return result
      })
    } as typeof original
    const snapshot = await readJournalGrid(input)
    pg.Client.prototype.query = original
    expect(committed).toBe(true)
    expect(snapshot.rowCount).toBe(1)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0]).toMatchObject({ isometry: 'before', preHeatTreatmentControls: [{ requestName: 'before' }] })
    // A later request pinned to the old page must still refuse the changed DB.
    await expect(readJournalGrid({ ...input, revision: snapshot.revision })).rejects.toThrow('Данные журнала изменились')
    await expect(summarizeJournalGridSelection({ ids: [snapshot.rows[0].id],
      snapshot: { revision: snapshot.revision, columnFilters: input.columnFilters } })).rejects.toThrow('Данные журнала изменились')
    const current = await readJournalGrid(input)
    expect(current.rowCount).toBe(2)
    expect(current.revision).not.toBe(snapshot.revision)
    expect(current.rows.find(row => row.joint === 'S1')).toMatchObject({ isometry: 'after', preHeatTreatmentControls: [{ requestName: 'after' }] })
  } finally {
    pg.Client.prototype.query = original
    await cleanupLineProgramProjects([project])
  }
})
