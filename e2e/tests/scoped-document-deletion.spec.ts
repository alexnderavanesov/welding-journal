import { asE2eOwner } from '../with-owner-access'
import { expect, test } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { withLineProgramFixture, cleanupLineProgramProjects } from '../line-program-fixtures'
import { deleteWeldJoint as raw_deleteWeldJoint , deleteWeldJoints as raw_deleteWeldJoints } from '../../src/server/weld-mutations'
import { replaceWeldJoints as raw_replaceWeldJoints } from '../../src/server/weld-import'
import { loadSystemDocumentSummaries } from '../../src/server/system-document-index'
import { documentGridRow } from '../document-grid'
import { rpcName } from '../rpc'

const project = 'E2E scoped document cleanup'
test.beforeAll(() => loadSystemDocumentSummaries('lnkRequest'))
test.afterEach(async () => {
  await cleanupLineProgramProjects([project])
  await withE2eDatabase(db => db.query('delete from generated_documents where title like $1',[project+'%']))
})

for (const mode of ['single','bulk','replacement','replacement-without-deletion'] as const) {
  test(`${mode}: deleting one joint cannot purge unrelated legacy document history`, async () => {
    const fixture = await withLineProgramFixture(async db => {
      const targets = (await db.query<{ id: number; version: string }>(`insert into weld_joints(project_title,subtitle_code,line,joint)
        values($1,'SCOPE','SCOPE','F1'),($1,'SCOPE','SCOPE','F2') returning id,xmin::text version`,[project])).rows
      const documents = (await db.query<{ id: number; title: string }>(`insert into generated_documents(type,title,file_name,mime_type,row_count)
        select 'weldingJournal',$1||suffix,'history.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1
        from unnest(array[' target',' shared',' unrelated legacy']) suffix returning id,title`,[project])).rows
      const id = (suffix: string) => documents.find(row => row.title === project + suffix)!.id
      await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
        values($1,$3),($2,$3),($2,$4)`,[id(' target'),id(' shared'),targets[0].id,targets[1].id])
      const unrelated = (await db.query('select *,xmin::text version from generated_documents where id=$1',[id(' unrelated legacy')])).rows[0]
      return { targets, documents, unrelated }
    })
    if (mode === 'single') await deleteWeldJoint({data:fixture.targets[0]})
    else if (mode === 'bulk') await deleteWeldJoints({data:{targets:[fixture.targets[0]]}})
    else if (mode === 'replacement') await replaceWeldJoints({data:{records:[],deleteIds:[fixture.targets[0].id],expectedVersions:[fixture.targets[0]]}})
    else await replaceWeldJoints({data:{records:[{id:fixture.targets[1].id,responsible:'Scope audit'}],deleteIds:[],expectedVersions:[fixture.targets[1]]}})
    await withE2eDatabase(async db => {
      // The legacy record was not selected and has no connection to either
      // joint. Its missing membership does not authorize deleting its history.
      expect((await db.query('select *,xmin::text version from generated_documents where id=$1',[fixture.unrelated.id])).rows[0]).toEqual(fixture.unrelated)
      const surviving = (await db.query<{title:string}>(`select title from generated_documents where id=any($1::int[]) order by title`,
        [fixture.documents.map(row=>row.id)])).rows.map(row=>row.title)
      expect(surviving).toEqual((mode==='replacement-without-deletion'
        ? [' shared',' target',' unrelated legacy'] : [' shared',' unrelated legacy']).map(suffix=>project+suffix))
      expect((await db.query(`select weld_joint_id from generated_document_weld_joints where document_id=$1 order by weld_joint_id`,
        [fixture.documents.find(row=>row.title===project+' shared')!.id])).rows.map(row=>row.weld_joint_id))
        .toEqual(mode==='replacement-without-deletion' ? fixture.targets.map(row=>row.id) : [fixture.targets[1].id])
    })
  })
}

for (const type of ['weldingJournal', 'checklist', 'zni'] as const) {
  for (const first of ['joint', 'document'] as const) {
    test(`${type}: concurrent joint/document deletion, ${first} takes the row lock first`, async ({ page }) => {
      const fixture = await withLineProgramFixture(async db => {
        const targets = (await db.query<{ id: number }>(`insert into weld_joints(project_title,subtitle_code,line,joint)
          values($1,'RACE','RACE','F1'),($1,'RACE','RACE','F2') returning id`, [project])).rows
        const document = (await db.query<{ id: number }>(`insert into generated_documents(type,title,file_name,mime_type,row_count)
          values($1,$2,'race.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',2) returning id`,
        [type, project + ' concurrent membership'])).rows[0]
        await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])',
          [document.id, targets.map(row => row.id)])
        return { targets, document }
      })
      await page.goto('/documents')
      await page.getByRole('button', { name: { weldingJournal: 'ЖСР', checklist: 'Чек-лист', zni: 'ЗНИ' }[type], exact: true }).click()
      const { actions } = await documentGridRow(page, project + ' concurrent membership')
      await actions.getByRole('button', { name: 'Удалить документ', exact: true }).click()
      const target = await withE2eDatabase(async db => (await db.query<{ id: number; version: string }>(
        'select id,xmin::text version from weld_joints where id=$1', [fixture.targets[0].id])).rows[0])
      let release!: () => void, locked!: (pid: number) => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const ready = new Promise<number>(resolve => { locked = resolve })
      const holder = withE2eDatabase(async db => {
        await db.query('begin')
        try {
          await db.query('select id from weld_joints where id=$1 for update', [target.id])
          locked((await db.query('select pg_backend_pid() pid')).rows[0].pid)
          await gate
        } finally { await db.query('rollback') }
      })
      const pid = await ready
      // PostgreSQL can queue the second writer behind the first writer's tuple
      // lock rather than directly behind our holder's transaction lock.
      const waiting = () => withE2eDatabase(async db => Number((await db.query(`with recursive waiting(pid) as (
        select pid from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))
        union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
          where a.datname=current_database()) select count(*) n from waiting`, [pid])).rows[0].n))
      const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить документ', exact: true }) })
      let response: Promise<unknown> | undefined
      let deletion: Promise<{ ok: boolean; error?: string }> | undefined
      const removeJoint = () => { deletion = deleteWeldJoint({ data: target }).then(() => ({ ok: true }), error => ({ ok: false, error: String(error) })) }
      const removeDocument = async () => {
        response = page.waitForResponse(r => rpcName(r.url()).startsWith('deleteRemoteGeneratedDocument_')).catch(error => ({ error }))
        await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
      }
      try {
        if (first === 'joint') removeJoint()
        else await removeDocument()
        await expect.poll(waiting).toBe(1)
        if (first === 'joint') await removeDocument()
        else removeJoint()
        await expect.poll(waiting).toBe(2)
      } finally {
        release(); await holder
        await Promise.all([deletion, response])
      }
      const result = await deletion!
      await response
      if (first === 'joint') {
        expect(result).toEqual({ ok: true })
        await expect(page.getByRole('alert')).toContainText('Документ уже изменен')
      } else {
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/изменен|изменил|устарел/i)
        await expect(actions).toHaveCount(0)
      }
      await withE2eDatabase(async db => {
        const joints = (await db.query('select id from weld_joints where project_title=$1 order by id', [project])).rows.map(row => row.id)
        expect(joints).toEqual(first === 'joint' ? [fixture.targets[1].id] : fixture.targets.map(row => row.id))
        const links = (await db.query('select weld_joint_id from generated_document_weld_joints where document_id=$1', [fixture.document.id])).rows
        expect(links).toEqual(first === 'joint' ? [{ weld_joint_id: fixture.targets[1].id }] : [])
        expect((await db.query('select id from generated_documents where id=$1', [fixture.document.id])).rowCount).toBe(first === 'joint' ? 1 : 0)
      })
    })
  }
}

for (const type of ['weldingJournal', 'checklist', 'zni'] as const) {
  for (const mode of ['single', 'bulk', 'replacement'] as const) {
    test(`${type} ${mode}: stale membership confirmation cannot delete a changed shared document`, async ({ page }) => {
      const fixture = await withLineProgramFixture(async db => {
        const targets = (await db.query<{ id: number; version: string }>(`insert into weld_joints(project_title,subtitle_code,line,joint)
          values($1,'SCOPE','SCOPE','F1'),($1,'SCOPE','SCOPE','F2') returning id,xmin::text version`, [project])).rows
        const document = (await db.query<{id:number;updated_at:Date}>(`insert into generated_documents(type,title,file_name,mime_type,row_count)
          values($1,$2,'shared.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',2) returning id,updated_at`,
        [type, project + ' stale membership'])).rows[0]
        await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])',
          [document.id, targets.map(row => row.id)])
        return { targets, document }
      })
      await page.goto('/documents')
      await page.getByRole('button', {name: {weldingJournal:'ЖСР',checklist:'Чек-лист',zni:'ЗНИ'}[type],exact:true}).click()
      const {actions:row} = await documentGridRow(page, project + ' stale membership')
      await row.getByRole('button', {name:'Удалить документ',exact:true}).click()
      if (mode === 'single') await deleteWeldJoint({data:fixture.targets[0]})
      else if (mode === 'bulk') await deleteWeldJoints({data:{targets:[fixture.targets[0]]}})
      else await replaceWeldJoints({data:{records:[],deleteIds:[fixture.targets[0].id],expectedVersions:[fixture.targets[0]]}})
      const confirmation = page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Удалить документ',exact:true})})
      await confirmation.getByRole('button',{name:'Удалить',exact:true}).click()
      await expect(page.getByRole('alert')).toContainText('Документ уже изменен')
      await withE2eDatabase(async db => {
        expect((await db.query('select weld_joint_id from generated_document_weld_joints where document_id=$1', [fixture.document.id])).rows)
          .toEqual([{weld_joint_id:fixture.targets[1].id}])
      })
      await page.getByRole('button',{name:'Обновить историю',exact:true}).click()
      const {actions:updatedRow} = await documentGridRow(page, project + ' stale membership')
      await updatedRow.getByRole('button',{name:'Удалить документ',exact:true}).click()
      await confirmation.getByRole('button',{name:'Удалить',exact:true}).click()
      await expect(updatedRow).toHaveCount(0)
      expect(await withE2eDatabase(async db => (await db.query('select id from generated_documents where id=$1', [fixture.document.id])).rows)).toEqual([])
    })
  }
}

const deleteWeldJoint = asE2eOwner(raw_deleteWeldJoint, 'welding.delete')
const deleteWeldJoints = asE2eOwner(raw_deleteWeldJoints, 'welding.delete')
const replaceWeldJoints = asE2eOwner(raw_replaceWeldJoints, 'welding.view')
