import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FIELD_BY_KEY, calculateFinalStatus, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys, LNK_METHODS } from '@/lib/report-config'
import { normalizeEditableImportValue, normalizeExistingRequestImportValue } from '@/lib/report-import'
import { buildEditableImportUpdates, buildHeatTreatmentImportUpdates } from '@/lib/report-import-updates'
import { clearDisabledLnkRequests, isLnkRequestAllowedForRow, isLnkRequestField, withTouchedLnkTimestamp } from '@/lib/lnk-field-updates'
import { isExistingRowsImportLockedField, isMassFillFieldLocked, isSystemImportField } from '@/lib/report-import-template'
import { hasText } from '@/lib/report-value-utils'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import { deleteWeldJoint } from '@/server/welds'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldRow

type UseReportImportMutationsOptions = {
  rows: WeldRow[]
  heatTreatmentRows: RowWithId[]
  lnkRows: RowWithId[]
  pstoRequestOptions: string[]
  lnkRequestOptions: string[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: Array<{ id?: number }> | undefined, fieldKeys?: WeldFieldKey[]) => void
}

export function useReportImportMutations({
  rows,
  heatTreatmentRows,
  lnkRows,
  pstoRequestOptions,
  lnkRequestOptions,
  setMessage,
  highlightChangedRows,
}: UseReportImportMutationsOptions) {
  const queryClient = useQueryClient()

  const heatTreatmentImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildHeatTreatmentImportUpdates(
        records,
        heatTreatmentRows,
        rows,
        new Set(pstoRequestOptions),
      )
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      const savedRows = await updateWeldRowsOrThrow(updatedRows, 'Не удалось сохранить часть записей ПСТО')
      return {
        updated: savedRows.length,
        rows: savedRows as unknown as WeldRow[],
        changedFieldKeys: [...changedFieldKeys],
        matched,
        skipped,
      }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Обновлено ПСТО: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkImportMutation = useMutation({
    mutationFn: async (records: WeldInput[]) => {
      const { updatedRows, changedFieldKeys, matched, skipped } = buildEditableImportUpdates({
        importedRecords: records,
        targetRows: lnkRows,
        rows,
        editableFieldKeys: lnkEditableFieldKeys,
        normalizeValue: (fieldKey, value, currentRow) => {
          if (isLnkRequestField(fieldKey)) {
            if (!isLnkRequestAllowedForRow(currentRow, fieldKey)) return { skip: true, value: null }
            return normalizeExistingRequestImportValue(value, new Set(lnkRequestOptions))
          }
          return { skip: false, value: normalizeEditableImportValue(fieldKey, value) }
        },
        transformRow: (row) => {
          const nextRow = { ...row }
          for (const method of LNK_METHODS) {
            if (hasText(nextRow[method.resultKey]) && !hasText(nextRow[method.requestKey])) {
              nextRow[method.resultKey] = null
            }
          }
          const cleanedRow = clearDisabledLnkRequests(nextRow)
          const touchedRow = withTouchedLnkTimestamp(cleanedRow)
          return { ...touchedRow, finalStatus: calculateFinalStatus(touchedRow) }
        },
      })
      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys, matched, skipped }
      }

      const savedRows = await updateWeldRowsOrThrow(updatedRows, 'Не удалось сохранить часть записей ЛНК')
      return { updated: savedRows.length, rows: savedRows as unknown as WeldRow[], changedFieldKeys, matched, skipped }
    },
    onSuccess: async (result, variables) => {
      highlightChangedRows(result.rows, result.updated > 0 ? [...result.changedFieldKeys, 'lnkCreatedAt'] : result.changedFieldKeys)
      setMessage(`Обновлено ЛНК: ${result.updated} из ${variables.length}; пропущено: ${result.skipped}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const weldMassFillMutation = useMutation({
    mutationFn: async ({ records, skippedRows }: { records: ReportImportRecord[]; skippedRows: number }) => {
      const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(rows, records, 'massFill')

      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys: [...changedFieldKeys], skipped: records.length + skippedRows }
      }

      const savedRows = await updateWeldRowsOrThrow(updatedRows, 'Не удалось сохранить часть записей массового заполнения')
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
      const deleteRecords = records.filter((record) => record.deleteRequested && record.id)
      const updateRecords = records.filter((record) => !record.deleteRequested)
      const { updatedRows, changedFieldKeys } = buildExistingRowImportUpdates(rows, updateRecords, 'replaceData')

      const savedRows =
        updatedRows.length > 0
          ? await updateWeldRowsOrThrow(updatedRows, 'Не удалось сохранить часть записей замены данных')
          : []
      const deletedResults = await Promise.all(
        deleteRecords.map(async (record) => {
          if (!record.id) return null
          return deleteWeldJoint({ data: { id: record.id } })
        }),
      )
      const deleted = deletedResults.filter(Boolean).length

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
    heatTreatmentImportMutation,
    lnkImportMutation,
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
      if (!isDerivedWdi && mode === 'replaceData' && isSystemImportField('weldingJournal', field)) continue

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
