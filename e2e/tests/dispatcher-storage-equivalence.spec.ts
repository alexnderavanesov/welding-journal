import { expect, test } from '@playwright/test'
import { eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { assertSafeE2eDatabaseUrl, E2E_DATABASE_URL } from '../database'

test('flat dispatcher hydration preserves every schema field and exactly matches ordinary Drizzle reads', async () => {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const [{ requireDb }, { weldJoints }, { readDispatcherWeldBatch }] = await Promise.all([
    import('../../src/db'), import('../../src/db/schema'), import('../../src/server/dispatcher-weld-hydration'),
  ])
  const rollback = new Error('rollback isolated decoder fixture')
  await expect(requireDb().transaction(async tx => {
    const values: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(getTableColumns(weldJoints))) {
      if (key === 'id') continue
      values[key] = key === 'lineProgramId' ? null
        : column.dataType === 'boolean' ? true
          : column.dataType === 'date' ? new Date('2026-10-13T21:15:12.345Z')
            : column.dataType === 'number' ? 123.456
              : column.getSQLType() === 'date' ? '2024-02-29'
                : `значение ${key}: "\\\n\t  `
    }
    const [full] = await tx.insert(weldJoints).values(values).returning()
    const [empty] = await tx.insert(weldJoints).values({ projectTitle: 'E2E flat reader null fields' }).returning()
    const ids = [empty.id, full.id]
    const ordinary = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
    const flat = await readDispatcherWeldBatch(tx, ids)
    expect(flat.sort((a, b) => a.id - b.id)).toEqual(ordinary.sort((a, b) => a.id - b.id))
    expect(Object.keys(flat[0]).sort()).toEqual(Object.keys(getTableColumns(weldJoints)).sort())
    expect(flat.find(row => row.id === full.id)?.d1).toBe(123.456)
    expect(flat.find(row => row.id === full.id)?.weldDate).toBe('2024-02-29')
    expect(flat.find(row => row.id === full.id)?.createdAt).toBeInstanceOf(Date)
    // Same transaction sees its own later mutation, not an earlier object/cache.
    await tx.update(weldJoints).set({ d1: 0, weldDate: null, officiality: 'неофициальный' }).where(eq(weldJoints.id, full.id))
    expect(await readDispatcherWeldBatch(tx, [full.id])).toEqual(await tx.select().from(weldJoints).where(eq(weldJoints.id, full.id)))
    expect(await readDispatcherWeldBatch(tx, [])).toEqual([])
    throw rollback
  })).rejects.toBe(rollback)
})

test('staging arrays round-trip all values, duplicates and batch boundaries in PostgreSQL', async () => {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const [{ requireDb }, staging] = await Promise.all([
    import('../../src/db'), import('../../src/server/dispatcher-task-index-staging'),
  ])
  await requireDb().transaction(async tx => {
    await staging.createDispatcherTaskIndexStage(tx, 'active')
    const writer = staging.createDispatcherTaskIndexStageWriter(tx, 'active')
    const rows = Array.from({ length: staging.DISPATCHER_TASK_INDEX_STAGE_BATCH_SIZE + 3 }, (_, i) => ({
      rowId: i + 1, taskKey: `"\\{,}\nNULL русский ${i}`, code: i % 2 ? 'ДЗ-01' : '',
    }))
    await writer.append(rows)
    await writer.append([rows[0]])
    await writer.flush()
    const actual = await tx.execute(sql`select weld_joint_id as "rowId", task_key as "taskKey", code
      from ${staging.getDispatcherTaskIndexStageTable('active')} order by weld_joint_id, task_key, code`)
    expect(actual.rows).toEqual([rows[0], ...rows])
    expect(writer.getMetrics()).toMatchObject({ insertRequestCount: 2, insertedRowCount: rows.length + 1, pendingRowCount: 0 })
  })
})

test('status batches keep null-safe stale-value protection and roll back atomically without changing facts', async () => {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const [{ requireDb }, { weldJoints }, { persistCalculatedFinalStatuses }] = await Promise.all([
    import('../../src/db'), import('../../src/db/schema'), import('../../src/server/final-status-persistence'),
  ])
  const rollback = new Error('rollback status fixture')
  let ids: number[] = []
  await expect(requireDb().transaction(async tx => {
    const rows = await tx.insert(weldJoints).values([
      { projectTitle: 'E2E status arrays', finalStatus: null, boq: 'preserved' },
      { projectTitle: 'E2E status arrays', finalStatus: 'годен', boq: 'preserved' },
      { projectTitle: 'E2E status arrays', finalStatus: 'ожидает НК', boq: 'preserved' },
    ]).returning()
    ids = rows.map(row => row.id)
    await persistCalculatedFinalStatuses(tx, [
      { id: ids[0], finalStatus: null }, { id: ids[1], finalStatus: null }, { id: ids[2], finalStatus: 'ожидает НК' },
    ], ids.map(id => ({ id, finalStatus: 'ремонт' })))
    const after = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids)).orderBy(weldJoints.id)
    expect(after).toEqual(rows.map((row, i) => ({ ...row, finalStatus: i === 1 ? 'годен' : 'ремонт' })))
    await persistCalculatedFinalStatuses(tx, [{ id: ids[0], finalStatus: 'ремонт' }], [{ id: ids[0], finalStatus: null }])
    expect(await tx.select().from(weldJoints).where(eq(weldJoints.id, ids[0]))).toEqual([rows[0]])
    throw rollback
  })).rejects.toBe(rollback)
  expect(await requireDb().select().from(weldJoints).where(inArray(weldJoints.id, ids))).toEqual([])
})
