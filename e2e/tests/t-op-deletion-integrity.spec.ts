import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import type { WeldRow } from '@/lib/dispatcher-types'
import { calculateLineProgram } from '@/lib/line-program-calculation'
import { getDispatcherTaskIndexSnapshot } from '@/server/dispatcher-task-index'
import { readJournalGrid as rawReadJournalGrid } from '@/server/journal-grid'
import { attachProgramChainStates } from '@/server/line-program-chain-state'
import { applyLnkOfficialityChange as rawApplyOfficiality, previewLnkOfficialityChange as rawPreviewOfficiality } from '@/server/lnk-officiality-workflow'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-document-index'
import { createWeldJoints as rawCreateRepeated, deleteWeldJoint as rawDelete, deleteWeldJoints as rawDeleteMany, updateWeldJoint as rawUpdate } from '@/server/weld-mutations'
import { replaceWeldJoints as rawReplace } from '@/server/weld-import'
import { asE2eOwner } from '../with-owner-access'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'

const PROJECT = 'E2E T21 deletion integrity', LINE = 'T21-CHAIN'
type Target = { id: number; version: string }
type Mode = 'single' | 'bulk' | 'import'
const remove = asE2eOwner(rawDelete, 'welding.delete')
const removeMany = asE2eOwner(rawDeleteMany, 'welding.delete')
const replace = asE2eOwner(rawReplace, 'welding.import')
const createRepeated = asE2eOwner(rawCreateRepeated, 'welding.edit')
const updateAssignment = asE2eOwner(rawUpdate, 'welding.edit')
const updateResult = asE2eOwner(rawUpdate, 'lnk.edit')
const previewOfficiality = asE2eOwner(rawPreviewOfficiality, 'lnk.edit')
const applyOfficiality = asE2eOwner(rawApplyOfficiality, 'lnk.edit')
const readJournal = asE2eOwner(rawReadJournalGrid, 'welding.view')

test.afterEach(() => cleanupLineProgramProjects([PROJECT]))

const version = (ids: number[]) => withE2eDatabase(async db => (await db.query<Target>('select id,xmin::text as version from weld_joints where id=any($1::int[]) order by id', [ids])).rows)
const facts = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 order by id', [PROJECT])).rows)
const documents = () => withE2eDatabase(async db => (await db.query(`select d.id,d.type,d.title,d.row_count,d.source_metadata,
  array_agg(a.weld_joint_id order by a.weld_joint_id) as members
  from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
  where d.title like 'T21-%' group by d.id order by d.id`)).rows)

async function readCalculation() {
  const db = requireDb()
  const rows = await db.select().from(weldJoints).where(eq(weldJoints.projectTitle, PROJECT))
  await attachProgramChainStates(rows, db)
  return calculateLineProgram(rows as unknown as WeldRow[], 100, 100, undefined, new Set(), true)
}
async function syncDocuments() {
  await requireDb().transaction(async tx => {
    const rows = await tx.select().from(weldJoints).where(eq(weldJoints.projectTitle, PROJECT))
    await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
  })
}
async function seed(depth = 12) {
  const rows = await withLineProgramFixture(async db => {
    const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,support_uzk_control_percent,support_pvk_control_percent)
      values($1,'T21',$2,'II','A',10,10,100,100) returning id`, [PROJECT, LINE])
    const names = ['ОП-1', ...Array.from({ length: depth }, (_, n) => `ОП-1R${n + 1}`), 'ОП-2']
    return (await db.query<{ id: number; joint: string }>(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,t1,t2,weld_length,weld_date,material_group,welding_method,stamp_1_k,has_vik,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,has_uzk,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,officiality,revision_actuality)
      select $1,$2,'T21',$3,name,'Т1',6,8,123.456789123,'2026-09-01','М01','РД',case when name like '%R%' then 'T21-B' else 'T21-A' end,
      'да',case when name='ОП-2' then 'годен' else 'ремонт' end,'T21-VIK-R','2026-09-02','T21-VIK-C','2026-09-03',
      'да',case when name='ОП-1' then 'годен' else null end,'T21-UZK-R','2026-09-02',case when name='ОП-1' then 'T21-UZK-C' else null end,case when name='ОП-1' then '2026-09-03'::date else null end,'действующий','актуальная'
      from unnest($4::text[]) as names(name) returning id,joint`, [line.id, PROJECT, LINE, names])).rows
  })
  await syncDocuments()
  return rows
}
async function deleteUsing(mode: Mode, targets: Target[]) {
  if (mode === 'single') {
    expect(targets).toHaveLength(1)
    return remove({ data: targets[0] })
  }
  if (mode === 'bulk') return removeMany({ data: { targets } })
  return replace({ data: { records: [], deleteIds: targets.map(row => row.id), expectedVersions: targets } })
}
async function expectContinuation(target: string | null, sourceId?: number) {
  const snapshot = await getDispatcherTaskIndexSnapshot({ ensureFresh: true })
  expect(snapshot.isFresh).toBe(true)
  const tasks = snapshot.repeatedJointTasks.filter(task => task.row.projectTitle === PROJECT)
  const creates = tasks.filter(task => task.kind === 'create')
  expect(creates).toEqual(target ? [expect.objectContaining({ kind: 'create', targetJoint: target, row: expect.objectContaining({ id: sourceId }) })] : [])
  expect(tasks.filter(task => ['coil', 'rename', 'delete', 'duplicate-check'].includes(task.kind))).toEqual([])
  expect(tasks.filter(task => task.kind === 'check' && ['СП-07', 'СП-09', 'СП-13'].includes(task.systemWarningCode ?? ''))).toEqual([])
  const persisted = await withE2eDatabase(async db => (await db.query(`select t.weld_joint_id,t.code from dispatcher_row_tasks t
    join weld_joints w on w.id=t.weld_joint_id where w.project_title=$1 and t.code in ('СП-07','СП-09','СП-13') order by t.weld_joint_id,t.code`, [PROJECT])).rows)
  expect(persisted).toEqual(target ? [{ weld_joint_id: sourceId, code: 'СП-09' }] : [])
  const journal = await readJournal({ columnFilters: { search: PROJECT }, groupBy: [], route: [], start: 0, end: 100 })
  for (const row of journal.rows) {
    expect(row.dispatcherTasks ?? '').not.toMatch(/СП-07|СП-13/)
    expect(String(row.dispatcherTasks ?? '').includes('СП-09')).toBe(Boolean(target && row.id === sourceId))
  }
}

