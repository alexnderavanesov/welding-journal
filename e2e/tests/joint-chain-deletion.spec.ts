import { asE2eOwner } from '../with-owner-access'
import { deleteJournalJoint } from '../journal-grid'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { writeFile } from 'node:fs/promises'
import { withE2eDatabase } from '../database'
import { createWeldJoints as raw_createWeldJoints , deleteWeldJoint as raw_deleteWeldJoint, deleteWeldJoints as raw_deleteWeldJoints } from '@/server/weld-mutations'
import { replaceWeldJoints as raw_replaceWeldJoints } from '@/server/weld-import'
import { cleanupLineProgramProjects } from '../line-program-fixtures'
import { accessContext } from '@/server/access-store'

const project = 'E2E chain deletion protection'
type Target = { id: number; version: string }
let previousDataList: { value: string; updated_at: Date } | undefined
test.beforeAll(async () => withE2eDatabase(async db => {
  previousDataList = (await db.query("select value,updated_at from app_settings where key='data-list'")).rows[0]
  const settings = previousDataList ? JSON.parse(previousDataList.value) : {}
  settings.connectionTypes = [...new Set([...(settings.connectionTypes ?? []), 'С19'])]
  await db.query(`insert into app_settings(key,value) values ('data-list',$1)
    on conflict(key) do update set value=excluded.value`, [JSON.stringify(settings)])
}))
test.afterAll(async () => withE2eDatabase(async db => {
  if (previousDataList) await db.query("update app_settings set value=$1,updated_at=$2 where key='data-list'", [previousDataList.value, previousDataList.updated_at])
  else await db.query("delete from app_settings where key='data-list'")
}))
test.afterEach(() => cleanupLineProgramProjects([project]))

async function seed(names = ['S1', 'S1R1', 'S1R2', 'F9']) {
  return withE2eDatabase(async db => {
    const { rows } = await db.query<Target>(`insert into weld_joints
      (project_title, subtitle_code, line, joint, officiality, revision_actuality, has_vik, final_status)
      select $1,'DELETE','CHAIN-DELETE',name,
        case when n=2 then 'неофициальный' else 'действующий' end,
        case when n=3 then 'не актуален' else 'актуален' end,'да',
        case when n=3 then 'неактуальный' when n=2 then 'ожидает ремонт' else 'ожидает сварку' end
      from unnest($2::text[]) with ordinality as t(name,n) returning id,xmin::text as version`, [project, names])
    return rows
  })
}
const snapshot = () => withE2eDatabase(async db => (await db.query('select * from weld_joints where project_title=$1 order by id', [project])).rows)

