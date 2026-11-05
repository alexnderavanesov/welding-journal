import { editJournalJoint } from '../journal-grid'
import { filterPstoExceptions } from './psto-exception-helpers'
import { expect, test, type Page } from '@playwright/test'
import type { Client } from 'pg'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import type { PstoLineRemovalPreview } from '../../src/lib/psto-line-assignment'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import { linePrograms, weldJoints } from '../../src/db/schema'
import { loadLineProgramOverviews, loadLineProgramRows, toLineProgramRecord } from '../../src/server/line-program'
import { calculateLineProgram } from '../../src/lib/line-program-calculation'
import { getProgramRemovalHints } from '../../src/lib/line-program-excess'
import { getProgramAssignmentError } from '../../src/lib/line-program-assignment-validation'
import { getControlAssignmentRemovalHistory } from '../../src/lib/control-assignment-history'
import { hasPstoDocumentHistory, hasPstoExecutionHistory } from '../../src/lib/psto-cycle'
import { canAddPstoWorkflowResult } from '../../src/lib/psto-status'
import { getPstoTvmtWorkflowState } from '../../src/lib/tvmt-cycle'
import { attachHeatTreatmentControlRelations } from '../../src/server/heat-treatment-control-relations'
import { buildPstoDocumentHistoryWhere, buildPstoExecutionHistoryWhere } from '../../src/server/pre-heat-treatment-policy'
import { buildPstoWorkflowRowsWhere } from '../../src/server/psto-workflow-context'

