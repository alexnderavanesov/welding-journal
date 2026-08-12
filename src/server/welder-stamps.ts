import { createServerFn } from '@tanstack/react-start'
import { asc, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
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
import { assertSecurityScope } from '@/server/security-functions'
import {
  assertWelderStampSuspensionsReferenceRegistry,
  prepareWelderStampRecordsForPersistence,
  prepareWelderStampSuspensionsForPersistence,
} from '@/lib/welder-stamp-persistence-validation'

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

export type WelderStampRegistrySnapshot = {
  stamps: WelderStampPayload[]
  suspensions: WelderStampSuspensionPayload[]
  revision: string
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

const createRegistrySnapshot = (
  stampRows: WelderStamp[],
  suspensionRows: WelderStampSuspension[],
): WelderStampRegistrySnapshot => {
  const stamps = stampRows.map(toWelderStampPayload)
  const suspensions = suspensionRows.map(suspensionToPayload)
  return {
    stamps,
    suspensions,
    revision: createHash('sha256').update(JSON.stringify({ stamps, suspensions })).digest('base64url'),
  }
}

const assertRegistryRevision = (actualRevision: string, expectedRevision?: string) => {
  if (expectedRevision && expectedRevision !== actualRevision) {
    throw new Error(
      'Справочник клейм уже изменён другим пользователем. Актуальные данные загружены заново; повторите изменение.',
    )
  }
}

export const loadWelderStampRegistrySnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  const [stampRows, suspensionRows] = await Promise.all([
    db.select().from(welderStamps).orderBy(asc(welderStamps.id)),
    db.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
  ])
  return createRegistrySnapshot(stampRows, suspensionRows)
})

export const saveWelderStampRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampPayload[]; expectedRevision?: string }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const preparedRecords = prepareWelderStampRecordsForPersistence(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('welder_stamp_registry'))`)
      const [currentStampRows, currentSuspensionRows] = await Promise.all([
        tx.select().from(welderStamps).orderBy(asc(welderStamps.id)),
        tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
      ])
      assertRegistryRevision(createRegistrySnapshot(currentStampRows, currentSuspensionRows).revision, data.expectedRevision)

      await tx.delete(welderStamps)

      if (preparedRecords.length === 0) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamps','id'), 1, false)`)
      } else {
        await tx.insert(welderStamps).values(preparedRecords.map(toDbInsert))
        await tx.execute(
          sql`select setval(pg_get_serial_sequence('welder_stamps','id'), coalesce((select max(id) from welder_stamps), 1), true)`,
        )
      }
      await markDispatcherTaskIndexDirty(tx)
      const [savedStampRows, savedSuspensionRows] = await Promise.all([
        tx.select().from(welderStamps).orderBy(asc(welderStamps.id)),
        tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
      ])
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })

export const saveWelderStampSuspensionRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampSuspensionPayload[]; expectedRevision?: string }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const preparedRecords = prepareWelderStampSuspensionsForPersistence(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('welder_stamp_registry'))`)
      const [currentStampRows, currentSuspensionRows] = await Promise.all([
        tx.select().from(welderStamps).orderBy(asc(welderStamps.id)),
        tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
      ])
      assertRegistryRevision(createRegistrySnapshot(currentStampRows, currentSuspensionRows).revision, data.expectedRevision)
      assertWelderStampSuspensionsReferenceRegistry(preparedRecords, currentStampRows.map(toWelderStampPayload))

      await tx.delete(welderStampSuspensions)

      if (preparedRecords.length === 0) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), 1, false)`)
      } else {
        await tx.insert(welderStampSuspensions).values(preparedRecords.map(suspensionToDbInsert))
        await tx.execute(
          sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), coalesce((select max(id) from welder_stamp_suspensions), 1), true)`,
        )
      }
      await markDispatcherTaskIndexDirty(tx)
      const [savedStampRows, savedSuspensionRows] = await Promise.all([
        tx.select().from(welderStamps).orderBy(asc(welderStamps.id)),
        tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id)),
      ])
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })
