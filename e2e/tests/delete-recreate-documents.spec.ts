import { expect, test } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { requireDb } from '@/db'
import { preHeatTreatmentControls, weldJoints } from '@/db/schema'
import { buildSystemDocumentSummaries } from '@/lib/system-document-types'
import { createWeldJoint, deleteWeldJoint, deleteWeldJoints } from '@/server/weld-mutations'
import { replaceWeldJoints } from '@/server/weld-import'
import { loadRemoteGeneratedDocument, loadRemoteGeneratedDocumentRows, loadRemoteGeneratedDocumentHistory, normalizeGeneratedDocumentHistoryRequest } from '@/server/generated-documents'
import { syncPreHeatTreatmentDocumentsInTransaction } from '@/server/pre-heat-treatment-system-documents'
import { syncSystemDocumentsForWeldChangesInTransaction, upsertSourcedSystemDocumentInTransaction } from '@/server/system-document-index'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { rpcName } from '../rpc'

const project = 'E2E delete and recreate with shared history'
type Target = { id: number; version: string }
let previousDataList: { value: string; updated_at: Date } | undefined
test.beforeAll(async () => withE2eDatabase(async db => {
  previousDataList = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
  const settings = previousDataList ? JSON.parse(previousDataList.value) : {}
  settings.connectionTypes = [...new Set([...(settings.connectionTypes ?? []), 'СШ'])]
  await db.query(`insert into app_settings(key,value) values ('data-list',$1)
    on conflict(key) do update set value=excluded.value`, [JSON.stringify(settings)])
}))
test.afterAll(async () => withE2eDatabase(async db => {
  if (previousDataList) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [previousDataList.value, previousDataList.updated_at])
  else await db.query("delete from app_settings where key='data-list'")
}))
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed() {
  const { ids, manualIds } = await withE2eDatabase(async db => {
    const { rows } = await db.query<{ id: number }>(`insert into weld_joints
      (project_title,subtitle_code,line,joint,weld_date,connection_type,officiality,revision_actuality,
        has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        psto_required,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram,
        tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,wdi)
      select $1,'DOC-DELETE','DOC-DELETE','F20'||n,case when n=1 then '2026-09-01'::date else '2026-09-02'::date end,
        'СШ','действующий','актуальная','да','SHARED-PRIMARY-R','2026-09-06','годен','SHARED-PRIMARY-C','2026-09-07',
        'да','SHARED-PSTO-R','2026-09-03','проведено','2026-09-04','SHARED-PSTO-C',
        'SHARED-TVMT-R','2026-09-05','годен','SHARED-TVMT-C','2026-09-05',n
      from generate_series(1,2) n returning id`, [project])
    const ids = rows.map(row => row.id)
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      select unnest($1::int[]),'ВИК','SHARED-PRE-R','2026-09-02','годен','SHARED-PRE-C','2026-09-02'`, [ids])
    const manualIds: number[] = []
    for (const type of ['weldingJournal', 'checklist', 'zni']) {
      const { rows: [document] } = await db.query(`insert into generated_documents
        (type,title,file_name,mime_type,period_from,period_to,row_count,wdi_total)
        values ($1,$2,'test.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','2026-09-01','2026-09-02',2,3) returning id`,
      [type, `SHARED-${type}`])
      manualIds.push(document.id)
      await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [document.id, ids])
    }
    return { ids, manualIds }
  })
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
    const controls = await tx.select().from(preHeatTreatmentControls).where(inArray(preHeatTreatmentControls.weldJointId, ids))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
    await syncPreHeatTreatmentDocumentsInTransaction(tx, rows, controls)
    const summary = buildSystemDocumentSummaries(rows, 'pstoRequest')[0]!
    await upsertSourcedSystemDocumentInTransaction({ tx,
      summary: { ...summary, sourceKind: 'pstoCycle', cycleSequences: [1] },
      sourcePositions: ids.map(id => ({ kind: 'pstoCycle', weldJointId: id, relationId: id, sequence: 1 })),
    })
  })
  const targets = await withE2eDatabase(async db => (await db.query<Target>(
    'select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows)
  return { ids, manualIds, targets }
}

for (const mode of ['single', 'bulk', 'import'] as const) test(`${mode}: удаление и новый стык с тем же номером не портят общие документы и не наследуют старую историю`, async ({ page }) => {
  const { ids, manualIds, targets } = await seed()
  const otherBefore = await withE2eDatabase(async db => (await db.query('select * from weld_joints where id=$1', [ids[1]])).rows[0])
  if (mode === 'single') await deleteWeldJoint({ data: targets[0] })
  else if (mode === 'bulk') await deleteWeldJoints({ data: { targets: [targets[0]] } })
  else await replaceWeldJoints({ data: { records: [], deleteIds: [ids[0]], expectedVersions: [targets[0]] } })

  expect(await withE2eDatabase(async db => (await db.query('select * from weld_joints where id=$1', [ids[1]])).rows[0])).toEqual(otherBefore)
  // Replay of an old delete must not affect another ID, including a future namesake.
  await expect(deleteWeldJoint({ data: targets[0] })).rejects.toThrow(/больше не существуют|устарел/)
  const fresh = await createWeldJoint({ data: { projectTitle: project, subtitleCode: 'DOC-DELETE', line: 'DOC-DELETE',
    joint: 'F201', connectionType: 'СШ', officiality: 'действующий', revisionActuality: 'актуальная' } })
  expect(fresh.id).not.toBe(ids[0])
  expect(fresh.vikConclusion).toBeNull()
  expect(fresh.pstoRequest).toBeNull()
  const state = await withE2eDatabase(async db => ({
    links: (await db.query('select * from generated_document_weld_joints where weld_joint_id=any($1::int[])', [[ids[0], fresh.id]])).rows,
    pre: (await db.query('select * from pre_heat_treatment_controls where weld_joint_id=any($1::int[])', [[ids[0], fresh.id]])).rows,
    sourced: (await db.query(`select d.row_count,d.source_metadata from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      where a.weld_joint_id=$1 and d.source_metadata is not null`, [ids[1]])).rows,
  }))
  expect(state.links).toEqual([])
  expect(state.pre).toEqual([])
  expect(state.sourced.length).toBeGreaterThan(3)
  for (const document of state.sourced) {
    expect(document.row_count).toBe(1)
    const positions = JSON.parse(document.source_metadata).sourcePositions ?? []
    expect(positions.every((position: { weldJointId: number }) => position.weldJointId === ids[1])).toBe(true)
  }
  for (const [index, type] of (['weldingJournal', 'checklist', 'zni'] as const).entries()) {
    const history = await loadRemoteGeneratedDocumentHistory(normalizeGeneratedDocumentHistoryRequest({ type, documentId: manualIds[index] }))
    expect(history.documents[0]).toMatchObject({ rowCount: 1, periodFrom: '2026-09-02', periodTo: '2026-09-02' })
    expect((await loadRemoteGeneratedDocumentRows(manualIds[index])).map(row => row.id)).toEqual([ids[1]])
    expect(await loadRemoteGeneratedDocument(manualIds[index])).toMatchObject({ rowCount: 1, periodFrom: '2026-09-02', periodTo: '2026-09-02' })
  }
  if (mode === 'single') {
    await page.goto('/journal')
    await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
    await page.getByRole('button', { name: 'F201', exact: true }).click()
    const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Картина стыка F201', exact: true }) })
    await expect(picture).toBeVisible()
    await expect(picture.getByText(/SHARED-/)).toHaveCount(0)
  }
})

for (const [documentIndex, label] of ['ЖСР', 'Чек-лист', 'ЗНИ'].entries()) test(`${label}: отмена и подтверждение удаления из истории без потери фактов стыков`, async ({ page }) => {
  const { ids, manualIds } = await seed()
  const errors: string[] = []
  const calls: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(rpcName(request.url())) })
  await page.goto('/documents')
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('tab', { name: 'История', exact: true }).click()
  const title = `SHARED-${['weldingJournal', 'checklist', 'zni'][documentIndex]}`
  const row = page.getByRole('button', { name: title, exact: true }).locator('..')
  await expect(row).toBeVisible()
  const historyReads = () => calls.filter(name => name.startsWith('listRemoteGeneratedDocumentHistory_')).length
  const deleteWrites = () => calls.filter(name => name.startsWith('deleteRemoteGeneratedDocument_')).length
  const initialReads = historyReads()
  await row.getByRole('button', { name: 'Удалить документ', exact: true }).click()
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить документ', exact: true }) })
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await loadRemoteGeneratedDocument(manualIds[documentIndex])).not.toBeNull()
  expect(deleteWrites()).toBe(0)
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')) })
  await row.getByRole('button', { name: 'Удалить документ', exact: true }).click()
  expect(historyReads()).toBe(initialReads)
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(() => loadRemoteGeneratedDocument(manualIds[documentIndex])).toBeNull()
  await expect(row).toHaveCount(0)
  expect(deleteWrites()).toBe(1)
  expect(historyReads()).toBe(initialReads + 1)
  expect(await withE2eDatabase(async db => (await db.query(
    'select id,vik_conclusion,psto_request from weld_joints where id=any($1::int[]) order by id', [ids])).rows)).toEqual(
    ids.map(id => ({ id, vik_conclusion: 'SHARED-PRIMARY-C', psto_request: 'SHARED-PSTO-R' })),
  )
  expect(errors).toEqual([])
})

test('измененный ЖСР нельзя удалить устаревшим подтверждением; обновление истории позволяет повторить действие', async ({ page }, testInfo) => {
  const { manualIds } = await seed()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  const row = page.getByRole('button', { name: 'SHARED-weldingJournal', exact: true }).locator('..')
  await row.getByRole('button', { name: 'Удалить документ', exact: true }).click()
  // Simulate a committed document revision after the operator saw the old name.
  await withE2eDatabase(db => db.query("update generated_documents set title='SHARED-CHANGED',updated_at=updated_at+interval '1 second' where id=$1", [manualIds[0]]))
  const confirmation = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Удалить документ', exact: true }) })
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Документ уже изменен')
  await page.screenshot({ path: testInfo.outputPath('document-stale-delete-recovery.png') })
  expect(await loadRemoteGeneratedDocument(manualIds[0])).toMatchObject({ title: 'SHARED-CHANGED', rowCount: 2 })
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click()
  const changedRow = page.getByRole('button', { name: 'SHARED-CHANGED', exact: true }).locator('..')
  await expect(changedRow).toBeVisible()
  await changedRow.getByRole('button', { name: 'Удалить документ', exact: true }).click()
  await expect(confirmation).toContainText('SHARED-CHANGED')
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(changedRow).toHaveCount(0)
  expect(await loadRemoteGeneratedDocument(manualIds[0])).toBeNull()
  expect(errors).toEqual([])
})

test('реквизиты документа на 200000 стыков возвращают одну сводку без выгрузки строк', async () => {
  test.setTimeout(120_000)
  const documentId = await withE2eDatabase(async db => {
    await db.query(`insert into weld_joints (project_title,subtitle_code,line,joint,weld_date,wdi)
      select $1,'LARGE','LARGE','F'||n,case when n=1 then '2026-09-01'::date else '2026-09-02'::date end,1
      from generate_series(1,200000) n`, [project])
    const { rows: [record] } = await db.query(`insert into generated_documents
      (type,title,file_name,mime_type,row_count,period_from,period_to)
      values ('weldingJournal','SHARED-LARGE','large.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1,'2020-01-01','2020-01-01') returning id`)
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select $1,id from weld_joints where project_title=$2`, [record.id, project])
    return record.id as number
  })
  const start = performance.now()
  const metadata = await loadRemoteGeneratedDocument(documentId)
  expect(metadata).toMatchObject({ rowCount: 200_000, periodFrom: '2026-09-01', periodTo: '2026-09-02',
    wdiTotal: 200_000, lines: ['LARGE'], projects: [project] })
  const bytes = Buffer.byteLength(JSON.stringify(metadata))
  expect(bytes).toBeLessThan(2_500)
  console.log(JSON.stringify({ workflow: 'single-document-live-metadata', welds: 200_000,
    elapsedMs: Math.round(performance.now() - start), bytes }))
})

test('повторное формирование, выделение части и обратное объединение ЖСР сохраняют точный состав', async ({ page }) => {
  const { ids, manualIds } = await seed()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/documents')
  await page.getByRole('button', { name: 'SHARED-weldingJournal', exact: true }).locator('..')
    .getByRole('button', { name: 'Повторить с параметрами', exact: true }).click()
  await expect(page.getByText('показаны первые 2 из 2', { exact: true })).toBeVisible()
  await page.getByLabel('Название документа').fill('SHARED-REBUILT')
  await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
  await expect.poll(() => loadRemoteGeneratedDocument(manualIds[0])).toMatchObject({ title: 'SHARED-REBUILT', rowCount: 2 })
  const readAssignments = () => withE2eDatabase(async db => (await db.query(`select d.id,d.title,array_agg(a.weld_joint_id order by a.weld_joint_id) as ids
    from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
    where d.type='weldingJournal' and a.weld_joint_id=any($1::int[]) group by d.id order by d.id`, [ids])).rows)
  expect(await readAssignments()).toEqual([{ id: manualIds[0], title: 'SHARED-REBUILT', ids }])

  await page.getByLabel('Период с', { exact: true }).fill('2026-09-02')
  await expect(page.getByText('показаны первые 1 из 1', { exact: true })).toBeVisible()
  await page.getByLabel('Название документа').fill('SHARED-PART')
  await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
  await expect.poll(readAssignments).toEqual([
    { id: manualIds[0], title: 'SHARED-REBUILT', ids: [ids[0]] },
    { id: expect.any(Number), title: 'SHARED-PART', ids: [ids[1]] },
  ])
  expect(await loadRemoteGeneratedDocument(manualIds[0])).toMatchObject({ rowCount: 1, periodFrom: '2026-09-01', periodTo: '2026-09-01' })

  await page.getByLabel('Период с', { exact: true }).fill('2026-09-01')
  await expect(page.getByText('показаны первые 2 из 2', { exact: true })).toBeVisible()
  await page.getByLabel('Название документа').fill('SHARED-MERGED')
  await page.getByRole('button', { name: 'Сформировать', exact: true }).click()
  await expect.poll(readAssignments).toEqual([{ id: expect.any(Number), title: 'SHARED-MERGED', ids }])
  expect(await loadRemoteGeneratedDocument(manualIds[0])).toBeNull()
  for (const id of manualIds.slice(1)) expect(await loadRemoteGeneratedDocument(id)).toMatchObject({ rowCount: 2 })
  expect(errors).toEqual([])
})