const PROJECT = 'E2E T10 T22 control history', SUBTITLE = 'CONTROL'
let observed = ''
const identity = (line: string) => ({ projectTitle: PROJECT, subtitleCode: SUBTITLE, line })
async function call<T = unknown>(page: Page, name: string, data: unknown): Promise<T> {
  const response = await page.request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
    data: await serializeRpcData(data),
    headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
  if (payload.error) throw payload.error
  expect(response.ok()).toBe(true)
  return payload.result
}
async function open(page: Page) {
  observed = ''
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('getLineProgramSection_')) observed = request.url() })
  await page.goto('/percentage-lines')
  await expect.poll(() => observed).not.toBe('')
  // Cross-module RPCs below resolve through the generated production manifest.
  // Dev siblingRpcUrl deliberately only resolves exports of the observed module.
  expect(decodeURIComponent(new URL(observed).pathname.split('/_serverFn/')[1]), 'Run this suite against the isolated local production build').toMatch(/^[a-f0-9]{64}$/)
}
async function seed(line: string, count: number, psto = false) {
  return withLineProgramFixture(async db => {
    const { rows: [program] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      values($1,$2,$3,'II','A',10,10,$4) returning id`, [PROJECT, SUBTITLE, line, psto ? 'assigned' : 'unassigned'])
    const { rows } = await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,category,group_name,weld_control_percent,pvk_control_percent,has_vik,has_rk,has_uzk,psto_required,officiality,revision_actuality)
      select $1,$2,$3,$4,'F'||n,'С17','II','A',10,10,'да','да','да',$6,'действующий','актуальная' from generate_series(1,$5::int) n returning id,joint`,
    [program.id, PROJECT, SUBTITLE, line, count, psto ? 'да' : null])
    return rows.sort((a, b) => a.id - b.id) as Array<{ id: number; joint: string }>
  })
}
const versions = (ids: number[]) => withE2eDatabase(async db => (await db.query('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows as Array<{ id: number; version: string }>)
const stored = (line: string) => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 and line=$2 order by id', [PROJECT, line])).rows)
async function addDocument(db: Client, name: string, ids: number[], type = 'system:lnkRequest', metadata?: unknown) {
  const { rows: [doc] } = await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,period_from,period_to,source_metadata)
    values($1,$2,'control.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',$3,'2026-10-01','2026-10-01',$4) returning id`,
  [type, name, new Set(ids).size, metadata ? JSON.stringify(metadata) : null])
  await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [doc.id, [...new Set(ids)]])
  return doc.id as number
}
const documentState = (id: number) => withE2eDatabase(async db => (await db.query(`select d.id,d.title,d.source_metadata,d.row_count,
  coalesce(array_agg(a.weld_joint_id order by a.weld_joint_id) filter(where a.weld_joint_id is not null),'{}') as members
  from generated_documents d left join generated_document_weld_joints a on a.document_id=d.id where d.id=$1 group by d.id`, [id])).rows[0])

test.afterEach(() => cleanupLineProgramProjects([PROJECT]))

test('неполные факты основного и предварительного НК защищены в подробном чтении и краткой сводке программы', async () => {
  const line = 'PARTIAL-TRACE', rows = await seed(line, 9, true)
  const cases = [
    { method: 'РК', assignment: 'has_rk', field: 'lnk_defect_description', value: 'RK main trace' },
    { method: 'УЗК', assignment: 'has_uzk', field: 'uzk_defect_description', value: 'UZK main trace' },
    { method: 'ПВК', assignment: 'has_pvk', field: 'pvk_defect_description', value: 'PVK main trace' },
    { method: 'РК', assignment: 'has_rk', field: 'rk_exposure_confirmed_diameter', value: 108 },
    { method: 'РК', assignment: 'has_rk', field: 'defect_description', value: 'RK pre trace', pre: true },
    { method: 'УЗК', assignment: 'has_uzk', field: 'defect_description', value: 'UZK pre trace', pre: true },
    { method: 'ПВК', assignment: 'has_pvk', field: 'defect_description', value: 'PVK pre trace', pre: true },
    { method: 'РК', assignment: 'has_rk', field: 'rk_exposure_confirmed_diameter', value: 108, pre: true },
  ] as const
  await withLineProgramFixture(async db => {
    await db.query('update line_programs set weld_control_percent=0,pvk_control_percent=0 where project_title=$1 and line=$2', [PROJECT, line])
    await db.query("update weld_joints set weld_date='2026-10-01',stamp_1_k='T22-TRACE',has_rk=null,has_uzk=null,has_pvk=null where project_title=$1 and line=$2", [PROJECT, line])
    for (const [index, trace] of cases.entries()) {
      await db.query(`update weld_joints set ${trace.assignment}='да' where id=$1`, [rows[index].id])
      if ('pre' in trace) await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,${trace.field}) values($1,$2,$3)`, [rows[index].id, trace.method, trace.value])
      else await db.query(`update weld_joints set ${trace.field}=$2 where id=$1`, [rows[index].id, trace.value])
    }
    // VIK history must be read too, but cannot protect the unrelated RK request.
    await db.query(`update weld_joints set has_rk='да',rk_request='T22-WAIT',rk_request_date='2026-10-02',rk_result='ожидает НК',
      vik_defect_description='VIK trace',vik_conclusion='VIK-C',vik_conclusion_date='2026-10-03',vik_request_date='2026-10-02' where id=$1`, [rows[8].id])
  })
  await withE2eDatabase(async client => {
    const db = drizzle(client)
    const [program] = await db.select().from(linePrograms).where(eq(linePrograms.id, (await stored(line))[0].line_program_id))
    const loaded = await loadLineProgramRows(db, identity(line))
    expect(loaded).toHaveLength(9)
    for (const [index, trace] of cases.entries()) {
      const row = loaded.find(row => row.id === rows[index].id)!
      expect(getProgramAssignmentError(row, { [trace.method]: '' }, true)).toContain('нельзя снять')
      expect(getControlAssignmentRemovalHistory(row, trace.assignment === 'has_rk' ? 'hasRk' : trace.assignment === 'has_uzk' ? 'hasUzk' : 'hasPvk')).toContain('pre' in trace ? 'НК до ТО' : 'основной этап')
    }
    const waiting = loaded.find(row => row.id === rows[8].id)!
    expect(waiting).toMatchObject({ vikDefectDescription: 'VIK trace', vikConclusion: 'VIK-C', vikConclusionDate: '2026-10-03', vikRequestDate: '2026-10-02' })
    expect(getProgramAssignmentError(waiting, { РК: '' }, true)).toBe('')
    const hints = getProgramRemovalHints(program.id, loaded, calculateLineProgram(loaded, 0, 0), new Set())
    expect([...hints].map(([id, methods]) => [id, [...methods.keys()]])).toEqual([[rows[8].id, ['РК']]])
    const [summary] = await loadLineProgramOverviews(db, [toLineProgramRecord(program)])
    expect(summary.overview.reducible).toBe(1)
    expect(summary.overview.common?.required).toBe(0)
    expect(summary.overview.pvk?.required).toBe(0)
  })
})