for (const mode of ['single', 'bulk', 'import'] as const) test(`${mode}: Т после R12 — удаление хвоста, новый R13, документы и физическая норма`, async () => {
  const rows = await seed(), root = rows[0], last = rows.at(-2)!, other = rows.at(-1)!
  const initialCalculation = await readCalculation()
  expect(initialCalculation).toHaveLength(1)
  expect(initialCalculation[0]).toMatchObject({ stamp: 'T21-A', rowIds: [root.id, other.id], common: { required: 2, coveredRowIds: [root.id, other.id], completedRowIds: [root.id] }, pvk: { required: 2, missing: 2 } })
  await expectContinuation('ОП-1R13', last.id)
  const beforeBlocked = await facts(), documentsBeforeBlocked = await documents()
  const blockedIds = mode === 'single' ? [root.id] : [root.id, other.id]
  await expect(deleteUsing(mode, await version(blockedIds))).rejects.toThrow(/Нельзя удалить предшественника/)
  expect(await facts()).toEqual(beforeBlocked)
  expect(await documents()).toEqual(documentsBeforeBlocked)
  const [future] = await createRepeated({ data: { source: (await version([last.id]))[0], targetJoints: ['ОП-1R13'] } })
  expect(future).toMatchObject({ joint: 'ОП-1R13', weldLength: '123.456789123', vikConclusion: null, uzkConclusion: null })
  expect((await readCalculation())[0].common).toMatchObject({ required: 2, completedRowIds: [root.id] })
  await expectContinuation(null)
  await deleteUsing(mode, await version([future.id]))
  await expectContinuation('ОП-1R13', last.id)
  const deletedVersion = (await version([last.id]))[0]
  await deleteUsing(mode, [deletedVersion])
  await expectContinuation('ОП-1R12', rows.at(-3)!.id)
  expect((await readCalculation())[0].common).toMatchObject({ required: 2, completedRowIds: [root.id] })
  for (const document of await documents()) {
    expect(document.members).not.toContain(last.id)
    expect(document.members).toContain(root.id)
  }
  await expect(deleteUsing(mode, [deletedVersion])).rejects.toThrow(/больше не|устар|измен/)
  const [recreated] = await createRepeated({ data: { source: (await version([rows.at(-3)!.id]))[0], targetJoints: ['ОП-1R12'] } })
  expect(recreated.id).not.toBe(last.id)
  expect(recreated).toMatchObject({ weldLength: '123.456789123', vikRequest: null, vikConclusion: null, uzkConclusion: null })
  expect((await documents()).every(doc => !doc.members.includes(recreated.id))).toBe(true)
  await expectContinuation(null)
  // Whole-branch deletion is permitted; arbitrary middle deletion remains forbidden.
  const branch = (await facts()).filter(row => row.joint.startsWith('ОП-1')).map(row => row.id)
  await deleteUsing(mode === 'import' ? 'import' : 'bulk', await version(branch))
  expect((await facts()).map(row => row.id)).toEqual([other.id])
  expect((await readCalculation())[0]).toMatchObject({ rowIds: [other.id], common: { required: 1, coveredRowIds: [other.id], completedRowIds: [] }, pvk: { required: 1 } })
  for (const document of await documents()) expect(document.members).toEqual([other.id])
  expect((await documents()).map(doc => doc.title)).not.toContain('T21-UZK-C')
  await expectContinuation(null)
})

