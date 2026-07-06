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

export type WelderStampPayload = {
  id: number
  naksStamp: string
  internalStamp: string
  weldType: string
  diameterFrom: string
  diameterTo: string
  validFrom: string
  validTo: string
  archived: boolean
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

const toPayload = (row: WelderStamp): WelderStampPayload => ({
  id: row.id,
  naksStamp: row.naksStamp ?? '',
  internalStamp: row.internalStamp ?? '',
  weldType: row.weldType ?? '',
  diameterFrom: row.diameterFrom ?? '',
  diameterTo: row.diameterTo ?? '',
  validFrom: row.validFrom ?? '',
  validTo: row.validTo ?? '',
  archived: Boolean(row.archived),
})

const toDbInsert = (record: WelderStampPayload): NewWelderStamp => ({
  id: record.id,
  naksStamp: textOrNull(record.naksStamp),
  internalStamp: textOrNull(record.internalStamp),
  weldType: textOrNull(record.weldType),
  diameterFrom: textOrNull(record.diameterFrom),
  diameterTo: textOrNull(record.diameterTo),
  validFrom: textOrNull(record.validFrom),
  validTo: textOrNull(record.validTo),
  archived: Boolean(record.archived),
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

export const listWelderStampRecords = createServerFn({ method: 'GET' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(welderStamps).orderBy(asc(welderStamps.id))
  return rows.map(toPayload)
})

export const saveWelderStampRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampPayload[] }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    await db.delete(welderStamps)

    if (data.records.length === 0) {
      await db.execute(sql`select setval(pg_get_serial_sequence('welder_stamps','id'), 1, false)`)
      return []
    }

    const rows = await db.insert(welderStamps).values(data.records.map(toDbInsert)).returning()
    await db.execute(
      sql`select setval(pg_get_serial_sequence('welder_stamps','id'), coalesce((select max(id) from welder_stamps), 1), true)`,
    )
    return rows.map(toPayload)
  })

export const listWelderStampSuspensionRecords = createServerFn({ method: 'GET' }).handler(async () => {
  const db = requireDb()
  const rows = await db.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
  return rows.map(suspensionToPayload)
})

export const saveWelderStampSuspensionRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampSuspensionPayload[] }) => data)
  .handler(async ({ data }) => {
    const db = requireDb()
    await db.delete(welderStampSuspensions)

    if (data.records.length === 0) {
      await db.execute(sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), 1, false)`)
      return []
    }

    const rows = await db.insert(welderStampSuspensions).values(data.records.map(suspensionToDbInsert)).returning()
    await db.execute(
      sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), coalesce((select max(id) from welder_stamp_suspensions), 1), true)`,
    )
    return rows.map(suspensionToPayload)
  })