test('основной НК: снимается только выбранный метод; соседние факты сохраняются, последняя заявка удаляется', async ({ page }) => {
  const line = 'MAIN', rows = await seed(line, 3), [one, two, three] = rows
  const docs = await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set rk_request='T22-A1',rk_request_date='2026-10-01',rk_result='ожидает НК' where id=any($1::int[])`, [[one.id, two.id]])
    await db.query(`update weld_joints set uzk_request='T22-A1',uzk_request_date='2026-10-01',uzk_result='годен',uzk_conclusion='T22-C1',uzk_conclusion_date='2026-10-02' where id=$1`, [one.id])
    await db.query(`update weld_joints set rk_result='ремонт',rk_conclusion='T22-C2',rk_conclusion_date='2026-10-02' where id=$1`, [two.id])
    await db.query(`update weld_joints set rk_request='T22-LAST',rk_request_date='2026-10-01',rk_result='ожидает НК' where id=$1`, [three.id])
    return { shared: await addDocument(db, 'T22-A1', [one.id, two.id]), last: await addDocument(db, 'T22-LAST', [three.id]) }
  })
  await open(page)
  await call(page, 'updateWeldJoint', { id: one.id, hasRk: null, expectedVersion: (await versions([one.id]))[0].version, mutationScope: 'welding' })
  expect((await stored(line))[0]).toMatchObject({ has_rk: null, rk_request: null, rk_request_date: null, uzk_request: 'T22-A1', uzk_result: 'годен', uzk_conclusion: 'T22-C1' })
  expect(await documentState(docs.shared)).toMatchObject({ id: docs.shared, title: 'T22-A1', row_count: 2, members: [one.id, two.id] })
  // Mass-fill still only fills empty fields; assignment removal uses replacement.
  await expect(call(page, 'massFillWeldJoints', { records: [{ id: three.id, hasRk: null }], expectedVersions: await versions([three.id]) })).rejects.toThrow(/Массовое заполнение не очищает/)
  expect(await documentState(docs.last)).toMatchObject({ id: docs.last, members: [three.id] })
  await call(page, 'replaceWeldJoints', { records: [{ id: three.id, hasRk: null }], deleteIds: [], expectedVersions: await versions([three.id]) })
  expect(await documentState(docs.last)).toBeUndefined()
  const before = await stored(line)
  await expect(call(page, 'updateWeldJoint', { id: two.id, hasRk: 'отменен', expectedVersion: (await versions([two.id]))[0].version, mutationScope: 'welding' })).rejects.toThrow(/нельзя отменить/)
  expect(await stored(line)).toEqual(before)
})

test('НК до ТО: общий документ сохраняет другой метод того же стыка; stale batch откатывается целиком', async ({ page }) => {
  const line = 'PRE', rows = await seed(line, 2, true), [one, two] = rows
  const docId = await withLineProgramFixture(async db => {
    const { rows: controls } = await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,result,conclusion_name,conclusion_date)
      values($1,'РК','T22-PRE','2026-10-01',null,null,null),($1,'УЗК','T22-PRE','2026-10-01','годен','T22-C','2026-10-02'),($2,'РК','T22-PRE','2026-10-01',null,null,null) returning id,weld_joint_id,method`, [one.id, two.id])
    return addDocument(db, 'T22-PRE', [one.id, two.id], 'system:lnkRequest', { sourceKind: 'beforeHeatTreatment', sourcePositions: controls.map(row => ({ kind: 'beforeHeatTreatment', relationId: row.id, weldJointId: row.weld_joint_id, methodCode: row.method })) })
  })
  await open(page)
  const expectedVersions = await versions(rows.map(row => row.id))
  await withLineProgramFixture(async db => { await db.query("update weld_joints set responsible='Concurrent correction' where id=$1", [two.id]) })
  await expect(call(page, 'replaceWeldJoints', { records: rows.map(row => ({ id: row.id, hasRk: null })), deleteIds: [], expectedVersions })).rejects.toThrow(/измен|устар|верс/)
  expect((await stored(line)).every(row => row.has_rk === 'да')).toBe(true)
  expect(JSON.parse((await documentState(docId)).source_metadata).sourcePositions).toHaveLength(3)
  const currentVersions = await versions([one.id])
  const removal = await call<{ token: string; removals: { positions: string[]; remaining: number }[] }>(page, 'previewControlRequestRemoval', {
    records: [{ id: one.id, hasRk: null }], expectedVersions: currentVersions,
  })
  expect(removal.removals).toEqual([expect.objectContaining({ positions: ['F1 · РК · до ТО'], remaining: 2 })])
  await call(page, 'updateWeldJoint', { id: one.id, hasRk: null, expectedVersion: currentVersions[0].version, controlRequestRemovalToken: removal.token, mutationScope: 'welding' })
  const doc = await documentState(docId)
  expect(doc.members).toEqual([one.id, two.id])
  expect(JSON.parse(doc.source_metadata).sourcePositions).toEqual(expect.arrayContaining([expect.objectContaining({ weldJointId: one.id, methodCode: 'УЗК' }), expect.objectContaining({ weldJointId: two.id, methodCode: 'РК' })]))
  expect(JSON.parse(doc.source_metadata).sourcePositions).toHaveLength(2)
})

