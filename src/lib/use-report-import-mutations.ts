import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FIELD_BY_KEY, calculateFinalStatus, type WeldFieldKey } from '@/lib/weld-fields'
import { assertNoLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { assertNoLnkRepairRuleIssues, getRowsWithChangedLnkRepairRuleInputs } from '@/lib/lnk-result-rules'
import { assertNoPstoChronologyIssues } from '@/lib/psto-chronology-checks'
import { isExistingRowsImportLockedField, isMassFillFieldLocked, isSystemImportField } from '@/lib/report-import-template'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { replaceWeldRowsOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import { parseDateLikeToIso } from '@/lib/date-format'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import type { WeldRow } from '@/lib/dispatcher-types'
import { assertWeldImportRowLimit } from '@/lib/weld-import-limits'

type UseReportImportMutationsOptions = {
  rows: WeldRow[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: Array<{ id?: number }> | undefined, fieldKeys?: WeldFieldKey[]) => void
}

export function useReportImportMutations({
  rows,
  setMessage,
  highlightChangedRows,
}: UseReportImportMutationsOptions) {
  const queryClient = useQueryClient()

  const weldMassFillMutation = useMutation({
    mutationFn: async ({ records, skippedRows }: { records: ReportImportRecord[]; skippedRows: number }) => {
      assertWeldImportRowLimit(records.length)
      const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(rows, records, 'massFill')

      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys: [...changedFieldKeys], skipped: records.length + skippedRows }
      }
      const saveCheckSettings = loadSaveCheckSettings()
      const chronologyRows = getRowsWithChangedWeldDate(updatedRows, rows)
      assertNoLnkRepairRuleIssues(getRowsWithChangedLnkRepairRuleInputs(updatedRows, rows), saveCheckSettings)
      assertNoLnkChronologyIssues(chronologyRows, saveCheckSettings)
      assertNoPstoChronologyIssues(chronologyRows, saveCheckSettings)

      const savedRows = await updateWeldRowsOrThrow(
        updatedRows,
        'Не удалось сохранить часть записей массового заполнения',
        { importOperation: 'massFill' },
      )
      return {
        updated: savedRows.length,
        rows: savedRows as unknown as WeldRow[],
        changedFieldKeys: [...changedFieldKeys],
        skipped: skippedRows + Math.max(0, records.length - savedRows.length),
      }
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Массовое заполнение: обновлено ${result.updated}; пропущено: ${result.skipped}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const weldReplaceDataMutation = useMutation({
    mutationFn: async ({ records, skippedRows }: { records: ReportImportRecord[]; skippedRows: number }) => {
      assertWeldImportRowLimit(records.length)
      const deleteRecords = records.filter((record) => record.deleteRequested && record.id)
      const updateRecords = records.filter((record) => !record.deleteRequested)
      const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(rows, updateRecords, 'replaceData')

      if (updatedRows.length > 0) {
        const saveCheckSettings = loadSaveCheckSettings()
        const chronologyRows = getRowsWithChangedWeldDate(updatedRows, rows)
        assertNoLnkRepairRuleIssues(getRowsWithChangedLnkRepairRuleInputs(updatedRows, rows), saveCheckSettings)
        assertNoLnkChronologyIssues(chronologyRows, saveCheckSettings)
        assertNoPstoChronologyIssues(chronologyRows, saveCheckSettings)
      }
      const replacement = await replaceWeldRowsOrThrow(
        updatedRows,
        deleteRecords.flatMap((record) => record.id ? [record.id] : []),
        'Не удалось сохранить замену данных',
      )
      const savedRows = replacement.rows
      const deleted = replacement.deleted

      if (savedRows.length === 0) {
        return { updated: 0, deleted, rows: [], changedFieldKeys: [...changedFieldKeys], skipped: updateRecords.length + skippedRows }
      }

      return {
        updated: savedRows.length,
        deleted,
        rows: savedRows as unknown as WeldRow[],
        changedFieldKeys: [...changedFieldKeys],
        skipped: skippedRows + Math.max(0, updateRecords.length - savedRows.length),
      }
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Замена данных импортом: обновлено ${result.updated}; удалено ${result.deleted}; пропущено: ${result.skipped}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    weldMassFillMutation,
    weldReplaceDataMutation,
  }
}

export function buildExistingRowImportUpdates(rows: WeldRow[], records: ReportImportRecord[], mode: 'massFill' | 'replaceData') {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const changedFieldKeys = new Set<WeldFieldKey>()
  const updatedRows = records.flatMap((record) => {
    if (!record.id) return []
    const currentRow = rowsById.get(record.id)
    if (!currentRow) return []

    let hasChanges = false
    const nextRow = { ...currentRow } as WeldRow
    for (const [rawKey, value] of Object.entries(record)) {
      if (rawKey === 'id' || rawKey === 'deleteRequested') continue
      const field = FIELD_BY_KEY.get(rawKey as WeldFieldKey)
      if (!field) continue
      const isDerivedWdi = field.key === 'wdi' && isDerivedSystemWdiUpdate(record)
      if (!isDerivedWdi && isExistingRowsImportLockedField(field)) continue
      if (!isDerivedWdi && mode === 'massFill' && isMassFillFieldLocked('weldingJournal', field, currentRow)) continue
      if (!isDerivedWdi && mode === 'replaceData' && isSystemImportField('weldingJournal', field, currentRow)) continue

      const key = field.key as WeldFieldKey
      if (normalizeChangedValue(value) === normalizeChangedValue(currentRow[key])) continue
      nextRow[key] = value as never
      hasChanges = true
      changedFieldKeys.add(key)
    }

    if (!hasChanges) return []
    const rowWithStatus = { ...nextRow, finalStatus: calculateFinalStatus(nextRow) }
    if (normalizeChangedValue(rowWithStatus.finalStatus) !== normalizeChangedValue(currentRow.finalStatus)) {
      changedFieldKeys.add('finalStatus')
    }
    return [rowWithStatus]
  })

  return { updatedRows, changedFieldKeys }
}

function isDerivedSystemWdiUpdate(record: ReportImportRecord) {
  return ['d1', 'd2', 't1', 't2'].some((fieldKey) => Object.prototype.hasOwnProperty.call(record, fieldKey))
}

function normalizeChangedValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value.trim() : value
}

function getRowsWithChangedWeldDate(updatedRows: WeldRow[], rows: WeldRow[]) {
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  return updatedRows.filter((row) => {
    const previousRow = rowsById.get(row.id)
    if (!previousRow) return true
    return normalizeDateForChronology(row.weldDate) !== normalizeDateForChronology(previousRow.weldDate)
  })
}

function normalizeDateForChronology(value: unknown) {
  return parseDateLikeToIso(value) ?? String(value ?? '').trim()
}
