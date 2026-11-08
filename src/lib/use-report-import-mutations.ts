import { useConfirmAction } from './confirm-action-context'
import { previewControlRequestRemoval } from '@/server/weld-mutations-api'
import { formatControlRequestRemovals } from './control-request-removal-preview'
import { CONTROL_ASSIGNMENT_FIELD_KEYS } from './control-availability-values'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FIELD_BY_KEY, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { massFillWeldRowsOrThrow, replaceWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { ReportImportRecord } from '@/lib/report-import-preview'
import { assertWeldImportRowLimit } from '@/lib/weld-import-limits'
import type { WeldRowVersionTarget } from '@/lib/weld-row-version'

type UseReportImportMutationsOptions = {
  setMessage: (value: string) => void
  highlightChangedRows: (rows: Array<{ id?: number }> | undefined, fieldKeys?: WeldFieldKey[]) => void
}

export function useReportImportMutations({
  setMessage,
  highlightChangedRows,
}: UseReportImportMutationsOptions) {
  const queryClient = useQueryClient()
  const confirm = useConfirmAction()
  async function confirmRequestRemoval(records: (WeldInput & { id: number })[], expectedVersions: WeldRowVersionTarget[], deleteIds: number[] = []) {
    if (!records.some(row => Object.keys(row).some(key => CONTROL_ASSIGNMENT_FIELD_KEYS.has(key)))) return undefined
    const ids = new Set([...records.map(row => row.id), ...deleteIds])
    const preview = await previewControlRequestRemoval({ data: { records, deleteIds, expectedVersions: expectedVersions.filter(target => ids.has(target.id)) } })
    if ((preview.removals.length || preview.hiddenRemovalCount) && !await confirm({ title: 'Сохранить изменения назначений?', description: formatControlRequestRemovals(preview.removals, preview.hiddenRemovalCount), confirmLabel: 'Подтвердить и сохранить', cancelLabel: 'Вернуться', tone: 'warning' })) {
      throw new Error('Сохранение отменено. Данные и заявки не изменены.')
    }
    return preview.token
  }

  const weldMassFillMutation = useMutation({
    mutationFn: async ({ records, skippedRows, expectedVersions }: {
      records: ReportImportRecord[]
      skippedRows: number
      expectedVersions: WeldRowVersionTarget[]
    }) => {
      assertWeldImportRowLimit(records.length)
      const { updatedRows, changedFieldKeys, invalidRecords } = buildExistingRowImportUpdates(records)

      if (updatedRows.length === 0) {
        return { updated: 0, rows: [], changedFieldKeys: [...changedFieldKeys], skipped: invalidRecords + skippedRows }
      }

      const removalToken = await confirmRequestRemoval(updatedRows, expectedVersions)
      const savedRows = await massFillWeldRowsOrThrow(
        updatedRows,
        expectedVersions,
        'Не удалось сохранить часть записей массового заполнения',
        removalToken,
      )
      return {
        updated: savedRows.length,
        rows: savedRows,
        changedFieldKeys: [...changedFieldKeys],
        skipped: skippedRows + invalidRecords + Math.max(0, updatedRows.length - savedRows.length),
      }
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Массовое заполнение: обновлено ${result.updated}; пропущено: ${result.skipped}`)
      scheduleWeldDataRefresh(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const weldReplaceDataMutation = useMutation({
    mutationFn: async ({ records, skippedRows, expectedVersions }: { records: ReportImportRecord[]; skippedRows: number; expectedVersions: WeldRowVersionTarget[] }) => {
      assertWeldImportRowLimit(records.length)
      const deleteRecords = records.filter((record) => record.deleteRequested && record.id)
      const updateRecords = records.filter((record) => !record.deleteRequested)
      const { updatedRows, changedFieldKeys, invalidRecords } = buildExistingRowImportUpdates(updateRecords)
      const removalToken = await confirmRequestRemoval(updatedRows, expectedVersions, deleteRecords.map(row => Number(row.id)))
      const replacement = await replaceWeldRowsOrThrow(
        updatedRows,
        deleteRecords.flatMap((record) => record.id ? [record.id] : []),
        expectedVersions,
        'Не удалось сохранить замену данных',
        removalToken,
      )
      const savedRows = replacement.rows
      const deleted = replacement.deleted

      if (savedRows.length === 0) {
        return { updated: 0, deleted, rows: [], changedFieldKeys: [...changedFieldKeys], skipped: invalidRecords + skippedRows }
      }

      return {
        updated: savedRows.length,
        deleted,
        rows: savedRows,
        changedFieldKeys: [...changedFieldKeys],
        skipped: skippedRows + invalidRecords + Math.max(0, updatedRows.length - savedRows.length),
      }
    },
    onSuccess: async (result) => {
      highlightChangedRows(result.rows, result.changedFieldKeys)
      setMessage(`Замена данных импортом: обновлено ${result.updated}; удалено ${result.deleted}; пропущено: ${result.skipped}`)
      scheduleWeldDataRefresh(queryClient)
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

export function buildExistingRowImportUpdates(records: ReportImportRecord[]) {
  const changedFieldKeys = new Set<WeldFieldKey>()
  const updatedRows = records.flatMap((record) => {
    const id = Number(record.id)
    if (!Number.isInteger(id) || id <= 0) return []
    const nextRow: WeldInput & { id: number } = { id }
    for (const [rawKey, value] of Object.entries(record)) {
      if (rawKey === 'id' || rawKey === 'deleteRequested') continue
      const field = FIELD_BY_KEY.get(rawKey as WeldFieldKey)
      if (!field) continue
      const key = field.key as WeldFieldKey
      nextRow[key] = value as never
      changedFieldKeys.add(key)
    }
    return Object.keys(nextRow).length > 1 ? [nextRow] : []
  })

  return { updatedRows, changedFieldKeys, invalidRecords: records.length - updatedRows.length }
}
