// This module is intentionally domain-scoped. Keep cross-domain rules in weld-server-shared.

import { requireDb } from '@/db'
import {
weldJoints
} from '@/db/schema'
import {
assertExistingRowsImportPayload,
} from '@/lib/existing-row-import-validation'
import {
getPstoLineIdentityKey
} from '@/lib/psto-line-assignment'
import { isSystemWdiMode } from '@/lib/wdi'
import {
type WeldInput
} from '@/lib/weld-fields'
import {
assertUniqueWeldMutationTargets,
assertWeldImportRowLimit,
WELD_IMPORT_MAX_ROWS
} from '@/lib/weld-import-limits'
import {
assertCurrentWeldRowVersions,
type WeldRowVersionTarget,
} from '@/lib/weld-row-version'
import { filterWeldRowsByColumns } from '@/lib/weld-table-filtering'
import {
ensureDispatcherTaskIndexFresh,
} from '@/server/dispatcher-task-index'
import {
markDispatcherTaskIndexDirty
} from '@/server/dispatcher-task-index-dirty'
import { attachHeatTreatmentControlRelations } from '@/server/heat-treatment-control-relations'
import { assertSecurityScope } from '@/server/security-functions'
import { loadControlProcessSettingsFromTransaction } from '@/server/control-process-settings'
import {
assertEarlyCoilDecisionRowsCanBeDeleted,
assertEarlyCoilDecisionSourcesRemainValid,
} from '@/server/early-coil-decision-guard'
import { assertJointChainIdentityChangesUseDedicatedMove } from '@/server/joint-chain-line-move-guard'
import {
removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction,
syncSystemDocumentsForWeldChangesInTransaction
} from '@/server/system-document-index'
import {
type SystemDocumentSequenceTransaction
} from '@/server/system-document-sequences'
import {
getWeldImportSecurityScope,
type WeldImportScopeRequest,
type WeldImportScopeResult,
type WeldPayload
} from '@/server/weld-contracts'
import {
loadPreviousWeldRows,
loadServerWeldValidationContext,
mergeWeldRecordsWithPrevious,
prepareServerWeldRecords,
validateServerWeldRecords
} from '@/server/weld-save-validation'
import { createServerFn } from '@tanstack/react-start'
import { asc,count,inArray,sql } from 'drizzle-orm'

import {
deleteEmptyGeneratedDocuments,
getDispatcherDirtyScopes,
insertWeldJointsInBatches,
updateWeldJointRows,
} from '@/server/weld-mutations'
import {
updateWeldJointsInBatches,
} from '@/server/weld-persistence'
import {
getChangedWeldLineMemberships,
haveSameWeldLineMemberships,
lockWeldLineMemberships,
} from '@/server/weld-line-membership-lock'
import {
applyCurrentSystemWdi,
buildWhere,
getColumnFilterOptionFilters,
hasDispatcherTaskServerFilter,
loadServerOtherSettings,
WELD_ROW_VERSION_SELECT,
WELD_TABLE_SELECT,
WELDING_JOURNAL_ORDER_BY,
} from '@/server/weld-server-shared'
import {
  compactWeldRowsForTransport,
  normalizeWeldImportScopeRequest,
} from '@/server/weld-request-utils'
import { CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES } from '@/lib/control-availability-values'

const CONTROL_ENABLED_VALUES_SQL = sql.join(
  CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.map((value) => sql`${value}`),
  sql`, `,
)

export const WELD_IMPORT_SCOPE_SELECT = WELD_TABLE_SELECT

export const listWeldingJournalImportScope = createServerFn({ method: 'GET' })
  .validator((data: WeldImportScopeRequest | undefined) => normalizeWeldImportScopeRequest(data))
  .handler(async ({ data }): Promise<WeldImportScopeResult> => {
    await assertSecurityScope('entry')
    if (hasDispatcherTaskServerFilter(data.columnFilters)) await ensureDispatcherTaskIndexFresh()
    const db = requireDb()
    const otherSettings = await loadServerOtherSettings()
    const fullyAssignedPstoLineKeys = await listFullyAssignedPstoLineKeys(db)
    const hasCurrentSystemWdiFilter = isSystemWdiMode(otherSettings) && Boolean(data.columnFilters.wdi?.trim())
    const sourceFilterData = hasCurrentSystemWdiFilter
      ? { ...data, columnFilters: getColumnFilterOptionFilters(data.columnFilters, 'wdi') }
      : data
    const where = buildWhere(sourceFilterData)

    if (hasCurrentSystemWdiFilter) {
      const sourceRows = await db
        .select(WELD_IMPORT_SCOPE_SELECT)
        .from(weldJoints)
        .where(where)
        .orderBy(...WELDING_JOURNAL_ORDER_BY)
      const rows = filterWeldRowsByColumns(
        applyCurrentSystemWdi(sourceRows, otherSettings),
        { wdi: data.columnFilters.wdi },
      )
      const hydratedRows = await attachHeatTreatmentControlRelations(rows)
      return rows.length > WELD_IMPORT_MAX_ROWS
        ? { rows: [], total: rows.length, limitExceeded: true, fullyAssignedPstoLineKeys }
        : {
            rows: compactWeldRowsForTransport(hydratedRows),
            total: rows.length,
            limitExceeded: false,
            fullyAssignedPstoLineKeys,
          }
    }

    const [{ total }] = await db.select({ total: count() }).from(weldJoints).where(where)
    const normalizedTotal = Number(total) || 0

    if (normalizedTotal > WELD_IMPORT_MAX_ROWS) {
      return { rows: [], total: normalizedTotal, limitExceeded: true, fullyAssignedPstoLineKeys }
    }

    const rows = await db
      .select(WELD_IMPORT_SCOPE_SELECT)
      .from(weldJoints)
      .where(where)
      .orderBy(...WELDING_JOURNAL_ORDER_BY)
    const hydratedRows = await attachHeatTreatmentControlRelations(rows)

    return {
      rows: compactWeldRowsForTransport(hydratedRows),
      total: normalizedTotal,
      limitExceeded: false,
      fullyAssignedPstoLineKeys,
    }
  })

