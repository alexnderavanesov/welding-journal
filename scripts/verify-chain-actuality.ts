import assert from 'node:assert/strict'
import pg from 'pg'
import { eq, inArray, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const url = new URL(process.env.DATABASE_URL ?? '')
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/welding_tracker_e2e')
assert.equal(process.env.WELDING_ENV_LOADED, '1')
const [{ requireDb }, schema, actuality, dirty, dispatcher, read] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/chain-actuality'),
  import('../src/server/dispatcher-task-index-dirty'),
  import('../src/server/dispatcher-task-index'), import('../src/server/weld-read'),
])
const db = requireDb(), { weldJoints, linePrograms, weldJointProgramStates, dispatcherRowTasks } = schema
const projectTitle = 'E2E physical actuality SQL'
assert.equal((await db.select({ id: weldJoints.id }).from(weldJoints).where(eq(weldJoints.projectTitle, projectTitle))).length, 0)
const originalQuery = pg.Client.prototype.query
let queries = 0
pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) { queries++; return (originalQuery as (...args: unknown[]) => unknown).apply(this, args) } as typeof originalQuery
const counts: { count: number; preview: number; save: number; milliseconds: number }[] = []
const preview = (rowId: number, active: boolean) => db.transaction(tx => actuality.previewChainActualityInTransaction(tx, { rowId, active }))
const save = (data: Awaited<ReturnType<typeof preview>>) => db.transaction(tx => actuality.setChainActualityInTransaction(tx, { rowId: data.rowId, active: data.active, token: data.token, confirmed: true }))
try {
  for (const count of [24, 1024, 200_000]) {
    const [line] = await db.insert(linePrograms).values({ projectTitle, subtitleCode: 'A', line: `ACTUALITY-${count}`, category: 'II', groupName: 'A', weldControlPercent: 10, pvkControlPercent: 0 }).returning()
    await db.execute(sql`insert into weld_joints (line_program_id,project_title,subtitle_code,line,joint,has_uzk,uzk_result,uzk_conclusion,officiality,revision_actuality)
      select ${line.id},${projectTitle},'A',${line.line},case n when 1 then 'S1' when 2 then 'S1R1' when 3 then 'S1R1' when 4 then 'S1Y1' when 5 then 'S1Y1R1' when 6 then 'S1Y2' else 'F'||n end,
      'да',case when n<4 then 'ремонт' else 'годен' end,'KEEP-DOCUMENT',case when n=3 then 'неофициальный' else 'действующий' end,case when n=2 then 'не актуален' else null end from generate_series(1,${count}) n`)
    const first = await db.select().from(weldJoints).where(eq(weldJoints.lineProgramId, line.id)).orderBy(weldJoints.id).limit(6)
    const ids = first.map(row => row.id), root = ids[0]
    // Persist only the six linked records. The remaining ordinary roots are legacy
    // rows, exercising compact line loading at the normal 200k-joint scale.
    const { captureProgramChainStates } = await import('../src/lib/line-program-chain-state')
    await db.insert(weldJointProgramStates).values([...captureProgramChainStates(first).values()])
    const before = queries, start = performance.now(), current = await preview(ids[2], false)
    const previewQueries = queries - before
    assert.equal(current.reason, null); assert.equal(current.total, 3); assert.equal(current.changedCount, 2)
    assert.deepEqual(current.rows.map(row => row.id), ids.slice(0, 3))
    const beforeSave = queries
    assert.equal((await save(current)).changedCount, 2)
    counts.push({ count, preview: previewQueries, save: queries - beforeSave, milliseconds: Math.round(performance.now() - start) })
    const changed = await db.select().from(weldJoints).where(inArray(weldJoints.id, ids)).orderBy(weldJoints.id)
    for (let i = 0; i < first.length; i++) {
      const omitChanged = ({ revisionActuality: _actuality, updatedAt: _updated, weldingUpdatedAt: _welding, ...rest }: typeof first[number]) => rest
      assert.deepEqual(omitChanged(changed[i]), omitChanged(first[i]), 'No control/document/officiality fields may be changed')
      assert.equal(changed[i].revisionActuality, i < 3 ? 'не актуален' : null)
    }
    assert.equal((await save(await preview(root, false))).changedCount, 0)
    await assert.rejects(save(current), /изменились/, 'Replaying an old token must not undo a later operation')
    const reactivate = await preview(root, true)
    await assert.rejects(db.transaction(tx => actuality.setChainActualityInTransaction(tx, { ...reactivate, confirmed: false })), /подтвердите/)
    await save(reactivate)
    if (count === 24) {
      // One coil side is independent of both its cut parent and the second side.
      const side = await preview(ids[4], false)
      assert.deepEqual(side.rows.map(row => row.id), ids.slice(3, 5)); await save(side)
      assert.equal((await preview(ids[5], false)).changedCount, 1)
      assert.equal((await preview(root, false)).changedCount, 3)
      await save(await preview(ids[4], true))
      // A renamed saved repair keeps membership. A moved repair blocks a partial write.
      await db.update(weldJoints).set({ joint: 'RENAMED' }).where(eq(weldJoints.id, ids[2]))
      assert.equal((await preview(root, false)).total, 3)
      await db.update(weldJoints).set({ line: 'MOVED' }).where(eq(weldJoints.id, ids[2]))
      assert.match((await preview(root, false)).reason ?? '', /другую линию/)
      await db.update(weldJoints).set({ line: line.line, joint: 'S1R1' }).where(eq(weldJoints.id, ids[2]))
      const stale = await preview(root, false)
      const [later] = await db.insert(weldJoints).values({ lineProgramId: line.id, projectTitle, subtitleCode: 'A', line: line.line, joint: 'S1R2' }).returning()
      await assert.rejects(save(stale), /изменились/)
      await db.delete(weldJoints).where(eq(weldJoints.id, later.id))
      const fresh = await preview(root, false)
      let executions = 0
      await assert.rejects(db.transaction(tx => actuality.setChainActualityInTransaction(new Proxy(tx, { get(target, key) {
        if (key === 'execute') return (...args: Parameters<typeof tx.execute>) => {
          if (++executions === 3) throw new Error('dirty index failure')
          return target.execute(...args)
        }
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
      } }), { ...fresh, confirmed: true })), /dirty index failure/)
      assert.equal(executions, 3, 'Failure must occur at invalidation after the row update')
      assert.equal((await preview(root, false)).changedCount, 3)
      // Already stored mixed records must appear on every member, including the
      // unofficial one, in both persisted and virtual dispatcher columns.
      await db.update(weldJoints).set({ revisionActuality: 'не актуален' }).where(eq(weldJoints.id, ids[2]))
      await dirty.markDispatcherTaskIndexDirty(db, { scopes: dirty.getDispatcherDirtyScopes(first, new Map()) })
      await dispatcher.ensureDispatcherTaskIndexFresh()
      const tasks = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids.slice(0, 3)))
      assert.deepEqual(tasks.filter(row => row.code === 'ДЗ-13').map(row => row.weldJointId).sort((a, b) => a - b), ids.slice(0, 3))
      const virtual = await read.attachDispatcherTaskCodesToPage(ids.slice(0, 3).map(id => ({ id }))) as { id: number; dispatcherTasks: string }[]
      assert(virtual.every(row => row.dispatcherTasks.includes('ДЗ-13')))
      await save(await preview(root, false))
      await dispatcher.ensureDispatcherTaskIndexFresh()
      const resolved = await read.attachDispatcherTaskCodesToPage(ids.slice(0, 3).map(id => ({ id }))) as { id: number; dispatcherTasks: string }[]
      const remaining = await db.select().from(dispatcherRowTasks).where(inArray(dispatcherRowTasks.weldJointId, ids.slice(0, 3)))
      assert(!remaining.some(row => row.taskKey.startsWith('chain-actuality:')), 'The actuality task must disappear from every member')
      // This deliberately incomplete coil history can retain another ДЗ-13.
      // Resolving actuality must not hide independent integrity warnings.
      for (const row of resolved) assert.equal(row.dispatcherTasks.includes('ДЗ-13'), remaining.some(task => task.weldJointId === row.id && task.code === 'ДЗ-13'))
      // Final uniform state is still reversible, without a task as entry point.
      await save(await preview(root, true))
      // Clamp a vanished/out-of-range page: confirmation still shows the actual
      // surviving members, not an empty table with a nonzero change count.
      const lastPage = await db.transaction(tx => actuality.previewChainActualityInTransaction(tx, { rowId: root, active: false, page: 999 }))
      assert.equal(lastPage.page, 0); assert.deepEqual(lastPage.rows.map(row => row.id), ids.slice(0, 3))
      // The actual settings writer takes this exclusive advisory lock. It must
      // not change R/W/Y interpretation between the preview read and its update.
      const settingsWriter = new pg.Client({ connectionString: url.toString() })
      await settingsWriter.connect()
      let settingsAttempt: Promise<unknown> | undefined
      try {
        await settingsWriter.query('begin')
        const settingsPid = Number((await settingsWriter.query('select pg_backend_pid() as pid')).rows[0].pid)
        await db.transaction(async tx => {
          const verified = await actuality.previewChainActualityInTransaction(tx, { rowId: root, active: false })
          settingsAttempt = settingsWriter.query("select pg_advisory_xact_lock(hashtext('weld-validation-settings'))")
          void settingsAttempt.catch(() => {})
          let waiting = false
          for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
            const result = await tx.execute(sql`select 1 from pg_locks where pid=${settingsPid} and locktype='advisory' and not granted`)
            waiting = result.rows.length > 0
            if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
          }
          assert(waiting, 'Settings cannot change while the verified chain snapshot is in use')
          await actuality.setChainActualityInTransaction(tx, { ...verified, confirmed: true })
        })
        await settingsAttempt
      } finally {
        await settingsWriter.query('rollback'); await settingsWriter.end(); await settingsAttempt?.catch(() => {})
      }
      await save(await preview(root, true))
      // Deterministic dispatcher-publication race. It holds the same parent-table
      // mode as the real refresher, then persists a final status. A writer must
      // wait BEFORE taking owner row locks, not upgrade its table mode afterward.
      const racePreview = await preview(root, false)
      const publisher = new pg.Client({ connectionString: url.toString() })
      await publisher.connect()
      let writer: Promise<unknown> | undefined
      try {
        await publisher.query('begin')
        await dispatcher.lockWeldJointWritesForDispatcherReplacement({ execute(statement: SQL) {
          const query = new PgDialect().sqlToQuery(statement)
          return publisher.query(query.sql, query.params)
        } } as never)
        let resolvePid!: (pid: number) => void
        const pidReady = new Promise<number>(resolve => { resolvePid = resolve })
        writer = db.transaction(async tx => {
          const result = await tx.execute(sql`select pg_backend_pid() as pid`)
          resolvePid(Number(result.rows[0].pid))
          return actuality.setChainActualityInTransaction(tx, { ...racePreview, confirmed: true })
        })
        void writer.catch(() => {})
        const pid = await pidReady
        let waiting = false
        for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
          waiting = (await publisher.query("select 1 from pg_locks where pid=$1 and locktype='relation' and not granted", [pid])).rowCount! > 0
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert(waiting, 'Writer must be observed waiting on the publication table lock')
        await publisher.query('update weld_joints set final_status=final_status where id=$1', [root])
        await publisher.query('commit')
        await writer
        assert.equal((await preview(root, false)).changedCount, 0)
      } finally {
        await publisher.query('rollback'); await publisher.end(); await writer?.catch(() => {})
      }
    }
    await db.delete(weldJoints).where(eq(weldJoints.lineProgramId, line.id))
    await db.delete(weldJointProgramStates).where(inArray(weldJointProgramStates.weldJointId, ids))
    await db.delete(linePrograms).where(eq(linePrograms.id, line.id))
  }
  assert(counts.every(item => item.preview === counts[0].preview && item.save === counts[0].save), 'SQL count must not grow with line size')
  console.log(JSON.stringify({ reversible: true, coilBoundary: true, staleRejected: true, preservedFacts: true, indexedEveryMember: true, counts }))
} finally {
  pg.Client.prototype.query = originalQuery
  await db.execute(sql`delete from weld_joint_program_states where weld_joint_id in (select id from weld_joints where project_title=${projectTitle})`)
  await db.delete(weldJoints).where(eq(weldJoints.projectTitle, projectTitle))
  await db.delete(linePrograms).where(eq(linePrograms.projectTitle, projectTitle))
  await dirty.markDispatcherTaskIndexDirty(db)
}