test('ПСТО request-only: снятие линии очищает основной, предварительный и повторный состав заявок', async ({ page }) => {
  const line = 'REMOVE-PSTO', [row] = await seed(line, 1, true)
  const docs = await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set psto_request='T22-P1',psto_request_date='2026-10-01',tvmt_request='T22-T1',tvmt_request_date='2026-10-01' where id=$1`, [row.id])
    const { rows: [cycle] } = await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,tvmt_request,tvmt_request_date)
      values($1,2,'T22-P2','2026-10-01','T22-T2','2026-10-01') returning id`, [row.id])
    const { rows: [pre] } = await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date) values($1,'РК','T22-PRE','2026-10-01') returning id`, [row.id])
    const ids = []
    for (const [name, type, relationId, sequence, methodCode] of [['T22-P1','system:pstoRequest',row.id,1,undefined], ['T22-T1','system:lnkRequest',row.id,1,'ТВМТ'], ['T22-P2','system:pstoRequest',cycle.id,2,undefined], ['T22-T2','system:lnkRequest',cycle.id,2,'ТВМТ']] as const) {
      ids.push(await addDocument(db, name, [row.id], type, { sourceKind: 'pstoCycle', sourcePositions: [{ kind: 'pstoCycle', weldJointId: row.id, relationId, sequence, ...(methodCode ? { methodCode } : {}) }] }))
    }
    ids.push(await addDocument(db, 'T22-PRE', [row.id], 'system:lnkRequest', { sourceKind: 'beforeHeatTreatment', sourcePositions: [{ kind: 'beforeHeatTreatment', weldJointId: row.id, relationId: pre.id, methodCode: 'РК' }] }))
    return ids
  })
  await open(page)
  const preview = await call<PstoLineRemovalPreview>(page, 'getPstoLineRemovalPreview', identity(line))
  expect(preview.removalProtectedRowCount).toBe(0)
  await call(page, 'savePstoLineAssignment', { identity: identity(line), action: 'remove', expectedVersions: preview.expectedVersions })
  expect((await stored(line))[0]).toMatchObject({ psto_required: null, psto_request: null, psto_request_date: null, tvmt_request: null, tvmt_request_date: null })
  for (const id of docs) expect(await documentState(id)).toBeUndefined()
  await withE2eDatabase(async db => {
    expect((await db.query('select request_name,request_date from pre_heat_treatment_controls where weld_joint_id=$1', [row.id])).rows.every(item => !item.request_name && !item.request_date)).toBe(true)
    expect((await db.query('select psto_request,tvmt_request from psto_repeat_cycles where weld_joint_id=$1', [row.id])).rows.every(item => !item.psto_request && !item.tvmt_request)).toBe(true)
  })
})

for (const stage of ['primary', 'repeat'] as const) test(`ПСТО ${stage}: отмена сохраняет старые заявки без выполнения; SQL не предлагает результат отсутствующей работы`, async ({ page }) => {
  const line = `CANCEL-REQUEST-ONLY-${stage}`, [row] = await seed(line, 1, true)
  const documents = await withLineProgramFixture(async db => {
    // A supported partial historical record. We do not create a new TVMT
    // request before completed PSTO or fabricate a completed/cancelled result.
    await db.query("update weld_joints set weld_date='2026-09-30' where id=$1", [row.id])
    let relationId = row.id
    const sequence = stage === 'primary' ? 1 : 2
    if (stage === 'primary') {
      await db.query(`update weld_joints set psto_request='T22-OLD-P',psto_request_date='2026-10-01',
        tvmt_request='T22-OLD-T',tvmt_request_date='2026-10-01' where id=$1`, [row.id])
    } else {
      relationId = (await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,tvmt_request,tvmt_request_date)
        values($1,2,'T22-OLD-P','2026-10-01','T22-OLD-T','2026-10-01') returning id`, [row.id])).rows[0].id
    }
    const position = { kind: 'pstoCycle', weldJointId: row.id, relationId, sequence }
    return [
      await addDocument(db, 'T22-OLD-P', [row.id], 'system:pstoRequest', { sourceKind: 'pstoCycle', sourcePositions: [position] }),
      await addDocument(db, 'T22-OLD-T', [row.id], 'system:lnkRequest', { sourceKind: 'pstoCycle', sourcePositions: [{ ...position, methodCode: 'ТВМТ' }] }),
    ]
  })
  const beforeDocuments = await Promise.all(documents.map(documentState))
  await open(page)
  const preview = await call<PstoLineRemovalPreview>(page, 'getPstoLineRemovalPreview', identity(line))
  expect(preview.retainedAssignmentCount).toBe(0)
  await call(page, 'savePstoLineAssignment', { identity: identity(line), action: 'cancel', cancellationDate: '2026-10-02',
    cancellationBasis: 'Решение отменить будущую работу', expectedVersions: preview.expectedVersions })
  expect((await stored(line))[0].psto_required).toBe('отменен')
  expect(await Promise.all(documents.map(documentState))).toEqual(beforeDocuments)
  await withE2eDatabase(async client => {
    const db = drizzle(client)
    const [storedRow] = await db.select().from(weldJoints).where(eq(weldJoints.id, row.id))
    const [hydrated] = await attachHeatTreatmentControlRelations([storedRow], db)
    expect(hasPstoExecutionHistory(hydrated)).toBe(false)
    expect(hasPstoDocumentHistory(hydrated)).toBe(true)
    expect(getPstoTvmtWorkflowState(hydrated)).toBe('not-required')
    expect(canAddPstoWorkflowResult(hydrated)).toBe(false)
    // Use product SQL directly against PostgreSQL. Comparing two SQL-derived
    // APIs would miss the same mistaken assumption shared by both predicates.
    const { rows: [actual] } = await db.execute<{ performed: boolean; history: boolean; resultCandidate: boolean; historyCandidate: boolean }>(sql`
      select ${buildPstoExecutionHistoryWhere()} as performed,
        ${buildPstoDocumentHistoryWhere()} as history,
        ${buildPstoWorkflowRowsWhere({ scope: 'resultCandidates' })} as "resultCandidate",
        ${buildPstoWorkflowRowsWhere({ scope: 'resultRegistry' })} as "historyCandidate"
      from ${weldJoints} where ${weldJoints.id} = ${row.id}`)
    expect(actual).toEqual({ performed: false, history: true, resultCandidate: false, historyCandidate: true })
  })
})

