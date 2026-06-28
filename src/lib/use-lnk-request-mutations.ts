import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
} from '@/lib/report-config'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getLnkRequestPositionHighlightFields } from '@/lib/lnk-report-mutation-highlight-fields'
import {
  buildLnkRequestCorrectionRow,
  buildLnkRequestManagerRows,
  buildLnkRequestRows,
} from '@/lib/lnk-report-mutation-updates'
import { defaultRequestNamingState } from '@/lib/request-naming-state'
import { formatRequestCreatedMessage } from '@/lib/report-naming'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowOrThrow, updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId, UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'

export function useLnkRequestMutations({
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
      const updatedRecords = buildLnkRequestRows({ records, methodKeys, requestName })

      if (updatedRecords.length === 0) {
        throw new Error('Нет доступных стыков или видов контроля для новой заявки ЛНК')
      }

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
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
      const updatedRecord = buildLnkRequestCorrectionRow({ record, methodKey, requestName })
      const saved = await updateWeldRowOrThrow(updatedRecord)
      return saved as unknown as WeldRow
    },
    onSuccess: async (saved, variables) => {
      const method = getLnkMethodByRequestKey(variables.methodKey)
      highlightChangedRows(saved ? [saved] : [], getLnkRequestPositionHighlightFields(variables.methodKey))
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

      const updatedRecords = buildLnkRequestManagerRows({
        records: lnkRows,
        requestName: currentName,
        nextRequestName: renamedName,
        action,
      })

      if (updatedRecords.length === 0) throw new Error('Заявка ЛНК не найдена')

      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
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

  return {
    lnkRequestMutation,
    lnkRequestCorrectionMutation,
    lnkRequestManagerMutation,
  }
}