test('Т: удалить официального тёзку, восстановить оставшегося и создать следующий ремонт', async () => {
  const [root, other] = await seed(0)
  const twins = await withLineProgramFixture(async db => (await db.query<{ id: number }>(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,t1,t2,weld_length,weld_date,material_group,welding_method,stamp_1_k,has_vik,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,officiality,revision_actuality)
    select line_program_id,project_title,subtitle_code,line,'ОП-1R1',connection_type,t1,t2,weld_length,weld_date,material_group,welding_method,'T21-B','да','T21-TWIN-R','2026-09-02',case when n=2 then 'годен' else 'ожидает НК' end,case when n=2 then 'T21-TWIN-C' else null end,case when n=2 then '2026-09-03'::date else null end,case when n=1 then 'неофициальный' else 'действующий' end,'актуальная'
    from weld_joints cross join generate_series(1,2) n where id=$1 returning id`, [root.id])).rows)
  const [remaining, official] = twins
  await syncDocuments()
  const before = await facts(), docsBefore = await documents()
  await expect(previewOfficiality({ data: { targets: await version([remaining.id]), officiality: 'official' } })).rejects.toThrow(/официальный стык.*ОП-1R1/)
  expect(await facts()).toEqual(before)
  expect(await documents()).toEqual(docsBefore)
  await remove({ data: (await version([official.id]))[0] })
  await expectContinuation('ОП-1R1', root.id)
  const targets = await version([remaining.id]), plan = await previewOfficiality({ data: { targets, officiality: 'official' } })
  await applyOfficiality({ data: { targets, officiality: 'official', expectedPlanKey: plan.planKey } })
  await expectContinuation(null)
  expect((await facts()).find(row => row.id === remaining.id)).toMatchObject({ officiality: null, vik_result: 'ожидает НК', vik_conclusion: null })
  await updateResult({ data: { id: remaining.id, mutationScope: 'lnk', expectedVersion: (await version([remaining.id]))[0].version, vikResult: 'ремонт', vikConclusion: 'T21-RESTORED-C', vikConclusionDate: '2026-09-03' } })
  await expectContinuation('ОП-1R2', remaining.id)
  const [repair] = await createRepeated({ data: { source: (await version([remaining.id]))[0], targetJoints: ['ОП-1R2'] } })
  expect(repair).toMatchObject({ joint: 'ОП-1R2', weldLength: '123.456789123', vikConclusion: null })
  const state = await withE2eDatabase(async db => (await db.query('select source_row_id,physical_root_id from weld_joint_program_states where weld_joint_id=$1', [repair.id])).rows[0])
  expect(state).toEqual({ source_row_id: remaining.id, physical_root_id: root.id })
  expect((await readCalculation())[0]).toMatchObject({ rowIds: [root.id, other.id], common: { required: 2 } })
  await expectContinuation(null)
})

for (const resultFirst of [false, true]) test(`Т request-only: ${resultFirst ? 'результат' : 'снятие'} получает блокировку первым; конкурирующая запись атомарно отклоняется`, async () => {
  const rows = await seed(0), row = rows[1], target = (await version([row.id]))[0]
  const clear = () => updateAssignment({ data: { id: row.id, hasUzk: null, mutationScope: 'welding', expectedVersion: target.version } })
  const result = () => updateResult({ data: { id: row.id, uzkResult: 'годен', uzkConclusion: 'T21-RACE-C', uzkConclusionDate: '2026-09-03', mutationScope: 'lnk', expectedVersion: target.version } })
  let release!: () => void, ready!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), locked = new Promise<number>(resolve => { ready = resolve })
  const holder = withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select id from weld_joints where id=$1 for update', [row.id])
      ready((await db.query('select pg_backend_pid() as pid')).rows[0].pid)
      await gate
    } finally { await db.query('rollback') }
  })
  const pending: Array<Promise<PromiseSettledResult<unknown>>> = []
  const start = (run: () => Promise<unknown>) => pending.push(run().then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })))
  try {
    const pid = await Promise.race([locked, holder.then(() => { throw new Error('Lock holder stopped before readiness') })])
    const waiting = () => withE2eDatabase(async db => Number((await db.query(`with recursive waiting(pid) as (
      select pid from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))
      union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid)) where a.datname=current_database()) select count(*) n from waiting`, [pid])).rows[0].n))
    start(resultFirst ? result : clear)
    await expect.poll(waiting).toBe(1)
    start(resultFirst ? clear : result)
    await expect.poll(waiting).toBe(2)
  } finally {
    release()
    await Promise.allSettled([holder, ...pending])
  }
  await holder
  const settled = await Promise.all(pending)
  expect(settled.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
  expect(String((settled[1] as PromiseRejectedResult).reason)).toMatch(/измен|устар|верс/)
  const saved = (await facts()).find(item => item.id === row.id)
  expect(saved).toMatchObject(resultFirst
    ? { has_uzk: 'да', uzk_request: 'T21-UZK-R', uzk_result: 'годен', uzk_conclusion: 'T21-RACE-C' }
    : { has_uzk: null, uzk_request: null, uzk_result: null, uzk_conclusion: null })
  const request = (await documents()).find(doc => doc.title === 'T21-UZK-R')
  expect(request.members).toEqual(resultFirst ? rows.map(item => item.id) : [rows[0].id])
  expect((await documents()).some(doc => doc.title === 'T21-RACE-C')).toBe(resultFirst)
  expect((await facts())[0]).toMatchObject({ uzk_result: 'годен', uzk_conclusion: 'T21-UZK-C' })
})
