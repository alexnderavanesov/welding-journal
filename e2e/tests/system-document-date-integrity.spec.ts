import { asE2eOwner } from '../with-owner-access'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { changeSystemDocumentDate as raw_changeSystemDocumentDate } from '@/server/system-document-date-workflow'

const project = 'E2E document date integrity'
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  return withE2eDatabase(async db => {
    const row = (await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,has_vik,
      vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,final_status)
      values ($1,'DATE','DATE-L1','F990','2026-08-01','да','Date integrity request','2026-08-01','годен','Date integrity result','2026-08-03','годен')
      returning id,xmin::text as version`, [project])).rows[0]
    const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values ('system:lnkRequest','Date integrity request','date.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-08-01','2026-08-01',1,$1) returning id`,
      [JSON.stringify({ methodCodes: ['ВИК'], positionCount: 1, projects: [project], lines: ['DATE-L1'] })])).rows[0]
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)`, [doc.id, row.id])
    return { row, doc }
  })
}

test('date change follows weld-before-document locking used by rebuild and does not deadlock', async () => {
  const { row, doc } = await seed()
  let dateChange: Promise<{ error?: unknown }> | undefined
  await withE2eDatabase(async db => {
    await db.query('begin')
    let committed = false
    await db.query(`set local lock_timeout='3s'`)
    const pid = (await db.query('select pg_backend_pid() as pid')).rows[0].pid
    await db.query('select id from weld_joints where id=$1 for update', [row.id])
    try {
      dateChange = changeSystemDocumentDate({ data: {
        reference: { documentId: doc.id, type: 'lnkRequest', title: 'Date integrity request', date: '2026-08-01' },
        nextDate: '2026-08-02', expectedVersions: [row],
      } }).then(() => ({}), error => ({ error }))
      await expect.poll(() => withE2eDatabase(async observer => (await observer.query(
        `select count(*)::int as count from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid))`, [pid],
      )).rows[0].count)).toBe(1)
      // Represents the common weld mutation/rebuild order. Date editing must
      // wait without holding this document, otherwise PostgreSQL finds a cycle.
      await db.query('update generated_documents set updated_at=updated_at where id=$1', [doc.id])
      await db.query('commit')
      committed = true
    } finally {
      if (!committed) await db.query('rollback')
    }
  })
  expect(await dateChange).toEqual({})
  await withE2eDatabase(async db => {
    const after = (await db.query(`select vik_request_date::text,vik_result,vik_conclusion from weld_joints where id=$1`, [row.id])).rows[0]
    expect(after).toEqual({ vik_request_date: '2026-08-02', vik_result: 'годен', vik_conclusion: 'Date integrity result' })
  })
})

const changeSystemDocumentDate = asE2eOwner(raw_changeSystemDocumentDate, 'documents.edit')

test('whole-document rename rejects a collision or stale member without partial writes', async () => {
  const { row, doc } = await seed()
  await withE2eDatabase(async db => {
    const other = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date,has_vik,vik_request,vik_request_date)
      values ($1,'DATE-L1','F991','2026-08-01','да','Taken request','2026-08-01') returning id`, [project])).rows[0]
    const target = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count)
      values ('system:lnkRequest','Taken request','taken.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-08-01','2026-08-01',1) returning id`)).rows[0]
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [target.id, other.id])
  })
  const data = { reference: { documentId: doc.id, type: 'lnkRequest' as const, title: 'Date integrity request', date: '2026-08-01' },
    nextDate: '2026-08-01', nextTitle: 'Taken request', expectedVersions: [row] }
  const snapshot = () => withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    docs: (await db.query('select d.* from generated_documents d where exists(select 1 from generated_document_weld_joints a join weld_joints w on w.id=a.weld_joint_id where a.document_id=d.id and w.project_title=$1) order by d.id', [project])).rows,
  }))
  const before = await snapshot()
  await expect(changeSystemDocumentDate({ data })).rejects.toThrow('уже существует')
  expect(await snapshot()).toEqual(before)
  await withE2eDatabase(db => db.query('update weld_joints set updated_at=now() where id=$1', [row.id]))
  const stale = await snapshot()
  await expect(changeSystemDocumentDate({ data: { ...data, nextTitle: 'Unique request' } })).rejects.toThrow('уже изменен')
  expect(await snapshot()).toEqual(stale)
})

test('a chronology conflict on the third joint rejects the whole conclusion date and name atomically', async () => {
  const fixture = await withE2eDatabase(async db => {
    const rows = (await db.query(`insert into weld_joints(project_title,line,joint,weld_date,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date)
      select $1,'DATE-L3','F' || n,'2026-08-01','да','Three-joint request',case when n=3 then '2026-08-09'::date else '2026-08-02'::date end,
      'годен','Three-joint conclusion','2026-08-10' from generate_series(1,3) n returning id,xmin::text as version`, [project])).rows
    const doc = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata)
      values ('system:lnkConclusionVik','Three-joint conclusion','three.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-08-10','2026-08-10',3,$1) returning id`,
      [JSON.stringify({ methodCode: 'ВИК', methodCodes: ['ВИК'], positionCount: 3 })])).rows[0]
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [doc.id, rows.map(row => row.id)])
    return { rows, doc }
  })
  const snapshot = () => withE2eDatabase(async db => ({
    rows: (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows,
    document: (await db.query('select * from generated_documents where id=$1', [fixture.doc.id])).rows,
  }))
  const before = await snapshot()
  await expect(changeSystemDocumentDate({ data: {
    reference: { documentId: fixture.doc.id, type: 'lnkConclusion', methodCode: 'ВИК', title: 'Three-joint conclusion', date: '2026-08-10' },
    nextDate: '2026-08-08', nextTitle: 'Changed together', expectedVersions: fixture.rows,
  } })).rejects.toThrow(/F3/)
  expect(await snapshot()).toEqual(before)
})