for (const deletionFirst of [true, false]) test(`создание продолжения и удаление источника конкурентно: удаление получает блокировку ${deletionFirst ? 'первым' : 'вторым'}`, async ({}, info) => {
  const createSource = () => withE2eDatabase(async db => (await db.query<Target>(`insert into weld_joints
    (project_title,subtitle_code,line,joint,weld_date,connection_type,has_vik,vik_result,has_rk,rk_result,stamp_1_k)
    values ($1,'DELETE','RACE','S1','2026-09-01','С19','да','годен','да','ремонт','A') returning id,xmin::text as version`, [project])).rows[0])
  // Prove the fixture genuinely permits repair creation; a failing creator must
  // not make an otherwise ineffective race test pass through deletion alone.
  const initial = await createSource()
  await createWeldJoints({ data: { source: initial, targetJoints: ['S1R1'] } })
  expect((await snapshot()).map(r => r.joint)).toEqual(['S1', 'S1R1'])
  const targets = await withE2eDatabase(async db => (await db.query<Target>(
    'select id,xmin::text as version from weld_joints where project_title=$1', [project])).rows)
  await deleteWeldJoints({ data: { targets } })
  const source = await createSource()
  const create = () => createWeldJoints({ data: { source, targetJoints: ['S1R1'] } })
  const remove = () => deleteWeldJoint({ data: source })
  let release!: () => void, locked!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<number>(resolve => { locked = resolve })
  const holder = withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select id from weld_joints where id=$1 for update', [source.id])
      locked((await db.query('select pg_backend_pid() pid')).rows[0].pid)
      await gate
    } finally { await db.query('rollback') }
  })
  const pending: Array<Promise<PromiseSettledResult<unknown>>> = []
  type Writer = 'create' | 'delete'
  const writerContext = new AsyncLocalStorage<Writer>()
  const start = (writer: Writer, run: () => Promise<unknown>) => pending.push(writerContext.run(writer, run).then(
    value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }),
  ))
  const normalizeSql = (text: string) => text.replace(/'(?:''|[^'])*'/g, "'?'").replace(/\s+/g, ' ').trim()
  const ownedClients = new Map<number, { operation: string; operationId: string; sql: string }>()
  const ownedWriters = new Map<Writer, { pid: number; operationId: string }>()
  const identificationErrors: string[] = []
  type BlockedSession = { pid: number; application_name: string; state: string; wait_event_type: string | null;
    wait_event: string | null; backend_type: string; blockers: number[]; is_waiter: boolean; query: string }
  const graphs: { phase: string; elapsedMs: number; sessions: BlockedSession[] }[] = []
  const raceStart = performance.now()
  let phase = 'first-writer', holderPid: number | undefined, orderingVerified = false
  const originalQuery = pg.Client.prototype.query
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const context = accessContext.getStore()
    // pg receives this backend PID during connection startup. Observing it adds
    // no SQL and distinguishes these writers from detached/background sessions.
    const pid = (this as pg.Client & { processID?: number }).processID
    const writer = writerContext.getStore()
    if (pid && context && writer && context.operation === (writer === 'create' ? 'createWeldJoints' : 'deleteWeldJoint')) {
      const query = args[0]
      const text = typeof query === 'string' ? query
        : query && typeof query === 'object' && 'text' in query && typeof query.text === 'string' ? query.text : '<non-text query>'
      ownedClients.set(pid, { operation: context.operation, operationId: context.operationId, sql: normalizeSql(text) })
      if (/^begin\b/i.test(text.trim())) {
        if (ownedWriters.has(writer)) identificationErrors.push(`${writer}: more than one main transaction observed`)
        else ownedWriters.set(writer, { pid, operationId: context.operationId })
      }
    }
    return (originalQuery as (...args: unknown[]) => unknown).apply(this, args)
  } as typeof originalQuery
  try {
    const pid = await Promise.race([ready, holder.then(() => { throw new Error('Lock holder ended before readiness') })])
    holderPid = pid
    // Starting promises in order is not proof of lock order. Queue one writer
    // behind our row lock, then observe the second behind it before releasing.
    const waiting = () => withE2eDatabase(async db => {
      const sessions = (await db.query<BlockedSession>(`with recursive waiting(pid) as (
      select pid from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))
      union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
        where a.datname=current_database())
      select a.pid,a.application_name,a.state,a.wait_event_type,a.wait_event,a.backend_type,
        pg_blocking_pids(a.pid) blockers, a.pid in (select pid from waiting) is_waiter,a.query
      from pg_stat_activity a where a.datname=current_database() and (a.pid=$1 or a.pid in (select pid from waiting))
      order by a.pid`, [pid])).rows.map(row => ({ ...row, query: normalizeSql(row.query) }))
      const previous = graphs.at(-1)
      if (previous?.phase !== phase || JSON.stringify(previous.sessions) !== JSON.stringify(sessions)) {
        graphs.push({ phase, elapsedMs: Math.round(performance.now() - raceStart), sessions })
        if (graphs.length > 20) graphs.splice(1, 1)
      }
      return sessions
    })
    const firstWriter: Writer = deletionFirst ? 'delete' : 'create'
    const secondWriter: Writer = deletionFirst ? 'create' : 'delete'
    const firstWaitsForHolder = (sessions: BlockedSession[]) => {
      const first = ownedWriters.get(firstWriter)
      return Boolean(first && sessions.find(session => session.pid === first.pid)?.blockers.includes(pid))
    }
    const waitsTransitivelyFor = (sessions: BlockedSession[], waiter: number, blocker: number) => {
      const pending = [waiter], seen = new Set<number>()
      while (pending.length) {
        const current = pending.pop()!
        if (seen.has(current)) continue
        seen.add(current)
        for (const parent of sessions.find(session => session.pid === current)?.blockers ?? []) {
          if (parent === blocker) return true
          pending.push(parent)
        }
      }
      return false
    }
    start(firstWriter, deletionFirst ? remove : create)
    await expect.poll(async () => ({ identified: ownedWriters.size === 1,
      firstWaitsForHolder: firstWaitsForHolder(await waiting()), identificationErrors: [...identificationErrors] }))
      .toEqual({ identified: true, firstWaitsForHolder: true, identificationErrors: [] })
    phase = 'second-writer'
    start(secondWriter, deletionFirst ? create : remove)
    // A dispatcher publisher can also wait behind this row lock. Its backend
    // must neither fail the test nor stand in for the actual second writer.
    await expect.poll(async () => {
      const sessions = await waiting(), first = ownedWriters.get(firstWriter), second = ownedWriters.get(secondWriter)
      return { identified: ownedWriters.size === 2, firstWaitsForHolder: firstWaitsForHolder(sessions),
        distinct: Boolean(first && second && first.pid !== second.pid && first.operationId !== second.operationId),
        secondWaitsForFirst: Boolean(first && second && waitsTransitivelyFor(sessions, second.pid, first.pid)),
        identificationErrors: [...identificationErrors] }
    }).toEqual({ identified: true, firstWaitsForHolder: true, distinct: true, secondWaitsForFirst: true, identificationErrors: [] })
    orderingVerified = true
  } finally {
    try {
      // Keep the still-blocked graph on success as well as failure, including
      // unrelated sessions. No bind values or account identities are recorded.
      const path = info.outputPath('chain-deletion-blocked-graph.json')
      await writeFile(path, JSON.stringify({ deletionFirst, phase, holderPid, orderingVerified, identificationErrors,
        ownedWriters: [...ownedWriters].map(([writer, value]) => ({ writer, ...value })),
        ownedClients: [...ownedClients].map(([pid, value]) => ({ pid, ...value })), graphs }, null, 2))
      await info.attach('chain-deletion-blocked-graph', { path, contentType: 'application/json' })
    } finally {
      release()
      try { await Promise.allSettled([holder, ...pending]) }
      finally { pg.Client.prototype.query = originalQuery }
    }
  }
  await holder
  const results = await Promise.all(pending)
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  const final = await snapshot()
  expect(final.map(r => r.joint)).toEqual(deletionFirst ? [] : ['S1', 'S1R1'])
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(String(failure.reason)).toMatch(/предшественника|больше не|перенесен|изменен|изменил|устарел/i)
})

