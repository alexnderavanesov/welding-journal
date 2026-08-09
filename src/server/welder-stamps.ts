import { createServerFn } from '@tanstack/react-start'
import { asc, sql } from 'drizzle-orm'
import { requireDb } from '@/db'
import {
  welderStampSuspensions,
  welderStamps,
  type NewWelderStamp,
  type NewWelderStampSuspension,
  type WelderStamp,
  type WelderStampSuspension,
} from '@/db/schema'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'

export type WelderStampPayload = {
  id: number
  naksStamp: string
  welderName: string
  internalStamp: string
  weldType: string
  materialGroups: string
  diameterFrom: string
  diameterTo: string
  thicknessFrom: string
  thicknessTo: string
  validFrom: string
  validTo: string
  naksPermits: import('@/lib/welder-stamp-types').WelderStampNaksPermit[]
  dlsPermits: import('@/lib/welder-stamp-types').WelderStampDlsPermit[]
  archived: boolean
  archivedAt?: string
}

export type WelderStampSuspensionPayload = {
  id: number
  naksStamp: string
  suspendedFrom: string
  suspendedTo: string
}

const textOrNull = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

const parseJsonArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

const jsonOrNull = (value: unknown[]) => (value.length > 0 ? JSON.stringify(value) : null)

export const toWelderStampPayload = (row: WelderStamp): WelderStampPayload => ({
  id: row.id,
  naksStamp: row.naksStamp ?? '',
  welderName: row.welderName ?? '',
  internalStamp: row.internalStamp ?? '',
  weldType: row.weldType ?? '',
  materialGroups: row.materialGroups ?? '',
  diameterFrom: row.diameterFrom ?? '',
  diameterTo: row.diameterTo ?? '',
  thicknessFrom: row.thicknessFrom ?? '',
  thicknessTo: row.thicknessTo ?? '',
  validFrom: row.validFrom ?? '',
  validTo: row.validTo ?? '',
  naksPermits: parseJsonArray(row.naksPermits),
  dlsPermits: parseJsonArray(row.dlsPermits),
  archived: Boolean(row.archived),
  archivedAt: row.archivedAt ?? '',
})

const toDbInsert = (record: WelderStampPayload): NewWelderStamp => ({
  id: record.id,
  naksStamp: textOrNull(record.naksStamp),
  welderName: textOrNull(record.welderName),
  internalStamp: textOrNull(record.internalStamp),
  weldType: textOrNull(record.weldType),
  materialGroups: textOrNull(record.materialGroups),
  diameterFrom: textOrNull(record.diameterFrom),
  diameterTo: textOrNull(record.diameterTo),
  thicknessFrom: textOrNull(record.thicknessFrom),
  thicknessTo: textOrNull(record.thicknessTo),
  validFrom: textOrNull(record.validFrom),
  validTo: textOrNull(record.validTo),
  naksPermits: jsonOrNull(record.naksPermits),
  dlsPermits: jsonOrNull(record.dlsPermits),
  archived: Boolean(record.archived),
  archivedAt: textOrNull(record.archivedAt),
})

const suspensionToPayload = (row: WelderStampSuspension): WelderStampSuspensionPayload => ({
  id: row.id,
  naksStamp: row.naksStamp ?? '',
  suspendedFrom: row.suspendedFrom ?? '',
  suspendedTo: row.suspendedTo ?? '',
})

const suspensionToDbInsert = (record: WelderStampSuspensionPayload): NewWelderStampSuspension => ({
  id: record.id,
  naksStamp: String(record.naksStamp ?? '').trim(),
  suspendedFrom: String(record.suspendedFrom ?? '').trim(),
  suspendedTo: textOrNull(record.suspendedTo),
})

export const loadWelderStampRegistrySnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  const db = requireDb()
  const [stampRows, suspensionRows] = await Promise.all([
    db.select().from(welderStamps).orderBy(asc(welderStamps.id)),
    db.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
  ])
  return {
    stamps: stampRows.map(toWelderStampPayload),
    suspensions: suspensionRows.map(suspensionToPayload),
  }
})

export const saveWelderStampRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampPayload[] }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    return db.transaction(async (tx) => {
      await tx.delete(welderStamps)

      if (data.records.length === 0) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamps','id'), 1, false)`)
        await markDispatcherTaskIndexDirty(tx)
        return []
      }

      const rows = await tx.insert(welderStamps).values(data.records.map(toDbInsert)).returning()
      await tx.execute(
        sql`select setval(pg_get_serial_sequence('welder_stamps','id'), coalesce((select max(id) from welder_stamps), 1), true)`,
      )
      await markDispatcherTaskIndexDirty(tx)
      return rows.map(toWelderStampPayload)
    })
  })

export const saveWelderStampSuspensionRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampSuspensionPayload[] }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    return db.transaction(async (tx) => {
      await tx.delete(welderStampSuspensions)

      if (data.records.length === 0) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), 1, false)`)
        await markDispatcherTaskIndexDirty(tx)
        return []
      }

      const rows = await tx.insert(welderStampSuspensions).values(data.records.map(suspensionToDbInsert)).returning()
      await tx.execute(
        sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), coalesce((select max(id) from welder_stamp_suspensions), 1), true)`,
      )
      await markDispatcherTaskIndexDirty(tx)
      return rows.map(suspensionToPayload)
    })
  })
