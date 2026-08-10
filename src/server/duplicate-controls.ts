import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { requireDb } from '@/db'
import { duplicateControls, type DuplicateControl, type NewDuplicateControl } from '@/db/schema'
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
        await markDispatcherTaskIndexDirty(tx)
        return toPayload(updated)
      }

      const [created] = await tx.insert(duplicateControls).values(insertData).returning()
      await markDispatcherTaskIndexDirty(tx)
      return toPayload(created)
    })
  })

export const deleteDuplicateControl = createServerFn({ method: 'POST' })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('delete')
    const db = requireDb()
    await db.transaction(async (tx) => {
      await tx.delete(duplicateControls).where(eq(duplicateControls.id, data.id))
      await markDispatcherTaskIndexDirty(tx)
    })
    return { ok: true }
  })

function toDbInsert(record: DuplicateControlPayload): NewDuplicateControl {
  if (!Number.isFinite(record.weldJointId)) throw new Error('Не выбран стык для дубль-контроля')
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
  return parseDateLikeToIso(text) ?? text
}