for (const performed of [0, 3, 10]) test(`ПСТО: ${performed} выполненных из 10 сохраняются; отменяется только будущая работа`, async ({ page }) => {
  const line = `PARTIAL-${performed}`, rows = await seed(line, 10, true)
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set weld_date='2026-09-30',psto_request='T22-PARTIAL',psto_request_date='2026-10-01' where id=any($1::int[])", [rows.map(row => row.id)])
    if (performed) await db.query(`update weld_joints set psto_result='проведено',psto_date='2026-10-02',heat_treatment_diagram='T22-DIAGRAM' where id=any($1::int[])`, [rows.slice(0, performed).map(row => row.id)])
    if (performed) await db.query(`update weld_joints set tvmt_request='T22-TVMT',tvmt_request_date='2026-10-02',tvmt_result='не годен',tvmt_conclusion='T22-TC',tvmt_conclusion_date='2026-10-03' where id=$1`, [rows[0].id])
  })
  await open(page)
  const preview = await call<PstoLineRemovalPreview>(page, 'getPstoLineRemovalPreview', identity(line))
  expect(preview).toMatchObject({ retainedAssignmentCount: performed, cancellationRowCount: 10 - performed })
  expect(preview.rows.filter(row => row.cancellationDisposition === 'preserve')).toHaveLength(performed)
  const beforeCancellation = await stored(line)
  await expect(call(page, 'savePstoLineAssignment', { identity: identity(line), action: 'cancel', cancellationDate: '2026-10-04', cancellationBasis: '  ', expectedVersions: preview.expectedVersions })).rejects.toThrow('основание')
  expect(await stored(line)).toEqual(beforeCancellation)
  await call(page, 'savePstoLineAssignment', { identity: identity(line), action: 'cancel', cancellationDate: '2026-10-04', cancellationBasis: 'ТР-ПСТО-1', expectedVersions: preview.expectedVersions })
  const current = await stored(line)
  expect(current.filter(row => row.psto_required === 'да')).toHaveLength(performed)
  expect(current.filter(row => row.psto_required === 'отменен')).toHaveLength(10 - performed)
  expect(current.slice(0, performed).every(row => row.psto_result === 'проведено' && row.heat_treatment_diagram === 'T22-DIAGRAM' && !row.psto_cancellation_date)).toBe(true)
  const newRow = await call<{ pstoRequired: string; pstoControlBasis: string }>(page, 'createWeldJoint', { ...identity(line), joint: 'F11', connectionType: 'С17', mutationScope: 'welding' })
  expect(newRow).toMatchObject({ pstoRequired: 'отменен', pstoControlBasis: 'ТР-ПСТО-1' })
  if (performed) {
    await call(page, 'savePstoRepeatWorkflow', { action: 'pstoRequest', date: '2026-10-05', groups: [{ rowIds: [rows[0].id], name: 'T22-REPEAT' }], expectedVersions: await versions([rows[0].id]) })
    expect(await withE2eDatabase(async db => (await db.query('select sequence,psto_request from psto_repeat_cycles where weld_joint_id=$1', [rows[0].id])).rows)).toEqual([expect.objectContaining({ sequence: 2, psto_request: 'T22-REPEAT' })])
  }
})