export async function listFullyAssignedPstoLineKeys(db: ReturnType<typeof requireDb>) {
  const normalizedProjectTitle = sql<string>`lower(btrim(coalesce(${weldJoints.projectTitle}, '')))`
  const normalizedSubtitleCode = sql<string>`lower(btrim(coalesce(${weldJoints.subtitleCode}, '')))`
  const normalizedLine = sql<string>`lower(btrim(coalesce(${weldJoints.line}, '')))`
  const rows = await db
    .select({
      projectTitle: normalizedProjectTitle,
      subtitleCode: normalizedSubtitleCode,
      line: normalizedLine,
      rowCount: sql<number>`count(*)::int`,
      assignedCount: sql<number>`count(*) filter (where lower(btrim(coalesce(${weldJoints.pstoRequired}, ''))) in (${CONTROL_ENABLED_VALUES_SQL}))::int`,
    })
    .from(weldJoints)
    .where(sql`btrim(coalesce(${weldJoints.line}, '')) <> ''`)
    .groupBy(normalizedProjectTitle, normalizedSubtitleCode, normalizedLine)
  return rows.flatMap((row) => (
    Number(row.rowCount) > 0 && Number(row.assignedCount) === Number(row.rowCount)
      ? [getPstoLineIdentityKey(row)]
      : []
  ))
}

export const massFillWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; expectedVersions: WeldRowVersionTarget[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    expectedVersions: Array.isArray(data?.expectedVersions) ? data.expectedVersions : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope(getWeldImportSecurityScope('massFill'))
    assertWeldImportRowLimit(data.records.length)
    const updated = await updateWeldJointRows({
      records: data.records,
      expectedVersions: data.expectedVersions,
    }, true)
    return updated.map((row) => ({ id: row.id }))
  })