for (const mode of ['single', 'bulk', 'import'] as const) {
  for (const [source, child] of [['S1W1R1', 'S1W2R1'], ['S1R1W1', 'S1R2W1']]) {
    test(`${mode}: смешанный предшественник ${source} защищён при продолжении ${child}`, async () => {
      const rows = await seed(['S1', source, child, 'F9']), before = await snapshot()
      const action = mode === 'single' ? deleteWeldJoint({ data: rows[1] })
        : mode === 'bulk' ? deleteWeldJoints({ data: { targets: [rows[1], rows[3]] } })
        : replaceWeldJoints({ data: { records: [], deleteIds: [rows[1].id, rows[3].id], expectedVersions: [rows[1], rows[3]] } })
      await expect(action).rejects.toThrow(new RegExp(`Нельзя удалить предшественника.*${child}`))
      expect(await snapshot()).toEqual(before)
      await deleteWeldJoint({ data: rows[2] })
      const sourceVersion = await withE2eDatabase(async db => (await db.query<Target>('select id,xmin::text as version from weld_joints where id=$1', [rows[1].id])).rows[0])
      await deleteWeldJoint({ data: sourceVersion })
      expect((await snapshot()).map(row => row.joint)).toEqual(['S1', 'F9'])
    })
  }
  test(`${mode}: предшественник с неофициальным/неактуальным продолжением не удаляется; группа атомарна`, async () => {
    const rows = await seed(), before = await snapshot()
    const action = mode === 'single' ? deleteWeldJoint({ data: rows[0] })
      : mode === 'bulk' ? deleteWeldJoints({ data: { targets: [rows[0], rows[3]] } })
      : replaceWeldJoints({ data: { records: [], deleteIds: [rows[0].id, rows[3].id], expectedVersions: [rows[0], rows[3]] } })
    await expect(action).rejects.toThrow(/Нельзя удалить предшественника.*S1R1.*S1R2/)
    expect(await snapshot()).toEqual(before)
    await expect(deleteWeldJoint({ data: rows[1] })).rejects.toThrow(/Нельзя удалить предшественника.*S1R2/)
    expect(await snapshot()).toEqual(before)
  })
}

