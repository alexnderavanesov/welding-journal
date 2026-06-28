import type { Dispatch, SetStateAction } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  clearLnkGeneratedWeldData,
  updateWeldJoint,
} from '@/server/welds'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'
import {
  LNK_EMPTY_RESULT_VALUE,
  LNK_GENERATED_FIELD_KEYS as lnkGeneratedFieldKeys,
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
  LNK_RESULT_OPTIONS,
} from '@/lib/report-config'
import {
  getLnkMethodByRequestKey,
  getLnkMethodByResultKey,
  hasRejectedLnkResult,
} from '@/lib/lnk-status'
import {
  applyLnkFieldUpdate,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  isLnkRequestField,
  withTouchedLnkTimestamp,
} from '@/lib/lnk-field-updates'
import {
  getLnkRepairForbiddenReason,
  isLnkRepairForbidden,
} from '@/lib/lnk-result-rules'
import {
  getManagedLnkResultChangeKey,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import {
  createDefaultLnkOfficialityDraft,
  createDefaultLnkResultDraft,
  type LnkOfficialityDraftState,
  type LnkRequestDraftState,
  type LnkResultDraftState,
} from '@/lib/report-draft-state'
import {
  defaultRequestNamingState,
  type RequestNamingState,
} from '@/lib/request-naming-state'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import {
  hasText,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import {
  calculateFinalStatus,
  type WeldFieldKey,
  type WeldInput,
} from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'

type RowWithId = WeldInput & { id: number }

type ManagedLnkResultPreviewState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  result: string
} | null

type ManagedLnkResultChangeHintState = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  from: string
  to: string
} | null

type UseLnkReportMutationsOptions = {
  lnkRows: RowWithId[]
  lnkRequestOptions: string[]
  setMessage: (value: string) => void
  highlightChangedRows: (rows: WeldRow[], fieldKeys?: WeldFieldKey[]) => void
  setSelectedLnkIds: (value: Set<number>) => void
  setLnkRequestDraft: Dispatch<SetStateAction<LnkRequestDraftState>>
  setLnkRequestNaming: (value: RequestNamingState) => void
  setIsLnkRequestModalOpen: (value: boolean) => void
  setManagedLnkRequestName: (value: string) => void
  setManagedLnkRequestNameDraft: (value: string) => void
  setIsLnkRequestManagerOpen: (value: boolean) => void
  setIsLnkResultModalOpen: (value: boolean) => void
  setLnkResultDraft: Dispatch<SetStateAction<LnkResultDraftState>>
  setLnkOfficialityDraft: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  setIsLnkOfficialityModalOpen: (value: boolean) => void
  resetDismissedRepeatedJointTasks: () => void
  setManagedLnkPendingResultChanges: Dispatch<SetStateAction<Record<string, string>>>
  setManagedLnkResultChangeHint: (value: ManagedLnkResultChangeHintState) => void
  setManagedLnkResultPreview: (value: ManagedLnkResultPreviewState) => void
  setHeatTreatmentFieldEditing: (value: HeatTreatmentFieldEditingState | null) => void
}

