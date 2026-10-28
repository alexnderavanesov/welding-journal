import { expect, test } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { readAcrossCommittedWrite } from '../interleaved-read'
import { loadRemoteGeneratedDocumentRows } from '../../src/server/generated-documents'
import { getDocumentGenerationData } from '../../src/server/weld-read'

const project = 'E2E document coherent source'
test.afterEach(() => cleanupLineProgramProjects([project]))

for (const entry of ['history', 'generation'] as const) for (const action of ['change', 'delete'] as const) test(`документ/${entry}: ${action} между чтениями не смешивает факты, контроль и принадлежность`, async () => {
  const { id, documentId } = await withLineProgramFixture(async db => {
    const { rows: [weld] } = await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type)
      values($1,'SNAP','OLD-LINE','S1','2026-09-01','С17') returning id`, [project])
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,result,conclusion_name,conclusion_date)
      values($1,'ВИК','годен','OLD-VIK','2026-09-01')`, [weld.id])
    const { rows: [document] } = await db.query(`insert into generated_documents(type,title,file_name,mime_type)
      values('weldingJournal','OLD-DOCUMENT','snapshot.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') returning id`)
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document.id, weld.id])
    return { id: weld.id as number, documentId: document.id as number }
  })
  const expected = { id, line: 'OLD-LINE', jsrDocument: 'OLD-DOCUMENT',
    preHeatTreatmentControls: [expect.objectContaining({ conclusionName: 'OLD-VIK' })] }
  const read = () => entry === 'history' ? loadRemoteGeneratedDocumentRows(documentId)
    : getDocumentGenerationData({ data: { projects: [project] } }).then(result => result.rows)
  expect(await read()).toEqual([expect.objectContaining(expected)])
  const snapshot = await readAcrossCommittedWrite(read,
    sql => sql.includes(entry === 'history' ? 'from "generated_document_weld_joints"' : 'from "weld_joints"') && sql.includes('"connection_type"'),
    () => withLineProgramFixture(async db => {
      if (action === 'delete') {
        await db.query('delete from generated_documents where id=$1', [documentId])
        await db.query('delete from weld_joints where id=$1', [id])
      } else {
        await db.query("update weld_joints set line='NEW-LINE' where id=$1", [id])
        await db.query("update pre_heat_treatment_controls set conclusion_name='NEW-VIK' where weld_joint_id=$1", [id])
        await db.query("update generated_documents set title='NEW-DOCUMENT' where id=$1", [documentId])
      }
    }))
  expect(snapshot).toEqual([expect.objectContaining(expected)])
  const next = await read()
  expect(next).toEqual(action === 'delete' ? [] : [expect.objectContaining({ id, line: 'NEW-LINE', jsrDocument: 'NEW-DOCUMENT',
    preHeatTreatmentControls: [expect.objectContaining({ conclusionName: 'NEW-VIK' })] })])
})
