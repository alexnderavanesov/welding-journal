import { expect, test } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { generatedDocuments, weldJoints } from '@/db/schema'
import { buildGeneratedDocumentReferenceWhere, buildSystemDocumentReferencesWhere } from '@/server/system-document-index'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

const project = 'E2E exact document references'
test.afterEach(() => cleanupLineProgramProjects([project]))

test('batch lookup preserves exact title/date pairs, null dates, own methods and TVMT separation', async () => {
  const ids = await withE2eDatabase(async db => (await db.query(`insert into weld_joints
    (project_title,joint,heat_treatment_diagram,psto_date,rk_request,rk_request_date,vik_request,vik_request_date,
      tvmt_request,tvmt_request_date,rk_conclusion,rk_conclusion_date,uzk_conclusion,uzk_conclusion_date)
    values ($1,'S1',' A ','2026-09-01','OWN','2026-09-01',null,null,'TV','2026-09-02','C','2026-09-01','C','2026-09-02'),
      ($1,'S2','A','2026-09-02',null,null,'OWN','2026-09-01','TV','2026-09-02','C','2026-09-02','C','2026-09-01'),
      ($1,'S3','B','2026-09-02',null,null,null,null,'OWN','2026-09-01',null,null,null,null),
      ($1,'S4','B','2026-09-01',null,null,null,null,null,null,null,null,null,null),
      ($1,'S5',null,null,null,null,null,null,null,null,null,null,null,null) returning id`, [project])).rows.map(row => row.id as number))
  const db = requireDb()
  const selected = async (references: SystemDocumentReference[]) => (await db.select({ id: weldJoints.id }).from(weldJoints)
    .where(and(eq(weldJoints.projectTitle, project), buildSystemDocumentReferencesWhere(references)))).map(row => row.id).sort((a, b) => a - b)
  expect(await selected([
    { type: 'pstoConclusion', title: 'A', date: '2026-09-01' },
    { type: 'pstoConclusion', title: 'B', date: '2026-09-02' },
  ])).toEqual([ids[0], ids[2]])
  expect(await selected([{ type: 'pstoConclusion', title: '', date: '' }])).toEqual([ids[4]])
  expect(await selected([{ type: 'lnkRequest', title: 'OWN', date: '2026-09-01' }])).toEqual([ids[0], ids[1]])
  expect(await selected([{ type: 'lnkRequest', methodCode: 'ТВМТ', title: 'OWN', date: '2026-09-01' }])).toEqual([ids[2]])
  expect(await selected([{ type: 'lnkConclusion', methodCode: 'РК', title: 'C', date: '2026-09-01' }])).toEqual([ids[0]])
  expect(await selected([{ type: 'lnkConclusion', methodCode: 'УЗК', title: 'C', date: '2026-09-01' }])).toEqual([ids[1]])
  expect(await selected([])).toEqual([])

  const documentIds = await withE2eDatabase(async client => {
    const records = (await client.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count)
      values ('system:pstoConclusion','A','lookup.xlsx','application/octet-stream','2026-09-01','2026-09-01',1),
      ('system:pstoConclusion','A','lookup.xlsx','application/octet-stream','2026-09-02','2026-09-02',1),
      ('system:pstoConclusion','B','lookup.xlsx','application/octet-stream',null,null,1),
      ('system:lnkConclusionRk','A','lookup.xlsx','application/octet-stream','2026-09-01','2026-09-01',1)
      returning id`)).rows.map(row => row.id as number)
    await client.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select unnest($1::int[]),$2', [records, ids[0]])
    return records
  })
  const documents = await db.select({ id: generatedDocuments.id }).from(generatedDocuments).where(buildGeneratedDocumentReferenceWhere([
    { type: 'pstoConclusion', title: 'A', date: '2026-09-01' }, { type: 'pstoConclusion', title: 'B', date: '' },
  ]))
  expect(documents.map(row => row.id).sort((a, b) => a - b)).toEqual([documentIds[0], documentIds[2]])
})
