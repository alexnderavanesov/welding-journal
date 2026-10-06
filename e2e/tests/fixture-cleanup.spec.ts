import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'

test('очистка фикстур сохраняет общие документы и записи чужого/пустого проекта', async () => {
  const project = 'E2E cleanup owned', other = 'E2E cleanup retained'
  const { ids, documents } = await withE2eDatabase(async db => {
    const ids: number[] = []
    for (const value of [project, other, null]) ids.push((await db.query(
      'insert into weld_joints(project_title,joint) values ($1,$2) returning id', [value, `CLEANUP-${ids.length}`],
    )).rows[0].id)
    const documents: number[] = []
    for (const members of [[ids[0]], [ids[0], ids[1]], [ids[0], ids[2]], []]) {
      const id = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count)
        values ('weldingJournal','E2E cleanup','cleanup.xlsx','application/octet-stream',$1) returning id`, [members.length])).rows[0].id
      documents.push(id)
      if (members.length) await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [id, members])
    }
    return { ids, documents }
  })
  try {
    await cleanupLineProgramProjects([project])
    const after = await withE2eDatabase(async db => ({
      ids: (await db.query('select id from weld_joints where id=any($1::int[]) order by id', [ids])).rows.map(row => row.id),
      documents: (await db.query('select id from generated_documents where id=any($1::int[]) order by id', [documents])).rows.map(row => row.id),
    }))
    expect(after.ids).toEqual(ids.slice(1))
    expect(after.documents).toEqual(documents.slice(1))
    await cleanupLineProgramProjects([])
    expect((await withE2eDatabase(db => db.query('select id from generated_documents where id=any($1::int[]) order by id', [documents]))).rows.map(row => row.id)).toEqual(after.documents)
  } finally {
    await withE2eDatabase(async db => {
      await db.query('delete from generated_documents where id=any($1::int[])', [documents])
      await db.query('delete from weld_joints where id=any($1::int[])', [ids])
    })
  }
})
