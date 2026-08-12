import { createServerFn } from '@tanstack/react-start'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import { duplicateControls, weldJoints, type DuplicateControl, type NewDuplicateControl } from '@/db/schema'
import {
  DUPLICATE_CONTROL_METHODS,
  DUPLICATE_CONTROL_RESULTS,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
  type DuplicateControlResult,
} from '@/lib/duplicate-control-types'
import { parseDateLikeToIso } from '@/lib/date-format'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import { syncSystemDocumentsForWeldChangesInTransaction } from '@/server/system-documents'

export type DuplicateControlPayload = {
  id?: number
  weldJointId: number
  method: DuplicateControlMethod
  result: DuplicateControlResult
  controlDate: string
  conclusion: string
  conclusionDate: string
}

const methodSet = new Set<string>(DUPLICATE_CONTROL_METHODS)
const resultSet = new Set<string>(DUPLICATE_CONTROL_RESULTS)

export const listDuplicateControls = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  const rows = await db.select().from(duplicateControls).orderBy(asc(duplicateControls.weldJointId), asc(duplicateControls.id))
  return rows.map(toPayload)
})

export const saveDuplicateControl = createServerFn({ method: 'POST' })
  .validator((data: DuplicateControlPayload) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    const db = requireDb()
    const insertData = toDbInsert(data)
    return db.transaction(async (tx) => {
      if (data.id) {
        const [updated] = await tx
          .update(duplicateControls)
          .set({ ...insertData, updatedAt: new Date() })
          .where(eq(duplicateControls.id, data.id))
          .returning()
        if (!updated) throw new Error(`Дубль-контроль ${data.id} не найден`)
        await touchLnkProfile(tx, [updated.weldJointId])
        await markDispatcherTaskIndexDirty(tx)
        return toPayload(updated)
      }

      const [created] = await tx.insert(duplicateControls).values(insertData).returning()
      await touchLnkProfile(tx, [created.weldJointId])
      await markDispatcherTaskIndexDirty(tx)
      return toPayload(created)
    })
  })

export const saveDuplicateControls = createServerFn({ method: 'POST' })
  .validator((data: { records: DuplicateControlPayload[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('edit')
    if (data.records.length === 0) return []
    const prepared = data.records.map((record) => ({ record, insertData: toDbInsert(record) }))
    const db = requireDb()
    return db.transaction(async (tx) => {
      const saved: DuplicateControlRecord[] = []
      for (const { record, insertData } of prepared) {
        if (record.id) {
          const [updated] = await tx
            .update(duplicateControls)
            .set({ ...insertData, updatedAt: new Date() })
            .where(eq(duplicateControls.id, record.id))
            .returning()
          if (!updated) throw new Error(`Дубль-контроль ${record.id} не найден`)
          saved.push(toPayload(updated))
          continue
        }

        const [created] = await tx.insert(duplicateControls).values(insertData).returning()
        saved.push(toPayload(created))
      }
      await touchLnkProfile(tx, saved.map((record) => record.weldJointId))
      await markDispatcherTaskIndexDirty(tx)
      return saved
    })
  })

export const deleteDuplicateControl = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(duplicateControls)
        .where(eq(duplicateControls.id, data.id))
        .returning({ weldJointId: duplicateControls.weldJointId })
      if (deleted) await touchLnkProfile(tx, [deleted.weldJointId])
      await markDispatcherTaskIndexDirty(tx)
    })
    return { ok: true }
  })

function toDbInsert(record: DuplicateControlPayload): NewDuplicateControl {
  if (!Number.isInteger(record.weldJointId) || record.weldJointId <= 0) {
    throw new Error('Не выбран стык для дубль-контроля')
  }
  if (!methodSet.has(record.method)) throw new Error('Выберите метод дубль-контроля')
  if (!resultSet.has(record.result)) throw new Error('Выберите результат дубль-контроля')

  return {
    weldJointId: record.weldJointId,
    method: record.method,
    result: record.result,
    controlDate: dateOrNull(record.controlDate),
    conclusion: textOrNull(record.conclusion),
    conclusionDate: dateOrNull(record.conclusionDate),
  }
}

function toPayload(row: DuplicateControl): DuplicateControlRecord {
  return {
    id: row.id,
    weldJointId: row.weldJointId,
    method: row.method as DuplicateControlMethod,
    result: row.result as DuplicateControlResult,
    controlDate: row.controlDate ?? '',
    conclusion: row.conclusion ?? '',
    conclusionDate: row.conclusionDate ?? '',
  }
}

function textOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function dateOrNull(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const iso = parseDateLikeToIso(text)
  if (!iso) throw new Error(`Некорректная дата дубль-контроля: ${text}`)
  return iso
}

async function touchLnkProfile(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  weldJointIds: number[],
) {
  const uniqueIds = [...new Set(weldJointIds)]
  if (uniqueIds.length === 0) return
  const previousRows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, uniqueIds))
  const now = new Date()
  const updatedRows = await tx
    .update(weldJoints)
    .set({
      lnkCreatedAt: sql`coalesce(${weldJoints.lnkCreatedAt}, ${now})`,
      lnkUpdatedAt: now,
      updatedAt: now,
    })
    .where(inArray(weldJoints.id, uniqueIds))
    .returning()
  await syncSystemDocumentsForWeldChangesInTransaction(
    tx,
    updatedRows,
    new Map(previousRows.map((row) => [row.id, row])),
  )
}