test('конфликт результата между просмотром и отменой ПСТО не отменяет ни одной записи', async ({ page }) => {
  const line = 'STALE-PSTO', rows = await seed(line, 2, true)
  await open(page)
  const preview = await call<PstoLineRemovalPreview>(page, 'getPstoLineRemovalPreview', identity(line))
  await withLineProgramFixture(async db => { await db.query(`update weld_joints set psto_request='T22-NEW',psto_request_date='2026-10-01',psto_result='проведено',psto_date='2026-10-02',heat_treatment_diagram='T22-D' where id=$1`, [rows[0].id]) })
  const before = await stored(line)
  await expect(call(page, 'savePstoLineAssignment', { identity: identity(line), action: 'cancel', cancellationDate: '2026-10-04', cancellationBasis: 'ТР-ПСТО-1', expectedVersions: preview.expectedVersions })).rejects.toThrow(/измен|устар|верс/)
  expect(await stored(line)).toEqual(before)
})

test('снятие назначения: предпросмотр считает позиции методов, подтверждённое массовое снятие удаляет пустую заявку', async ({ page }) => {
  const line = 'REMOVAL-PREVIEW', rows = await seed(line, 2), ids = rows.map(row => row.id)
  const doc = await withLineProgramFixture(async db => {
    await db.query("update weld_joints set rk_request='REQ-155',rk_request_date='2026-10-01' where id=any($1::int[])", [ids])
    await db.query("update weld_joints set uzk_request='REQ-155',uzk_request_date='2026-10-01' where id=$1", [ids[0]])
    return addDocument(db, 'REQ-155', ids)
  })
  await open(page)
  const before = await stored(line)
  const one = await call<{ token: string; removals: { title: string; positions: string[]; remaining: number }[] }>(page, 'previewControlRequestRemoval', {
    records: [{ id: ids[0], hasRk: null }], expectedVersions: await versions([ids[0]]),
  })
  expect(one.removals).toEqual([{ documentId: doc, title: 'REQ-155', date: '2026-10-01', positions: ['F1 · РК'], remaining: 2 }])
  expect(await stored(line)).toEqual(before) // A dismissed preview performs no write.
  const records = [{ id: ids[0], hasRk: null, hasUzk: null }, { id: ids[1], hasRk: null }]
  const expectedVersions = await versions(ids)
  const all = await call<typeof one>(page, 'previewControlRequestRemoval', { records, expectedVersions })
  expect(all.removals[0].remaining).toBe(0)
  expect(all.removals[0].positions).toHaveLength(3)
  await call(page, 'updateWeldJoints', { records, expectedVersions, controlRequestRemovalToken: all.token })
  expect(await documentState(doc)).toBeUndefined()
})

test('изменение общей заявки другим пользователем требует нового подтверждения, откат сохраняет стык', async ({ page }) => {
  const line = 'REMOVAL-STALE', rows = await seed(line, 2), ids = rows.map(row => row.id)
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set rk_request='REQ-156',rk_request_date='2026-10-01' where id=any($1::int[])", [ids])
    await addDocument(db, 'REQ-156', ids)
  })
  await open(page)
  const expectedVersions = await versions([ids[0]])
  const data = { records: [{ id: ids[0], hasRk: null }], expectedVersions }
  const preview = await call<{ token: string; removals: { remaining: number }[] }>(page, 'previewControlRequestRemoval', data)
  expect(preview.removals[0].remaining).toBe(1)
  await call(page, 'updateWeldJoint', { id: ids[1], hasRk: null, expectedVersion: (await versions([ids[1]]))[0].version })
  await expect(call(page, 'updateWeldJoint', { ...data.records[0], expectedVersion: expectedVersions[0].version, controlRequestRemovalToken: preview.token })).rejects.toThrow('Состав заявок изменился')
  expect((await stored(line))[0].rk_request).toBe('REQ-156')
  const fresh = await call<typeof preview>(page, 'previewControlRequestRemoval', data)
  expect(fresh.removals[0].remaining).toBe(0)
  await call(page, 'updateWeldJoint', { ...data.records[0], expectedVersion: expectedVersions[0].version, controlRequestRemovalToken: fresh.token })
  expect((await stored(line))[0].rk_request).toBeNull()
})

