import { createServerFn } from '@tanstack/react-start'
import { asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { requireDb } from '@/db'
import {
  dispatcherAcceptedWarnings,
  dispatcherTaskIndexState,
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
import { formatDisplayDate } from '@/lib/date-format'
import { markDispatcherTaskIndexDirty } from '@/server/dispatcher-task-index-dirty'
import { assertSecurityScope } from '@/server/security-functions'
import {
  assertWelderStampSuspensionsReferenceRegistry,
  prepareWelderStampRecordsForPersistence,
  prepareWelderStampSuspensionsForPersistence,
} from '@/lib/welder-stamp-persistence-validation'
import { lockWelderStampRegistry } from '@/server/welder-stamp-registry-lock'
import { getWelderStampDispatcherImpact, getWelderStampSuspensionDispatcherImpact } from '@/lib/welder-stamp-dispatcher-impact'
import { loadBoundedDispatcherDirtyScopes, loadWelderStampDispatcherScopes, parseDispatcherDirtyScopes } from './dispatcher-dirty-scope-selection'
import { loadWelderQualificationImpactScopes } from './welder-qualification-impact'
import { DISPATCHER_INDEX_LOCK_ID, DISPATCHER_INDEX_STATE_ID } from './dispatcher-task-index-constants'
import type { DispatcherDirtyScope } from './dispatcher-task-index-dirty'
import type { SystemDocumentSequenceTransaction } from './system-document-sequences'

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

      const currentRecords = currentStampRows.map(toWelderStampPayload)
      await assertWelderStampArchiveDatesAreUnused(tx, currentRecords, preparedRecords)
      const impact = getWelderStampDispatcherImpact(currentRecords, preparedRecords)
      // A stale resubmission must still pass all revision/reference checks above.
      if (!impact.changed) return createRegistrySnapshot(currentStampRows, currentSuspensionRows)
      // Owner cascades/renames retain the conservative dependency path. The
      // exclusive registry lock stays held across profile reads and persistence.
      const qualificationScopes = impact.decisionOwnerIds.length ? null : await loadWelderQualificationImpactScopes(tx, {
        officialAliases: impact.officialAliases, before: currentRecords, after: preparedRecords,
        suspensions: currentSuspensionRows.map(suspensionToPayload),
      })
      const selectedScopes = qualificationScopes ?? await loadWelderStampDispatcherScopes(tx, impact.officialAliases, impact.decisionOwnerIds)
      const scopes = selectedScopes === null ? null : await loadBoundedDispatcherDirtyScopes(tx, selectedScopes)

      // Preserve object IDs and dependent decisions during ordinary edits. Only truly
      // removed registry objects may cascade-delete their accepted exceptions.
      await persistWelderStampObjects(tx, currentStampRows, preparedRecords)
      await markWelderRegistryDispatcherDirty(tx, scopes)
      const savedStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const savedSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })

/** Keep the generic derived cache invalidation, even for name-only changes:
 * statistics and line summaries include current registry labels. Inspect dirty
 * metadata under the index lock so corrupt state falls back to a full rebuild
 * instead of being interpreted as reminder-only (or failing a JSONB append).
 */
async function markWelderRegistryDispatcherDirty(tx: SystemDocumentSequenceTransaction, scopes: DispatcherDirtyScope[] | null) {
  await tx.execute(sql`select pg_advisory_xact_lock(${DISPATCHER_INDEX_LOCK_ID})`)
  const [state] = await tx.select({ dirtyScopes: dispatcherTaskIndexState.dirtyScopes, fullRebuild: dispatcherTaskIndexState.fullRebuild })
    .from(dispatcherTaskIndexState).where(eq(dispatcherTaskIndexState.id, DISPATCHER_INDEX_STATE_ID)).limit(1)
  const unsafe = state && parseDispatcherDirtyScopes(state.dirtyScopes, state.fullRebuild) === null
  await markDispatcherTaskIndexDirty(tx, { scopes: scopes ?? [], fullRebuild: scopes === null || Boolean(unsafe) })
}

/** Validation and registry lock belong to the caller. Retained IDs are never deleted/recreated. */
export async function persistWelderStampObjects(
  tx: import('./system-document-sequences').SystemDocumentSequenceTransaction,
  current: readonly WelderStamp[], records: readonly WelderStampPayload[],
) {
  const remaining = new Set(records.map(record => record.id))
  const removed = current.filter(record => !remaining.has(record.id)).map(record => record.id)
  if (removed.length) await tx.delete(welderStamps).where(inArray(welderStamps.id, removed))
  if (!records.length) return
  const before = new Map(current.map(record => [record.id, record]))
  const renamed = records.flatMap(record => {
    const old = before.get(record.id)
    const oldName = (old?.naksStamp ?? '').trim(), newName = record.naksStamp.trim()
    return old && oldName !== newName ? [{ id: record.id, oldName, newName,
      oldToken: ',' + JSON.stringify(oldName.toLocaleLowerCase('ru')) + ']', newToken: ',' + JSON.stringify(newName.toLocaleLowerCase('ru')) + ']' }] : []
  })
  const expiryPrefix = sql`'welder-stamp-expiry:' || split_part(decisions.key, ':', 2) || ':' || changes.id || ':'`
  if (renamed.length) await tx.execute(sql`update ${dispatcherAcceptedWarnings} as decisions set key = case
      when decisions.kind = 'percentage-line-control' then replace(decisions.key, changes.old_token, changes.new_token)
      else ${expiryPrefix} || changes.new_name || ':' || substring(decisions.key from length(${expiryPrefix} || changes.old_name || ':') + 1) end
    from unnest(${sql.param(renamed.map(change => change.id))}::integer[], ${sql.param(renamed.map(change => change.oldToken))}::text[], ${sql.param(renamed.map(change => change.newToken))}::text[],
      ${sql.param(renamed.map(change => change.oldName))}::text[], ${sql.param(renamed.map(change => change.newName))}::text[]) as changes(id, old_token, new_token, old_name, new_name)
    where decisions.welder_stamp_id = changes.id and (decisions.kind = 'percentage-line-control'
      or (decisions.kind = 'welder-stamp-expiry' and left(decisions.key, length(${expiryPrefix} || changes.old_name || ':')) = ${expiryPrefix} || changes.old_name || ':'))`)
  const updateSet = Object.fromEntries(Object.keys(toDbInsert(records[0])).filter(key => key !== 'id').map(key => [key,
    sql`excluded.${sql.identifier(welderStamps[key as keyof typeof welderStamps.$inferInsert].name)}`,
  ]))
  for (let offset = 0; offset < records.length; offset += 500) {
    await tx.insert(welderStamps).values(records.slice(offset, offset + 500).map(toDbInsert))
      .onConflictDoUpdate({ target: welderStamps.id, set: { ...updateSet, updatedAt: new Date() } })
  }
  await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamps','id'), greatest((select last_value from welder_stamps_id_seq), (select max(id) from welder_stamps)), true)`)
}

