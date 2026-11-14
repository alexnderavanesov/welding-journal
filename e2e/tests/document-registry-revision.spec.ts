import { expect, test } from '@playwright/test'
import { sql } from 'drizzle-orm'
import { requireDb } from '../../src/db'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { GENERATED_DOCUMENT_HISTORY_REVISION_FIELDS, loadRemoteGeneratedDocumentHistoryGrid, normalizeGeneratedDocumentHistoryGridRequest, prepareGeneratedDocumentHistoryOutput } from '../../src/server/generated-documents'

const project = 'E2E full registry revision'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('manual registry revision covers off-page facts and membership without hashing duplicate display fields', async () => {
  const { joints, docs } = await withE2eDatabase(async db => {
    const joints = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date,wdi)
      select $1,'L','F'||n,'2026-10-01',n from generate_series(1,2) n returning id`, [project])).rows.map(r => r.id)
    const docs = (await db.query(`insert into generated_documents(type,title,file_name,mime_type)
      select 'weldingJournal',$1||'-'||n,'revision.xlsx','application/octet-stream' from generate_series(1,2) n returning id`, [project])).rows.map(r => r.id)
    for (let i = 0; i < 2; i++) await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [docs[i], joints[i]])
    return { joints, docs }
  })
  const request = normalizeGeneratedDocumentHistoryGridRequest({ types: ['weldingJournal'], search: project,
    startRow: 0, endRow: 1, rowGroupCols: [], groupKeys: [], sortModel: [{ colId: 'title', sort: 'asc' }] })
  // A future new source value must enter the revision contract too. Only the
  // deterministic filter_* copies and output counter may be omitted.
  const output = await prepareGeneratedDocumentHistoryOutput(requireDb(), request)
  const source = await requireDb().execute(sql`select * from (${output.query}) as source limit 1`)
  expect(Object.keys(source.rows[0]).filter(key => !key.startsWith('filter_') && key !== '__outputTotal').sort())
    .toEqual([...GENERATED_DOCUMENT_HISTORY_REVISION_FIELDS].sort())
  const read = () => loadRemoteGeneratedDocumentHistoryGrid(request)
  let before = await read()
  expect(before.total).toBe(2)
  expect(before.rows[0].id).toBe(docs[0])
  const changed = async (action: () => Promise<unknown>) => {
    await action()
    const after = await read()
    expect(after.rows).toEqual(before.rows)
    expect(after.revision).not.toBe(before.revision)
    await expect(loadRemoteGeneratedDocumentHistoryGrid({ ...request, idsOnly: true, revision: before.revision }))
      .rejects.toThrow('Данные реестра изменились')
    before = after
  }
  // Do not touch generated_documents.updated_at: a timestamp-only revision
  // would miss these edits to an associated joint outside the visible page.
  await changed(() => withE2eDatabase(db => db.query("update weld_joints set wdi=7,weld_date='2026-10-03',line='L2' where id=$1", [joints[1]])))
  await changed(() => withE2eDatabase(db => db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2)', [docs[1], joints[0]])))
  await changed(() => withE2eDatabase(db => db.query("update generated_documents set specialists=$2 where id=$1", [docs[1], JSON.stringify({ first: { id: 1, name: 'Changed' } })])))
  await withE2eDatabase(db => db.query("update weld_joints set welding_journal_note='unrelated note' where id=$1", [joints[1]]))
  expect((await read()).revision).toBe(before.revision)
})