test('основание: старые пустые записи сохраняются, новые Доп/Отменен требуют текст и не допускают его очистки', async ({ page }) => {
  const line = 'BASIS-LEGACY', rows = await seed(line, 2), ids = rows.map(row => row.id)
  await withLineProgramFixture(db => db.query("update weld_joints set has_rk='дополнительный',rk_control_basis=null where id=$1", [ids[0]]))
  await open(page)
  await call(page, 'updateWeldJoint', { id: ids[0], expectedVersion: (await versions([ids[0]]))[0].version, weldingJournalNote: 'Unrelated correction' })
  expect((await stored(line))[0].rk_control_basis).toBeNull()
  const expectedVersion = (await versions([ids[1]]))[0].version
  for (const hasRk of ['отменен', 'дополнительный']) await expect(call(page, 'updateWeldJoint', { id: ids[1], expectedVersion, hasRk, rkControlBasis: '  ' })).rejects.toThrow('Основание')
  await call(page, 'updateWeldJoint', { id: ids[1], expectedVersion, hasRk: 'дополнительный', rkControlBasis: 'ТР № 10' })
  await expect(call(page, 'updateWeldJoint', { id: ids[1], expectedVersion: (await versions([ids[1]]))[0].version, rkControlBasis: '' })).rejects.toThrow('Основание')
  expect((await stored(line))[1].rk_control_basis).toBe('ТР № 10')
})

test('карточка: снятие РК подтверждается один раз при сохранении, отмена сохраняет заявку и черновик', async ({ page }) => {
  const line = 'REMOVAL-CARD', [row] = await seed(line, 1)
  const doc = await withLineProgramFixture(async db => {
    await db.query("update weld_joints set rk_request='REQ-157',rk_request_date='2026-10-01' where id=$1", [row.id])
    return addDocument(db, 'REQ-157', [row.id])
  })
  await page.goto('/journal')
  await editJournalJoint(page, row.id)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await editor.getByRole('button', { name: 'Назначение контроля', exact: true }).click()
  const rk = editor.getByText('Назначение РК', { exact: true }).locator('..')
  await rk.getByRole('button', { name: 'Пусто', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Сохранить изменения назначений?', exact: true })
  await expect(confirmation).toHaveCount(0)
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(confirmation).toContainText('REQ-157')
  await expect(confirmation).toContainText('Заявка станет пустой и будет удалена')
  await confirmation.getByRole('button', { name: 'Вернуться к редактированию', exact: true }).click()
  expect((await documentState(doc)).members).toEqual([row.id])
  expect((await stored(line))[0].has_rk).toBe('да')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(await documentState(doc)).toBeUndefined()
  expect((await stored(line))[0].has_rk).toBeNull()
})

test('программа линий: общее основание для группы и одно подтверждение удаления общей заявки', async ({ page }) => {
  const line = 'BULK-BASIS', rows = await seed(line, 2), ids = rows.map(row => row.id)
  const doc = await withLineProgramFixture(async db => {
    await db.query("update weld_joints set rk_request='REQ-158',rk_request_date='2026-10-01' where id=any($1::int[])", [ids])
    return addDocument(db, 'REQ-158', ids)
  })
  await page.goto('/line-program')
  const program = page.getByTestId('line-program')
  await program.getByLabel('Поиск программы линий').fill(line)
  await program.getByRole('button', { name: `Открыть назначения линии ${line}`, exact: true }).click()
  const editor = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
  await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки', exact: true }).check()
  await editor.getByRole('button', { name: 'РК', exact: true }).click()
  await editor.getByRole('radio', { name: 'Дополнительный', exact: true }).click()
  const apply = editor.getByRole('button', { name: 'Применить к выбранным (2)', exact: true })
  await expect(apply).toBeDisabled()
  await editor.getByLabel('Основание для выбранных назначений').fill('  ')
  await expect(apply).toBeDisabled()
  await editor.getByLabel('Основание для выбранных назначений').fill('ТР № 158')
  await apply.click()
  const save = async () => {
    await editor.getByRole('button', { name: 'Проверить изменения', exact: true }).click()
    const agreement = editor.getByRole('checkbox', { name: /Подтверждаю назначение сверх нормы/ })
    if (await agreement.count()) await agreement.check()
    await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  }
  await save()
  await expect(editor.getByText('Назначения сохранены · стыков: 2', { exact: true })).toBeVisible()
  expect((await stored(line)).every(row => row.has_rk === 'дополнительный' && row.rk_control_basis === 'ТР № 158')).toBe(true)
  await editor.getByRole('checkbox', { name: 'Выбрать все доступные стыки', exact: true }).check()
  await editor.getByRole('radio', { name: 'Пусто', exact: true }).click()
  await apply.click()
  await save()
  const confirmation = page.getByRole('dialog', { name: 'Сохранить изменения назначений?', exact: true })
  await expect(confirmation).toContainText('REQ-158')
  for (const joint of ['F1', 'F2']) await expect(confirmation).toContainText(`${joint} · РК`)
  await expect(confirmation).toContainText('Заявка станет пустой и будет удалена')
  await confirmation.getByRole('button', { name: 'Вернуться', exact: true }).click()
  expect((await documentState(doc)).members).toEqual(ids)
  expect((await stored(line)).every(row => row.has_rk === 'дополнительный')).toBe(true)
  await editor.getByRole('button', { name: 'Сохранить назначения', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Подтвердить и сохранить', exact: true }).click()
  await expect(editor.getByText('Назначения сохранены · стыков: 2', { exact: true })).toBeVisible()
  expect(await documentState(doc)).toBeUndefined()
})

for (const storedPolicy of [true, false]) test(`ПСТО: старая отмена без основания наследуется новым стыком, явная политика ${storedPolicy}`, async ({ page }) => {
  const line = `LEGACY-PSTO-${storedPolicy}`, [original] = await seed(line, 1, true)
  await withLineProgramFixture(async db => {
    await db.query("update line_programs set psto_assignment=$3,psto_cancellation_date='2026-09-01',psto_cancellation_basis=null where project_title=$1 and line=$2", [PROJECT, line, storedPolicy ? 'cancelled' : null])
    await db.query("update weld_joints set psto_required='отменен',psto_cancellation_date='2026-09-01',psto_control_basis=null where id=$1", [original.id])
  })
  const before = (await stored(line))[0]
  await open(page)
  const created = await call<{ id: number; pstoRequired: string; pstoControlBasis: string | null }>(page, 'createWeldJoint', { ...identity(line), joint: 'F2', connectionType: 'С17', mutationScope: 'welding' })
  expect(created).toMatchObject({ pstoRequired: 'отменен', pstoControlBasis: null })
  expect((await stored(line)).find(row => row.id === original.id)).toEqual(before)
  await call(page, 'updateWeldJoint', { id: created.id, expectedVersion: (await versions([created.id]))[0].version, weldingJournalNote: 'Old policy remains' })
  expect((await stored(line)).find(row => row.id === created.id)).toMatchObject({ psto_required: 'отменен', psto_control_basis: null })
})

test('ПСТО: новая отмена требует основание в интерфейсе, отказ от диалога ничего не сохраняет', async ({ page }) => {
  const line = 'PSTO-BASIS-UI'
  await seed(line, 2, true)
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', line)
  // Opening the report calculates the fixture's initially empty final status;
  // compare the cancellation draft against the state before that action.
  const before = await stored(line)
  await page.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Отмена ПСТО', exact: true }) })
  const basis = dialog.getByLabel('Основание отмены ПСТО', { exact: true })
  const submit = dialog.getByRole('button', { name: 'Отменить ПСТО на линии', exact: true })
  await expect(submit).toBeDisabled()
  await basis.fill('  ')
  await expect(submit).toBeDisabled()
  await basis.fill('ТР-ПСТО-UI')
  await expect(submit).toBeEnabled()
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await stored(line)).toEqual(before)
  await page.getByRole('button', { name: 'Отменить ПСТО', exact: true }).click()
  await expect(basis).toHaveValue('')
  await expect(submit).toBeDisabled()
  await basis.fill('ТР-ПСТО-UI')
  await submit.click()
  await expect(dialog).toBeHidden()
  expect((await stored(line)).every(row => row.psto_required === 'отменен' && row.psto_control_basis === 'ТР-ПСТО-UI')).toBe(true)
  expect(await withE2eDatabase(async db => (await db.query('select psto_assignment,psto_cancellation_basis from line_programs where project_title=$1 and line=$2', [PROJECT, line])).rows[0]))
    .toEqual({ psto_assignment: 'cancelled', psto_cancellation_basis: 'ТР-ПСТО-UI' })
})