function getWelderStampAliasSet(
  records: readonly WelderStampAliasRecord[],
  fields: readonly (keyof WelderStampAliasRecord)[],
) {
  return new Set(records.flatMap((record) => fields
    .map((field) => normalizeStampForCompare(record[field]))
    .filter(Boolean)))
}

/** The exclusive registry lock serializes this check with weld saves/imports.
 * One bounded query for the changed archives, across every joint and both sets
 * of stamp fields. Unchanged legacy archives must not block unrelated edits.
 */
export async function assertWelderStampArchiveDatesAreUnused(
  tx: SystemDocumentSequenceTransaction,
  current: readonly WelderStampPayload[],
  next: readonly WelderStampPayload[],
) {
  const previous = new Map(current.map(record => [record.id, record]))
  const changed = next.filter(record => {
    if (!record.archived) return false
    const old = previous.get(record.id)
    return !old?.archived || old.archivedAt !== record.archivedAt ||
      normalizeStampForCompare(old.naksStamp) !== normalizeStampForCompare(record.naksStamp) ||
      normalizeStampForCompare(old.internalStamp) !== normalizeStampForCompare(record.internalStamp)
  })
  const aliases = changed.flatMap(record => [
    { stamp: normalizeStampForCompare(record.naksStamp), factual: false, date: record.archivedAt },
    ...[...new Set([record.naksStamp, record.internalStamp].map(normalizeStampForCompare))]
      .map(stamp => ({ stamp, factual: true, date: record.archivedAt })),
  ]).filter(entry => entry.stamp)
  if (!aliases.length) return
  const fields = [
    ...OFFICIAL_WELDER_STAMP_FIELD_KEYS.map(key => sql`(${weldJoints[key]}, false)`),
    ...FACTUAL_WELDER_STAMP_FIELD_KEYS.map(key => sql`(${weldJoints[key]}, true)`),
  ]
  const conflicts = await tx.execute<{ stamp: string; date: string; joint: string; weldDate: string }>(sql`
    with changed_archives as (
      select * from unnest(${sql.param(aliases.map(entry => entry.stamp))}::text[],
        ${sql.param(aliases.map(entry => entry.factual))}::boolean[],
        ${sql.param(aliases.map(entry => entry.date))}::date[]) as a(stamp, factual, date)
    )
    select a.stamp, a.date::text, ${weldJoints.joint} as joint, ${weldJoints.weldDate}::text as "weldDate"
    from ${weldJoints}
    cross join lateral (values ${sql.join(fields, sql`, `)}) as used(stamp, factual)
    join changed_archives a on a.factual = used.factual and a.stamp = upper(btrim(used.stamp))
    where ${weldJoints.weldDate} >= a.date
    limit 1
  `)
  const conflict = conflicts.rows[0]
  if (conflict) throw new Error(`Нельзя архивировать клеймо ${conflict.stamp} с ${formatDisplayDate(conflict.date)}: ` +
    `оно указано в стыке ${conflict.joint} с датой сварки ${formatDisplayDate(conflict.weldDate)}. ` +
    'Дата архивации должна быть позже дат сварки всех стыков с этим клеймом, включая официальные и фактические поля.')
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

      const impact = getWelderStampSuspensionDispatcherImpact(currentSuspensionRows.map(suspensionToPayload), preparedRecords)
      if (!impact.changed) return createRegistrySnapshot(currentStampRows, currentSuspensionRows)
      const selectedScopes = await loadWelderStampDispatcherScopes(tx, impact.officialAliases, [])
      const scopes = selectedScopes === null ? null : await loadBoundedDispatcherDirtyScopes(tx, selectedScopes)

      await tx.delete(welderStampSuspensions)

      if (preparedRecords.length === 0) {
        await tx.execute(sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), 1, false)`)
      } else {
        await tx.insert(welderStampSuspensions).values(preparedRecords.map(suspensionToDbInsert))
        await tx.execute(
          sql`select setval(pg_get_serial_sequence('welder_stamp_suspensions','id'), coalesce((select max(id) from welder_stamp_suspensions), 1), true)`,
        )
      }
      await markWelderRegistryDispatcherDirty(tx, scopes)
      const savedStampRows = await tx.select().from(welderStamps).orderBy(asc(welderStamps.id))
      const savedSuspensionRows = await tx.select().from(welderStampSuspensions).orderBy(asc(welderStampSuspensions.id))
      return createRegistrySnapshot(savedStampRows, savedSuspensionRows)
    })
  })