export function useLnkReportMutations({
  lnkRows,
  lnkRequestOptions,
  setMessage,
  highlightChangedRows,
  setSelectedLnkIds,
  setLnkRequestDraft,
  setLnkRequestNaming,
  setIsLnkRequestModalOpen,
  setManagedLnkRequestName,
  setManagedLnkRequestNameDraft,
  setIsLnkRequestManagerOpen,
  setIsLnkResultModalOpen,
  setLnkResultDraft,
  setLnkOfficialityDraft,
  setIsLnkOfficialityModalOpen,
  resetDismissedRepeatedJointTasks,
  setManagedLnkPendingResultChanges,
  setManagedLnkResultChangeHint,
  setManagedLnkResultPreview,
  setHeatTreatmentFieldEditing,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  const lnkRequestMutation = useMutation({
    mutationFn: async ({
      records,
      methodKeys,
      requestName,
    }: {
      records: RowWithId[]
      methodKeys: WeldFieldKey[]
      requestName: string
    }) => {
      const updatedRecords = records.flatMap((record) => {
        const nextRecord = { ...record }
        let changed = false
        for (const requestKey of methodKeys) {
          const method = getLnkMethodByRequestKey(requestKey)
          if (!method) continue
          if (!isEnabledControlValue(record[method.enabledKey])) continue
          const existingRequestName = String(record[method.requestKey] ?? '').trim()
          if (existingRequestName) continue
          nextRecord[method.requestKey] = requestName
          if (!hasText(nextRecord[method.resultKey])) {
            nextRecord[method.resultKey] = 'ожидает НК'
          }
          changed = true
        }
        return changed ? [withTouchedLnkTimestamp(nextRecord)] : []
      })

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, [...variables.methodKeys, 'lnkCreatedAt'])
      setMessage(formatRequestCreatedMessage(variables.requestName, savedRows.length))
      setSelectedLnkIds(new Set())
      setLnkRequestDraft({ methods: new Set() })
      setLnkRequestNaming(defaultRequestNamingState)
      setIsLnkRequestModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      requestName,
    }: {
      record: RowWithId
      methodKey: WeldFieldKey
      requestName: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите вид контроля')
      if (requestName && !isEnabledControlValue(record[method.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }

      const proposedRecord = { ...record } as RowWithId
      if (requestName) {
        proposedRecord[method.requestKey] = requestName
        if (!hasText(proposedRecord[method.resultKey])) {
          proposedRecord[method.resultKey] = 'ожидает НК'
        }
      } else {
        proposedRecord[method.requestKey] = null
        proposedRecord[method.resultKey] = null
        proposedRecord[method.conclusionDateKey] = null
        proposedRecord[method.conclusionKey] = null
      }

      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.requestKey, method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      if (!variables.requestName && method) {
        const removedRequestName = String(variables.record[method.requestKey] ?? '').trim()
        const hasRemainingRequestPositions = lnkRows.some((row) =>
          LNK_METHODS.some((candidateMethod) => {
            const isRemovedPosition = row.id === variables.record.id && candidateMethod.requestKey === method.requestKey
            return !isRemovedPosition && String(row[candidateMethod.requestKey] ?? '').trim() === removedRequestName
          }),
        )
        if (removedRequestName && !hasRemainingRequestPositions) {
          setManagedLnkRequestName('')
          setManagedLnkRequestNameDraft('')
          setMessage(`Заявка ${removedRequestName} удалена, так как в ней не осталось позиций`)
        } else {
          setMessage('Позиция заявки ЛНК удалена')
        }
      } else {
        setMessage(variables.requestName ? 'Заявка ЛНК заменена' : 'Заявка ЛНК удалена')
      }
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkRequestManagerMutation = useMutation({
    mutationFn: async ({
      requestName,
      nextRequestName,
      action,
    }: {
      requestName: string
      nextRequestName?: string
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ЛНК')
      if (action === 'rename') {
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        if (lnkRequestOptions.includes(renamedName)) throw new Error('Заявка с таким наименованием уже существует')
      }

      const updatedRecords = lnkRows.flatMap((record) => {
        const nextRecord = { ...record } as RowWithId
        let changed = false
        for (const method of LNK_METHODS) {
          if (String(record[method.requestKey] ?? '').trim() !== currentName) continue
          if (action === 'rename') {
            nextRecord[method.requestKey] = renamedName
          } else {
            nextRecord[method.requestKey] = null
            nextRecord[method.resultKey] = null
            nextRecord[method.conclusionDateKey] = null
            nextRecord[method.conclusionKey] = null
          }
          changed = true
        }
        if (!changed) return []
        const touchedRecord = withTouchedLnkTimestamp(nextRecord)
        return [{ ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }]
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ЛНК не найдена')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestFields = [...lnkRequestFieldKeys, 'lnkCreatedAt', 'finalStatus'] as WeldFieldKey[]
      const generatedFields =
        variables.action === 'delete'
          ? [...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]), ...requestFields]
          : requestFields
      highlightChangedRows(savedRows, generatedFields)
      setMessage(
        variables.action === 'rename'
          ? `Заявка ${variables.requestName} переименована в ${variables.nextRequestName}`
          : `Заявка ${variables.requestName} удалена`,
      )
      if (variables.action === 'rename' && variables.nextRequestName) {
        setManagedLnkRequestName(variables.nextRequestName)
        setManagedLnkRequestNameDraft(variables.nextRequestName)
      } else {
        setManagedLnkRequestName('')
        setManagedLnkRequestNameDraft('')
        setIsLnkRequestManagerOpen(false)
      }
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      controlDate,
      resultById,
      conclusionName,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      controlDate: string
      resultById: Record<number, string>
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      const results = records.map((record) => resultById[record.id] ?? '')
      const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
      if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
      if (hasNonEmptyResult && !controlDate) throw new Error('Укажите дату контроля')
      if (hasNonEmptyResult && !conclusionName.trim()) throw new Error('Укажите наименование заключения')
      const repairForbiddenRecord = records.find((record) => resultById[record.id] === 'ремонт' && isLnkRepairForbidden(record))
      if (repairForbiddenRecord) {
        throw new Error(`Ремонт недоступен для стыка ${String(repairForbiddenRecord.joint ?? '-')}: ${getLnkRepairForbiddenReason(repairForbiddenRecord)}`)
      }

      const lnkUpdatedAt = new Date().toISOString()
      const updatedRecords = records.map((record) => {
        const result = resultById[record.id] ?? ''
        const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
        const proposedRecord = {
          ...record,
          [method.resultKey]: shouldClearResult ? null : result,
          [method.conclusionDateKey]: shouldClearResult ? null : controlDate,
          [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
          lnkCreatedAt: lnkUpdatedAt,
        }
        return { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      })

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      const changedResults = Object.values(variables.resultById)
      setMessage(
        changedResults.every((result) => result === LNK_EMPTY_RESULT_VALUE)
          ? `Результат ЛНК очищен для стыков: ${savedRows.length}`
          : `Результат ЛНК внесен для стыков: ${savedRows.length}`,
      )
      setIsLnkResultModalOpen(false)
      setLnkResultDraft(createDefaultLnkResultDraft())
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkOfficialityMutation = useMutation({
    mutationFn: async ({
      records,
      status,
    }: {
      records: RowWithId[]
      status: 'official' | 'unofficial'
    }) => {
      if (status === 'unofficial') {
        const invalidRecords = records.filter((record) => !hasRejectedLnkResult(record))
        if (invalidRecords.length > 0) {
          throw new Error('Неофициальный статус можно назначить только после результата контроля "ремонт" или "вырез"')
        }
      }
      const nextStatus = status === 'unofficial' ? 'неофициальный' : null
      const updatedRecords = records
        .map((record) => ({ ...record, status: nextStatus }))
        .filter((record, index) => String(records[index].status ?? '').trim() !== String(nextStatus ?? '').trim()) as RowWithId[]

      if (updatedRecords.length === 0) throw new Error('Выбранные стыки уже имеют такой статус')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      highlightChangedRows(savedRows, ['status'])
      resetDismissedRepeatedJointTasks()
      setMessage(
        variables.status === 'unofficial'
          ? `Статус "неофициальный" установлен для стыков: ${savedRows.length}`
          : `Статус "официальный" установлен для стыков: ${savedRows.length}`,
      )
      setLnkOfficialityDraft(createDefaultLnkOfficialityDraft())
      setIsLnkOfficialityModalOpen(false)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultCorrectionMutation = useMutation({
    mutationFn: async ({
      record,
      methodKey,
      result,
    }: {
      record: RowWithId
      methodKey: WeldFieldKey
      result: string | null
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      if (!method) throw new Error('Выберите метод контроля')
      if (result && !LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
      if (result === 'ремонт' && isLnkRepairForbidden(record)) {
        throw new Error(`Ремонт недоступен для стыка ${String(record.joint ?? '-')}: ${getLnkRepairForbiddenReason(record)}`)
      }
      const proposedRecord = {
        ...record,
        [method.resultKey]: result,
        [method.conclusionDateKey]: result ? record[method.conclusionDateKey] : null,
        [method.conclusionKey]: result ? record[method.conclusionKey] : null,
      } as RowWithId
      const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
      const updatedRecord = { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }

      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method
        ? [method.resultKey, method.conclusionDateKey, method.conclusionKey, 'lnkCreatedAt', 'finalStatus']
        : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(saved ? [saved] : [], changedFieldKeys)
      setMessage(variables.result ? 'Результат ЛНК изменен' : 'Результат ЛНК удален')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkResultReplacementMutation = useMutation({
    mutationFn: async ({
      updates,
    }: {
      updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
    }) => {
      const updatedById = new Map<number, RowWithId>()
      for (const { record, methodKey, result } of updates) {
        const method = getLnkMethodByRequestKey(methodKey)
        if (!method) throw new Error('Выберите метод контроля')
        if (!LNK_RESULT_OPTIONS.includes(result as never)) throw new Error('Укажите корректный результат')
        if (result === 'ремонт' && isLnkRepairForbidden(record)) {
          throw new Error(`Ремонт недоступен для стыка ${String(record.joint ?? '-')}: ${getLnkRepairForbiddenReason(record)}`)
        }
        const currentRecord = updatedById.get(record.id) ?? record
        updatedById.set(record.id, {
          ...currentRecord,
          [method.resultKey]: result,
        } as RowWithId)
      }
      const updatedRecords = [...updatedById.values()].map((record) => {
        const touchedRecord = withTouchedLnkTimestamp(record)
        return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
      })

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const changedFieldKeys = [
        ...new Set(
          variables.updates
            .map(({ methodKey }) => getLnkMethodByRequestKey(methodKey)?.resultKey)
            .filter(Boolean) as WeldFieldKey[],
        ),
        'lnkCreatedAt',
        'finalStatus',
      ]
      highlightChangedRows(savedRows, changedFieldKeys)
      const savedKeys = new Set(variables.updates.map(({ record, methodKey }) => getManagedLnkResultChangeKey(record.id, methodKey)))
      setManagedLnkPendingResultChanges((current) =>
        Object.fromEntries(Object.entries(current).filter(([changeKey]) => !savedKeys.has(changeKey))),
      )
      setManagedLnkResultChangeHint(null)
      setManagedLnkResultPreview(null)
      setMessage(`Результат ЛНК изменен для стыков: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkConclusionCorrectionMutation = useMutation({
    mutationFn: async ({
      records,
      methodKey,
      conclusionName,
    }: {
      records: RowWithId[]
      methodKey: WeldFieldKey
      conclusionName: string
    }) => {
      const method = getLnkMethodByRequestKey(methodKey)
      const nextConclusionName = conclusionName.trim()
      if (!method) throw new Error('Выберите метод контроля')
      if (!nextConclusionName) throw new Error('Укажите наименование заключения')

      const updatedRecords = records
        .filter((record) => hasText(record[method.resultKey]))
        .map((record) => {
          const proposedRecord = {
            ...record,
            [method.conclusionKey]: nextConclusionName,
          } as RowWithId
          const touchedRecord = withTouchedLnkTimestamp(proposedRecord)
          return { ...touchedRecord, finalStatus: calculateFinalStatus(touchedRecord) }
        })

      if (updatedRecords.length === 0) throw new Error('Нет результатов для переименования заключения')

      const savedRows = await Promise.all(updatedRecords.map((record) => updateWeldJoint({ data: record })))
      if (!savedRows.every(Boolean)) throw new Error('Не удалось сохранить часть записей')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      const changedFieldKeys = method ? [method.conclusionKey, 'lnkCreatedAt', 'finalStatus'] : ['lnkCreatedAt', 'finalStatus']
      highlightChangedRows(savedRows, changedFieldKeys)
      setMessage(`Заключение переименовано для позиций: ${savedRows.length}`)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const lnkFieldMutation = useMutation({
    mutationFn: async ({
      record,
      fieldKey,
      value,
    }: {
      record: RowWithId
      fieldKey: WeldFieldKey
      value: string | null
    }) => {
      const method = getLnkMethodByResultKey(fieldKey)
      if (method && value && !hasText(record[method.requestKey])) {
        throw new Error('Сначала создайте заявку ЛНК для этого вида контроля')
      }
      const requestMethod = getLnkMethodByRequestKey(fieldKey)
      if (requestMethod && value && !isEnabledControlValue(record[requestMethod.enabledKey])) {
        throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
      }
      if (isLnkRequestField(fieldKey) && value && !lnkRequestOptions.includes(value)) {
        throw new Error('Можно выбрать только существующую заявку ЛНК или очистить поле')
      }

      const proposedRecord = clearDisabledLnkRequests(withTouchedLnkTimestamp(applyLnkFieldUpdate(record, fieldKey, value)))
      const updatedRecord = { ...proposedRecord, finalStatus: calculateFinalStatus(proposedRecord) }
      const saved = await updateWeldJoint({ data: updatedRecord })
      if (!saved) throw new Error('Запись не найдена')
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      highlightChangedRows(saved ? [saved] : [], [variables.fieldKey, 'lnkCreatedAt', 'finalStatus'])
      setMessage('Поле ЛНК обновлено')
      setHeatTreatmentFieldEditing(null)
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  const clearLnkGeneratedDataMutation = useMutation({
    mutationFn: async (targetRows: WeldRow[]) => {
      const updatedRows = targetRows.flatMap((row) => {
        const cleanedRow = clearLnkGeneratedData(row)
        return hasLnkGeneratedDataChanged(row, cleanedRow) ? [{ ...cleanedRow, finalStatus: calculateFinalStatus(cleanedRow) }] : []
      })
      if (updatedRows.length === 0) return []

      const savedRows = await clearLnkGeneratedWeldData()
      if (!Array.isArray(savedRows)) throw new Error('Не удалось очистить данные ЛНК')
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows) => {
      highlightChangedRows(savedRows, [...lnkGeneratedFieldKeys, 'finalStatus'])
      setSelectedLnkIds(new Set())
      setLnkResultDraft(createDefaultLnkResultDraft())
      setMessage(savedRows.length > 0 ? `Очищены результаты и заключения ЛНК: ${savedRows.length} строк` : 'В ЛНК нечего очищать')
      await invalidateWeldJoints(queryClient)
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })

  return {
    lnkRequestMutation,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
    lnkResultMutation,
    lnkOfficialityMutation,
    lnkResultCorrectionMutation,
    lnkResultReplacementMutation,
    lnkConclusionCorrectionMutation,
    lnkFieldMutation,
    clearLnkGeneratedDataMutation,
  }
}