test('удаление с конца и всей веткой сохраняет доступный путь исправления', async () => {
  const rows = await seed()
  await deleteWeldJoint({ data: rows[2] })
  await deleteWeldJoints({ data: { targets: rows.slice(0, 2) } })
  expect((await snapshot()).map(r => r.joint)).toEqual(['F9'])
  await replaceWeldJoints({ data: { records: [], deleteIds: [rows[3].id], expectedVersions: [rows[3]] } })
  expect(await snapshot()).toEqual([])
})

test('сохранённые ID защищают перенесённое продолжение через удалённый промежуточный узел', async () => {
  const rows = await seed()
  await withE2eDatabase(async db => {
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values ($1,'primary',$1,null),($2,'repair',$1,$1),($3,'repair',$3,$2)`, rows.slice(0, 3).map(r => r.id))
    // Synthetic damaged legacy history: normal UI must no longer create it.
    await db.query('delete from weld_joints where id=$1', [rows[1].id])
    await db.query("update weld_joints set line='MOVED',joint='F77' where id=$1", [rows[2].id])
  })
  const before = await snapshot()
  await expect(deleteWeldJoint({ data: rows[0] })).rejects.toThrow(/Нельзя удалить предшественника.*F77.*MOVED/)
  expect(await snapshot()).toEqual(before)
})

test('карточка удаления объясняет отказ; отмена не меняет цепочку и удаление хвоста доступно', async ({ page }) => {
  const rows = await seed(), before = await snapshot()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(project)
  await deleteJournalJoint(page, rows[0].id)
  const confirmation = page.locator('[data-confirm-action-dialog="true"]').locator('..')
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await snapshot()).toEqual(before)
  await deleteJournalJoint(page, rows[0].id)
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByText(/Нельзя удалить предшественника: остаются продолжения цепочки/)).toBeVisible()
  expect(await snapshot()).toEqual(before)
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await deleteJournalJoint(page, rows[2].id)
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(async () => (await snapshot()).map(r => r.joint)).toEqual(['S1', 'S1R1', 'F9'])
  expect(errors).toEqual([])
})

const deleteWeldJoint = asE2eOwner(raw_deleteWeldJoint, 'welding.delete')
const deleteWeldJoints = asE2eOwner(raw_deleteWeldJoints, 'welding.delete')
const replaceWeldJoints = asE2eOwner(raw_replaceWeldJoints, 'welding.import')

const createWeldJoints = asE2eOwner(raw_createWeldJoints, 'welding.edit')
