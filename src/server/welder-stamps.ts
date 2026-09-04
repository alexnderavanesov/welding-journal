import { createServerFn } from '@tanstack/react-start'
import { asc, inArray, or, sql, type SQL } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { requireDb } from '@/db'
import {
  welderStampSuspensions,
  welderStamps,
  weldJoints,
  type NewWelderStamp,
  type NewWelderStampSuspension,
  type WelderStamp,
  type WelderStampSuspension,
} from '@/db/schema'
import {
  FACTUAL_WELDER_STAMP_FIELD_KEYS,
  OFFICIAL_WELDER_STAMP_FIELD_KEYS,
} from '@/lib/report-common-config'
import { normalizeStampForCompare } from '@/lib/welder-stamp-compatibility-utils'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import {
  assertWelderStampSuspensionsReferenceRegistry,
  prepareWelderStampRecordsForPersistence,
  prepareWelderStampSuspensionsForPersistence,
} from '@/lib/welder-stamp-persistence-validation'
import { lockWelderStampRegistry } from '@/server/welder-stamp-registry-lock'

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

export const assertRegistryRevision = (actualRevision: string, expectedRevision: string) => {
  if (!expectedRevision || expectedRevision !== actualRevision) {
    throw new Error(
      'Справочник клейм уже изменён другим пользователем. Актуальные данные загружены заново; повторите изменение.',
    )
  }
}

type WelderStampAliasRecord = {
  naksStamp?: string | null
  internalStamp?: string | null
}

export function getRemovedWelderStampReferenceAliases(
  currentRecords: readonly WelderStampAliasRecord[],
  nextRecords: readonly WelderStampAliasRecord[],
) {
  const currentOfficial = getWelderStampAliasSet(currentRecords, ['naksStamp'])
  const nextOfficial = getWelderStampAliasSet(nextRecords, ['naksStamp'])
  const currentFactual = getWelderStampAliasSet(currentRecords, ['naksStamp', 'internalStamp'])
  const nextFactual = getWelderStampAliasSet(nextRecords, ['naksStamp', 'internalStamp'])

  return {
    official: [...currentOfficial].filter((alias) => !nextOfficial.has(alias)).sort(),
    factual: [...currentFactual].filter((alias) => !nextFactual.has(alias)).sort(),
  }
}

export const loadWelderStampRegistrySnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  await assertSecurityScope('entry')
  const db = requireDb()
  return db.transaction(async (tx) => {
    await lockWelderStampRegistry(tx)
    const stampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
    const suspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
    return createRegistrySnapshot(stampRows, suspensionRows)
  })
})

export const saveWelderStampRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampPayload[]; expectedRevision: string }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    expectedRevision: String(data?.expectedRevision ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const preparedRecords = prepareWelderStampRecordsForPersistence(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await lockWelderStampRegistry(tx, 'exclusive')
      const currentStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const currentSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
      assertRegistryRevision(createRegistrySnapshot(currentStampRows, currentSuspensionRows).revision, data.expectedRevision)
      assertWelderStampSuspensionsReferenceRegistry(
        currentSuspensionRows.map(suspensionToPayload),
        preparedRecords,
      )
      await assertRemovedWelderStampAliasesAreUnused(tx, currentStampRows, preparedRecords)

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
      const savedStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const savedSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })

function getWelderStampAliasSet(
  records: readonly WelderStampAliasRecord[],
  fields: readonly (keyof WelderStampAliasRecord)[],
) {
  return new Set(records.flatMap((record) => fields
    .map((field) => normalizeStampForCompare(record[field]))
    .filter(Boolean)))
}

async function assertRemovedWelderStampAliasesAreUnused(
  tx: Parameters<Parameters<ReturnType<typeof requireDb>['transaction']>[0]>[0],
  currentRecords: readonly WelderStampAliasRecord[],
  nextRecords: readonly WelderStampAliasRecord[],
) {
  const removed = getRemovedWelderStampReferenceAliases(currentRecords, nextRecords)
  const conditions: SQL[] = []

  for (const fieldKey of OFFICIAL_WELDER_STAMP_FIELD_KEYS) {
    if (removed.official.length === 0) break
    conditions.push(inArray(
      sql<string>`upper(btrim(coalesce(${weldJoints[fieldKey]}, '')))`,
      removed.official,
    ))
  }
  for (const fieldKey of FACTUAL_WELDER_STAMP_FIELD_KEYS) {
    if (removed.factual.length === 0) break
    conditions.push(inArray(
      sql<string>`upper(btrim(coalesce(${weldJoints[fieldKey]}, '')))`,
      removed.factual,
    ))
  }
  if (conditions.length === 0) return

  const references = await tx
    .select({ id: weldJoints.id, joint: weldJoints.joint })
    .from(weldJoints)
    .where(or(...conditions))
    .orderBy(asc(weldJoints.id))
    .limit(4)
  if (references.length === 0) return

  const aliases = [...new Set([...removed.official, ...removed.factual])]
  const joints = references.slice(0, 3).map((row) => String(row.joint ?? '').trim() || `#${row.id}`)
  throw new Error(
    `Нельзя удалить или переименовать клеймо ${aliases.slice(0, 3).join(', ')}: ` +
    `оно уже используется в стыках ${joints.join(', ')}${references.length > 3 ? ' и других' : ''}. ` +
    'Чтобы сохранить историю, отправьте карточку клейма в архив.',
  )
}

export const saveWelderStampSuspensionRecords = createServerFn({ method: 'POST' })
  .validator((data: { records: WelderStampSuspensionPayload[]; expectedRevision: string }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    expectedRevision: String(data?.expectedRevision ?? '').trim(),
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope('settings')
    const preparedRecords = prepareWelderStampSuspensionsForPersistence(data.records)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await lockWelderStampRegistry(tx, 'exclusive')
      const currentStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const currentSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
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
      const savedStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const savedSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })
