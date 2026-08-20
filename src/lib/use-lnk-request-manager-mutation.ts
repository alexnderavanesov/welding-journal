import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LNK_METHODS,
  LNK_REQUEST_FIELD_KEYS as lnkRequestFieldKeys,
} from '@/lib/report-config'
import { buildLnkRequestManagerRows } from '@/lib/lnk-report-mutation-updates'
import { loadRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { isSystemDocumentNameForRows } from '@/lib/system-document-types'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { updateWeldRowsOrThrow } from '@/lib/weld-save-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { UseLnkReportMutationsOptions } from '@/lib/lnk-report-mutation-types'
import { isSameRequestDocument } from '@/lib/request-document-identity'
import { deleteLnkRequestDocument } from '@/server/welds'

export function useLnkRequestManagerMutation({
  lnkRows,
  setMessage,
  highlightChangedRows,
  setManagedLnkRequestName,
  setManagedLnkRequestNameDraft,
  setIsLnkRequestManagerOpen,
}: UseLnkReportMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      requestName,
      requestDate,
      nextRequestName,
      action,
    }: {
      requestName: string
      requestDate: string
      nextRequestName?: string
      action: 'rename' | 'delete'
    }) => {
      const currentName = requestName.trim()
      const renamedName = nextRequestName?.trim() ?? ''
      if (!currentName) throw new Error('Выберите заявку ЛНК')
      if (action === 'rename') {
        if (
          isSystemDocumentNameForRows(
            lnkRows,
            'lnkRequest',
            currentName,
            loadRequestConclusionSettings(),
          )
        ) {
          throw new Error('Системную заявку ЛНК нельзя переименовать')
        }
        if (!renamedName) throw new Error('Введите новое наименование заявки')
        if (renamedName === currentName) throw new Error('Новое наименование совпадает с текущим')
        const sameDatedRequestExists = lnkRows.some((row) =>
          LNK_METHODS.some((method) =>
            isSameRequestDocument(row[method.requestKey], row[method.requestDateKey], {
              name: renamedName,
              date: requestDate,
            }),
          ),
        )
        if (renamedName !== currentName && sameDatedRequestExists) {
          throw new Error('Заявка с таким наименованием и датой уже существует')
        }
      }

      if (action === 'delete') {
        const savedRows = await deleteLnkRequestDocument({
          data: { requestName: currentName, requestDate },
        })
        return savedRows as unknown as WeldRow[]
      }

      const updatedRecords = buildLnkRequestManagerRows({
        records: lnkRows,
        requestName: currentName,
        requestDate,
        nextRequestName: renamedName,
        action,
      })
      if (updatedRecords.length === 0) throw new Error('Заявка ЛНК не найдена')
      const savedRows = await updateWeldRowsOrThrow(updatedRecords)
      return savedRows as unknown as WeldRow[]
    },
    onSuccess: async (savedRows, variables) => {
      const requestNameFields = [...lnkRequestFieldKeys, 'finalStatus'] as WeldFieldKey[]
      const requestDeleteFields = [
        ...lnkRequestFieldKeys,
        ...LNK_METHODS.map((method) => method.requestDateKey),
        'lnkCreatedAt',
        'finalStatus',
      ] as WeldFieldKey[]
      const generatedFields =
        variables.action === 'delete'
          ? [...LNK_METHODS.flatMap((method) => [method.resultKey, method.conclusionDateKey, method.conclusionKey]), ...requestDeleteFields]
          : requestNameFields
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
      await invalidateWeldJoints(queryClient, { upsertRows: savedRows })
    },
    onError: (error) => {
      setMessage((error as Error).message)
    },
  })
}
