import { expect, test } from '@playwright/test'
import { loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest } from '../../src/server/generated-documents'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const project = 'E2E document transfer empty dates'
test.afterEach(() => cleanupLineProgramProjects([project]))
test('range summaries count the displayed empty date consistently for ordinary and layered documents', async () => {
  await withLineProgramFixture(async db => {
    const { rows: [joint] } = await db.query(`insert into weld_joints(project_title,line,joint,officiality)
      values($1,'EMPTY-DATE','F1','действующий') returning id`, [project])
    const { rows: documents } = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
      values('weldingJournal',$1,'empty.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1),
      ('layeredVikEdges',$1,'empty.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1) returning id`, [project])
    for (const document of documents) await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [document.id,joint.id])
  })
  for (const type of ['weldingJournal','layeredVikEdges'] as const) {
    const request = { type, search: project, startRow: 0, endRow: 100, rowGroupCols: [], groupKeys: [], sortModel: [] }
    const cells = await loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...request, cells: { columns: ['period','rowCount'] } }))
    expect(cells.cells).toEqual([[type === 'weldingJournal' ? ' - ' : '', 1]])
    const result = await loadRemoteGeneratedDocumentHistoryGrid(normalizeGeneratedDocumentHistoryGridRequest({ ...request, revision: cells.revision, cells: { columns: ['period','rowCount'], summary: true } }))
    expect(result.summary).toEqual({ count: type === 'weldingJournal' ? 2 : 1, numericCount: 1, sum: 1, average: 1 })
  }
})