export const replaceWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldPayload[]; deleteIds: number[]; expectedVersions: WeldRowVersionTarget[] }) => ({
    records: Array.isArray(data?.records) ? data.records : [],
    deleteIds: [...new Set((data?.deleteIds ?? [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0))],
    expectedVersions: Array.isArray(data?.expectedVersions)
      ? data.expectedVersions.map((entry) => ({
          id: Number(entry?.id),
          version: String(entry?.version ?? '').trim(),
        }))
      : [],
  }))
  .handler(async ({ data }) => {
    await assertSecurityScope(getWeldImportSecurityScope('replaceData'))
    assertWeldImportRowLimit(data.records.length + data.deleteIds.length)
    const db = requireDb()
    return db.transaction(async (tx) => {
      await loadControlProcessSettingsFromTransaction(tx)
      if (data.records.some((record) => !record.id)) {
        throw new Error('Не передан id одной из заменяемых записей')
      }
      assertUniqueWeldMutationTargets(data.records, data.deleteIds)
      const targetIds = [
        ...data.records.map((record) => Number(record.id)),
        ...data.deleteIds,
      ].sort((left, right) => left - right)
      const identityRows = targetIds.length > 0
        ? await tx
            .select({
              id: weldJoints.id,
              projectTitle: weldJoints.projectTitle,
              subtitleCode: weldJoints.subtitleCode,
              line: weldJoints.line,
            })
            .from(weldJoints)
            .where(inArray(weldJoints.id, targetIds))
        : []
      const identityRowsById = new Map(identityRows.map((row) => [row.id, row]))
      const identityDrafts = data.records.map((record) => ({
        ...identityRowsById.get(Number(record.id)),
        ...record,
      }))
      await lockWeldLineMemberships(tx, [
        ...data.deleteIds.flatMap((id) => {
          const previous = identityRowsById.get(id)
          return previous ? [previous] : []
        }),
        ...identityDrafts.flatMap((record) => {
          const previous = identityRowsById.get(Number(record.id))
          return previous ? getChangedWeldLineMemberships(previous, record) : []
        }),
      ])
      await lockAndAssertWeldRowVersions(tx, targetIds, data.expectedVersions)

      const previousRows = await loadPreviousWeldRows(tx, data.records)
      const deletedRows = data.deleteIds.length > 0
        ? await tx.select().from(weldJoints).where(inArray(weldJoints.id, data.deleteIds))
        : []
      if (deletedRows.length !== data.deleteIds.length) {
        throw new Error('Одна или несколько удаляемых записей больше не существуют. Скачайте свежий шаблон.')
      }
      if (!haveSameWeldLineMemberships(identityRows, [
        ...previousRows.values(),
        ...deletedRows,
      ])) {
        throw new Error(
          'Один или несколько стыков были перенесены на другую линию другим пользователем. Ничего не изменено. Скачайте свежий шаблон и повторите импорт.',
        )
      }
      const deletedRowsById = new Map(deletedRows.map((row) => [row.id, row]))
      let records = data.records

      if (records.length > 0) {
        const validationContext = await loadServerWeldValidationContext(tx, [
          ...previousRows.values(),
          ...records,
        ])
        assertExistingRowsImportPayload({
          records,
          previousRows,
          mode: 'replaceData',
          otherSettings: validationContext.otherSettings,
        })
        records = mergeWeldRecordsWithPrevious(records, previousRows)
        await assertJointChainIdentityChangesUseDedicatedMove(
          tx,
          records,
          previousRows,
          validationContext.systemIndexSettings,
        )
        await assertEarlyCoilDecisionSourcesRemainValid(tx, records, previousRows)
        prepareServerWeldRecords({
          records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
        validateServerWeldRecords({
          records,
          previousRows,
          context: validationContext,
          importMode: true,
        })
      }

      if (data.deleteIds.length > 0) {
        await assertEarlyCoilDecisionRowsCanBeDeleted(tx, deletedRows)
      }
      const updated = await updateWeldJointsInBatches(tx, records, previousRows)

      if (data.deleteIds.length > 0) {
        await removeHeatTreatmentSourcedDocumentPositionsForWeldsInTransaction({
          tx,
          weldJointIds: data.deleteIds,
        })
        await tx.delete(weldJoints).where(inArray(weldJoints.id, data.deleteIds))
      }

      await syncSystemDocumentsForWeldChangesInTransaction(
        tx,
        updated,
        new Map([...previousRows, ...deletedRowsById]),
      )
      await deleteEmptyGeneratedDocuments(tx)

      const dirtyScopes = getDispatcherDirtyScopes(
        records,
        new Map([...previousRows, ...deletedRowsById]),
      )
      if (dirtyScopes.length > 0) {
        await markDispatcherTaskIndexDirty(tx, { scopes: dirtyScopes })
      }

      return {
        rows: updated.map((row) => ({ id: row.id })),
        deleted: deletedRows.length,
      }
    })
  })

export async function lockAndAssertWeldRowVersions(
  tx: SystemDocumentSequenceTransaction,
  targetIds: readonly number[],
  expectedVersions: readonly WeldRowVersionTarget[],
) {
  const currentVersions = targetIds.length > 0
    ? await tx
        .select({
          id: weldJoints.id,
          line: weldJoints.line,
          joint: weldJoints.joint,
          version: WELD_ROW_VERSION_SELECT,
        })
        .from(weldJoints)
        .where(inArray(weldJoints.id, [...targetIds]))
        .orderBy(asc(weldJoints.id))
        .for('update')
    : []

  assertCurrentWeldRowVersions({
    targetIds,
    expectedVersions,
    currentVersions,
  })
}

export const importWeldJoints = createServerFn({ method: 'POST' })
  .validator((data: { records: WeldInput[] }) => data)
  .handler(async ({ data }) => {
    await assertSecurityScope(getWeldImportSecurityScope('newRecords'))
    assertWeldImportRowLimit(data.records.length)
    if (data.records.length === 0) return { inserted: 0, rows: [] }
    const db = requireDb()

    return db.transaction(async (tx) => {
      const processSettings = await loadControlProcessSettingsFromTransaction(tx)
      await lockWeldLineMemberships(tx, data.records)
      const validationContext = await loadServerWeldValidationContext(tx, data.records)
      prepareServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
        importMode: true,
      })
      validateServerWeldRecords({
        records: data.records,
        previousRows: new Map(),
        context: validationContext,
        importMode: true,
      })
      const rows = await insertWeldJointsInBatches(tx, data.records, processSettings)
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
      await markDispatcherTaskIndexDirty(tx, { scopes: getDispatcherDirtyScopes(data.records, new Map()) })
      return { inserted: rows.length, rows: rows.map((row) => ({ id: row.id })) }
    })
  })

export { DATA_IMPORT_SECURITY_SCOPE } from '@/lib/security-scopes'
export { getWeldImportSecurityScope } from '@/server/weld-contracts'
export type { WeldImportScopeRequest,WeldImportScopeResult,WeldImportSecurityAction } from '@/server/weld-contracts'
