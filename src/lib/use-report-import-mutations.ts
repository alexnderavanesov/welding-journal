import { useMutation, useQueryClient } from '@tanstack/react-query'
import { calculateFinalStatus, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { LNK_EDITABLE_FIELD_KEYS as lnkEditableFieldKeys, LNK_METHODS } from '@/lib/report-config'
import { normalizeEditableImportValue, normalizeExistingRequestImportValue } from '@/lib/report-import'
import { buildEditableImportUpdates, buildHeatTreatmentImportUpdates } from '@/lib/report-import-updates'
import { clearDisabledLnkRequests, isLnkRequestAllowedForRow, isLnkRequestField, withTouchedLnkTimestamp } from '@/lib/lnk-field-updates'
import { hasText } from '@/lib/report-value-utils'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldInput & { id: number }

type UseReportImportMutationsOptions = {
  rows: WeldRow[]
  heatTreatmentRows: RowWithId[]
  lnkRows: RowWithId[]
  pstoRequestOptions: string[]
  lnkRequestOptions: string[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: WeldRow[], fieldKeys?: WeldFieldKey[]) => void
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
        changedFieldKeys,
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

  return {
    heatTreatmentImportMutation,
    lnkImportMutation,
  }
}
