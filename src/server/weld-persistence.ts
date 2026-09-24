// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import {
weldJoints,
type NewWeldJoint,
type WeldJoint
} from '@/db/schema'
import {
clearCancelledRejectedLnkGeneratedData,
clearDisabledLnkRequests,
normalizeActiveLnkDefectDescriptions,
restoreActiveLnkCancelledResults,
withLnkFinalStatus,
} from '@/lib/lnk-field-updates'
import {
clearCancelledPstoRequestWithoutResult,
restoreActivePstoCancelledResult,
withPendingPstoResultStatus,
} from '@/lib/psto-field-updates'
import { hasHeatTreatmentReportState,hasLnkReportEntry,withPendingLnkResults } from '@/lib/report-control-state'
import { hasWeldDate,normalizeControlAvailabilityValue } from '@/lib/report-value-utils'
import { normalizeControlAvailabilityStorageText } from '@/lib/control-availability-values'
import {
isVirtualWeldField,
WELD_FIELDS,
type WeldFieldKey,
type WeldInput
} from '@/lib/weld-fields'
import { normalizeWeldInput } from '@/lib/weld-import-export'
import {
splitWeldImportInsertBatches
} from '@/lib/weld-import-limits'
import { calculateFinalStatus } from '@/lib/weld-status'
import {
type SystemDocumentSequenceTransaction
} from '@/server/system-document-sequences'
import { buildNumberArrayMatch } from '@/server/weld-request-utils'
import { sql,type SQL } from 'drizzle-orm'

import {
WELD_TABLE_COLUMNS,
WELD_TABLE_RETURNING,
} from '@/server/weld-server-shared'
export { WELD_TABLE_RETURNING }
import {
  LNK_PROFILE_FIELD_KEYS,
  PSTO_PROFILE_FIELD_KEYS,
  SYSTEM_FIELD_KEYS,
  WELDING_PROFILE_FIELD_KEYS,
} from '@/server/weld-mutation-policy'

export const WELD_BATCH_PROFILE_TIMESTAMP_KEYS = [
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'updatedAt',
] as const satisfies readonly (keyof NewWeldJoint)[]

export const WELD_BATCH_UPDATE_FIELD_KEYS = [
  ...WELD_FIELDS
    .filter((field) => !isVirtualWeldField(field) && !SYSTEM_FIELD_KEYS.has(field.key))
    .map((field) => field.key),
  'pstoRequired',
  'pstoControlBasis',
  'pstoCancellationDate',
  ...WELD_BATCH_PROFILE_TIMESTAMP_KEYS,
] as readonly (keyof NewWeldJoint)[]

export const WELD_BATCH_UPDATE_COLUMNS = WELD_BATCH_UPDATE_FIELD_KEYS.map((fieldKey) => [
  fieldKey,
  WELD_TABLE_COLUMNS[fieldKey],
] as const)

export const WELD_BATCH_UPDATE_SET = Object.fromEntries(
  WELD_BATCH_UPDATE_COLUMNS.map(([fieldKey, column]) => [fieldKey, sql.raw(`excluded."${column.name}"`)]),
) as Partial<Record<keyof NewWeldJoint, SQL>>

export function prepareWeldInputForPersistence(input: WeldInput) {
  const normalized = prepareServerWeldInput(normalizeWeldInput(input))
  normalized.finalStatus = calculateFinalStatus({ ...input, ...normalized })
  return normalized
}

export function toDbInsert(input: WeldInput, isCreate = false): NewWeldJoint {
  const normalized = prepareWeldInputForPersistence(input)
  const data: Record<string, unknown> = {}

  for (const field of WELD_FIELDS) {
    if (SYSTEM_FIELD_KEYS.has(field.key)) continue
    if (field.kind === 'boolean') {
      data[field.key] = normalizeControlAvailabilityValue(normalized[field.key])
      continue
    }
    data[field.key] = normalized[field.key] ?? null
  }
  data.pstoRequired = normalizeControlAvailabilityStorageText(normalized.pstoRequired)
  data.pstoControlBasis = normalized.pstoControlBasis ?? null
  data.pstoCancellationDate = normalized.pstoCancellationDate ?? null
  if (isCreate) {
    const now = new Date()
    data.weldingUpdatedAt = now
    if (hasPstoReportEntry(normalized)) {
      data.pstoCreatedAt = now
      data.pstoUpdatedAt = now
    }
    if (hasLnkReportEntry(normalized)) {
      data.lnkCreatedAt = now
      data.lnkUpdatedAt = now
    }
  }

  return data as NewWeldJoint
}

