import { expect, test } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { saveJournalCellEdits } from '../../src/server/journal-inline-edit'
import { JOURNAL_INLINE_FIELDS } from '../../src/lib/journal-inline-edit'
import { FIELD_BY_KEY } from '../../src/lib/weld-fields'

const project = 'E2E journal document preservation', foreignProject = `${project} foreign`
const save = asE2eOwner(saveJournalCellEdits, 'welding.edit')

test.afterEach(async () => { await cleanupLineProgramProjects([project, foreignProject]) })

test('all eleven inline fields fill and clear without rebuilding ordinary or historical shared documents', async () => {
  const { id, foreignId, documentIds } = await withLineProgramFixture(async db => {
    const ids: number[] = []
    for (const title of [project, foreignProject]) ids.push((await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,
      connection_type,material_group,welding_method,rk_conclusion,rk_conclusion_date)
      values($1,'DOC-HISTORY','L','F1','С17','М01','РД','Historical primary RK','2025-01-02') returning id`, [title])).rows[0].id)
    const controls: number[] = []
    for (const id of ids) controls.push((await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,conclusion_name,conclusion_date,result)
      values($1,'ВИК','Historical before heat treatment','2025-01-02','годен') returning id`, [id])).rows[0].id)
    const metadata = [
      { sourceKind: 'pstoCycle', positionCount: 2 }, // Old record has no source positions.
      { sourceKind: 'pstoCycle', sourcePositions: [{ kind: 'pstoCycle', weldJointId: 2147483646, relationId: 2147483646, sequence: 1 }] },
      { sourceKind: 'beforeHeatTreatment', sourcePositions: ids.map((id, index) => ({
        kind: 'beforeHeatTreatment', weldJointId: id, relationId: controls[index], methodCode: 'ВИК',
      })) },
      { label: 'Historical primary RK', methodCode: 'РК', methodCodes: ['РК'], positionCount: 2 },
    ]
    const types = ['system:pstoConclusion', 'system:tvmtConclusion', 'system:lnkConclusionVik', 'system:lnkConclusionRk']
    const documentIds: number[] = []
    for (const [index, type] of types.entries()) {
      const document = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,
        row_count,wdi_total,source_metadata,specialists,specialists_revision)
        values($1,$2,$3,'legacy/type','2025-01-02','2025-01-02',2,null,$4,
          '{"first":{"id":101,"name":"Сохранённый исполнитель","certificate":"OLD-CERT"}}',3) returning id`,
      [type, index === 3 ? 'Historical primary RK' : `Historical ${index}`, `Historical ${index}.xlsx`, JSON.stringify(metadata[index])])).rows[0]
      documentIds.push(document.id)
      for (const id of ids) await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document.id, id])
    }
    return { id: ids[0], foreignId: ids[1], documentIds }
  })
  const snapshot = () => withE2eDatabase(async db => ({
    documents: (await db.query('select *,xmin::text version from generated_documents where id=any($1::integer[]) order by id', [documentIds])).rows,
    assignments: (await db.query('select * from generated_document_weld_joints where document_id=any($1::integer[]) order by document_id,weld_joint_id', [documentIds])).rows,
    controls: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=any($1::integer[]) order by id', [[id, foreignId]])).rows,
    chainStates: (await db.query('select * from weld_joint_program_states where weld_joint_id=any($1::integer[]) order by weld_joint_id', [[id, foreignId]])).rows,
    foreign: (await db.query('select *,xmin::text version from weld_joints where id=$1', [foreignId])).rows[0],
  }))
  const before = await snapshot()
  for (const field of JOURNAL_INLINE_FIELDS) {
    const value = FIELD_BY_KEY.get(field)!.kind === 'number' ? 2.5 : `Updated ${field}`
    for (const next of [value, null]) {
      const version = await withE2eDatabase(async db => (await db.query('select xmin::text version from weld_joints where id=$1', [id])).rows[0].version)
      await save({ edits: [{ id, version, values: { [field]: next } }] })
      // Includes timestamps/xmin, source JSON, memberships of the foreign
      // project, performer snapshots, control history and chain state.
      expect(await snapshot()).toEqual(before)
    }
  }
})