export function getProfileTimestampUpdates(
  record: WeldInput,
  previous: WeldJoint | undefined,
  now: Date,
): Partial<NewWeldJoint> {
  const lnkTouched = hasProfileChanged(record, previous, LNK_PROFILE_FIELD_KEYS)
  const pstoTouched = hasProfileChanged(record, previous, PSTO_PROFILE_FIELD_KEYS)
  const weldingTouched = hasProfileChanged(record, previous, WELDING_PROFILE_FIELD_KEYS)
  const lnkEntered = !hasLnkReportEntry(previous ?? {}) && hasLnkReportEntry(record)
  const pstoEntered = !hasPstoReportEntry(previous ?? {}) && hasPstoReportEntry(record)
  const updates: Partial<NewWeldJoint> = {}

  if (weldingTouched) updates.weldingUpdatedAt = now
  if (lnkTouched || lnkEntered) {
    if (!previous?.lnkCreatedAt && (lnkEntered || hasLnkReportEntry(previous ?? {}))) updates.lnkCreatedAt = now
    updates.lnkUpdatedAt = now
  }
  if (pstoTouched || pstoEntered) {
    if (!previous?.pstoCreatedAt && (pstoEntered || hasPstoReportEntry(previous ?? {}))) updates.pstoCreatedAt = now
    updates.pstoUpdatedAt = now
  }

  return updates
}

export function hasPstoReportEntry(record: WeldInput) {
  return hasWeldDate(record) && hasHeatTreatmentReportState(record)
}

export function hasProfileChanged(
  record: WeldInput,
  previous: WeldJoint | undefined,
  fieldKeys: ReadonlySet<WeldFieldKey> | readonly WeldFieldKey[],
) {
  if (!previous) return true
  return [...fieldKeys].some(
    (fieldKey) => normalizeProfileValue(record[fieldKey]) !== normalizeProfileValue(previous[fieldKey as keyof WeldJoint]),
  )
}

export function normalizeProfileValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

export async function updateWeldJointsInBatches(
  tx: SystemDocumentSequenceTransaction,
  records: readonly WeldInput[],
  previousRows: ReadonlyMap<number, WeldJoint>,
) {
  if (records.length === 0) return []
  const now = new Date()
  const payloads = records.map((record) => buildWeldBatchUpdatePayload(record, previousRows, now))
  const ids = records.map((record) => Number(record.id))
  const lockedRows = await tx
    .select({ id: weldJoints.id })
    .from(weldJoints)
    .where(buildNumberArrayMatch(
      weldJoints.id,
      [...ids].sort((left, right) => left - right),
    ))
    .orderBy(weldJoints.id)
    .for('update')
  if (lockedRows.length !== ids.length) {
    throw new Error('Одна или несколько обновляемых записей больше не существуют.')
  }
  const updatedRows: WeldJoint[] = []

  for (const batch of splitWeldImportInsertBatches(payloads)) {
    const rows = await tx
      .insert(weldJoints)
      .values(batch)
      .onConflictDoUpdate({ target: weldJoints.id, set: WELD_BATCH_UPDATE_SET })
      .returning(WELD_TABLE_RETURNING)
    if (rows.length !== batch.length) {
      throw new Error('Одна или несколько обновляемых записей больше не существуют.')
    }
    updatedRows.push(...rows)
  }

  const updatedRowsById = new Map(updatedRows.map((row) => [row.id, row]))
  return ids.map((id) => {
    const row = updatedRowsById.get(id)
    if (!row) throw new Error(`Запись ${id} не найдена`)
    return row
  })
}

export function buildWeldBatchUpdatePayload(
  record: WeldInput,
  previousRows: ReadonlyMap<number, WeldJoint>,
  now: Date,
) {
  const id = Number(record.id)
  const previous = previousRows.get(id)
  if (!previous) throw new Error(`Запись ${id} не найдена`)
  const timestampUpdates = getProfileTimestampUpdates(record, previous, now)
  const values: Record<string, unknown> = {
    id,
    ...toDbInsert(record),
    weldingUpdatedAt: timestampUpdates.weldingUpdatedAt ?? previous.weldingUpdatedAt,
    pstoCreatedAt: timestampUpdates.pstoCreatedAt ?? previous.pstoCreatedAt,
    pstoUpdatedAt: timestampUpdates.pstoUpdatedAt ?? previous.pstoUpdatedAt,
    lnkCreatedAt: timestampUpdates.lnkCreatedAt ?? previous.lnkCreatedAt,
    lnkUpdatedAt: timestampUpdates.lnkUpdatedAt ?? previous.lnkUpdatedAt,
    updatedAt: now,
  }

  return Object.fromEntries([
    ['id', id],
    ...WELD_BATCH_UPDATE_COLUMNS.map(([fieldKey]) => [fieldKey, values[fieldKey] ?? null]),
  ]) as NewWeldJoint
}

export function prepareServerWeldInput<T extends WeldInput>(record: T): T {
  return withLnkFinalStatus(
    normalizeActiveLnkDefectDescriptions(
      withPendingPstoResultStatus(
        withPendingLnkResults(
          clearDisabledLnkRequests(
            restoreActiveLnkCancelledResults(
              restoreActivePstoCancelledResult(clearCancelledRejectedLnkGeneratedData(clearCancelledPstoRequestWithoutResult(record))),
            ),
          ),
        ),
      ),
    ),
  )
}
