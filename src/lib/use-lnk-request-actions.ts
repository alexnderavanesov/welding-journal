import type { UseLnkRequestActionsOptions } from '@/lib/lnk-report-action-types'
import { getDateInputValidationReason } from '@/lib/date-format'
import { createDefaultLnkRequestDraft } from '@/lib/report-draft-state'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { countLnkRequestTargets } from '@/lib/report-modal-rows'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import {
  analyzeLnkRequestExtensionTargets,
  type LnkRequestExtensionOption,
} from '@/lib/lnk-request-extension'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function useLnkRequestActions({
  draft,
  filteredRows,
  lnkRows,
  naming,
  nextRequestName,
  selectedRows,
  mutation,
  extensionMutation,
  defaultNaming,
  setDraft,
  setIsOpen,
  setMessage,
  setNaming,
  setPreservedOrderIds,
  setSearch,
  setSelectedIds,
  setComposerMode,
  setTargetRequestKey,
}: UseLnkRequestActionsOptions) {
  function handleCreateLnkRequest(methodKeys: WeldFieldKey[]) {
    setMessage(null)
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для заявки ЛНК')
      return
    }
    if (countLnkRequestTargets(selectedRows, methodKeys) === 0) {
      setMessage('Нет доступных комбинаций стыков и видов контроля для заявки ЛНК')
      return
    }

    const requestName = getRequestNameFromNaming(naming, nextRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ЛНК')
      return
    }
    const requestDateReason = getDateInputValidationReason(draft.requestDate, 'Дата заявки ЛНК')
    if (requestDateReason) {
      setMessage(requestDateReason)
      return
    }

    mutation.mutate({
      records: selectedRows,
      methodKeys,
      requestName,
      requestDate: draft.requestDate,
      useSystemName: naming.mode === 'system',
    })
  }

  function handleExtendLnkRequest(
    methodKeys: WeldFieldKey[],
    existingRequest: LnkRequestExtensionOption | undefined,
  ) {
    setMessage(null)
    if (!existingRequest) {
      setMessage('Выберите существующую заявку ЛНК')
      return
    }
    if (existingRequest.disabledReason) {
      setMessage(existingRequest.disabledReason)
      return
    }
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для добавления в заявку ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для добавления в заявку ЛНК')
      return
    }

    const analysis = analyzeLnkRequestExtensionTargets({
      rows: selectedRows,
      methodKeys,
      requestName: existingRequest.name,
      requestDate: existingRequest.date,
    })
    if (analysis.targets.length === 0) {
      setMessage('По выбранным стыкам и видам контроля нет позиций, которые можно добавить в эту заявку')
      return
    }

    extensionMutation.mutate({
      requestName: existingRequest.name,
      requestDate: existingRequest.date,
      targets: analysis.targets,
    })
  }

  function openCreateLnkRequestModal() {
    setMessage(null)
    setPreservedOrderIds(null)
    setSelectedIds(new Set())
    setDraft(createDefaultLnkRequestDraft())
    setNaming(defaultNaming)
    setSearch('')
    setComposerMode('create')
    setTargetRequestKey('')
    setIsOpen(true)
  }

  function openExtendLnkRequestModal(existingRequest?: LnkRequestExtensionOption) {
    setMessage(null)
    setPreservedOrderIds(null)
    setSelectedIds(new Set())
    setDraft(createDefaultLnkRequestDraft())
    setNaming(defaultNaming)
    setSearch('')
    setComposerMode('extend')
    setTargetRequestKey(existingRequest?.key ?? '')
    setIsOpen(true)
  }

  function openExtendLnkRequestModalForRows(rows: WeldRow[], existingRequest?: LnkRequestExtensionOption) {
    const availableMethods = new Set(
      rows.flatMap((row) => getAvailableLnkRequestMethods(row).map((method) => method.requestKey)),
    )
    setMessage(null)
    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedIds(new Set(rows.map((row) => row.id)))
    setDraft({ ...createDefaultLnkRequestDraft(), methods: availableMethods })
    setNaming(defaultNaming)
    setSearch(rows.length === 1 ? String(rows[0]?.joint ?? rows[0]?.line ?? '') : '')
    setComposerMode('extend')
    setTargetRequestKey(existingRequest?.key ?? '')
    setIsOpen(true)
  }

  function openCreateLnkRequestModalForRow(row: WeldRow) {
    setMessage(null)
    const availableMethods = getAvailableLnkRequestMethods(row)
    if (availableMethods.length === 0) {
      setMessage('Все заявки ЛНК для этого стыка уже созданы')
      return
    }

    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedIds(new Set([row.id]))
    setDraft({ ...createDefaultLnkRequestDraft(), methods: new Set(availableMethods.map((method) => method.requestKey)) })
    setNaming(defaultNaming)
    setSearch(String(row.joint ?? row.line ?? ''))
    setComposerMode('create')
    setTargetRequestKey('')
    setIsOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (mutation.isPending || extensionMutation.isPending) return
    setIsOpen(false)
  }

  function toggleLnkRequestRow(rowId: number) {
    setSelectedIds((current) => toggleNumberSetValue(current, rowId))
  }

  function toggleAllLnkRequestRows() {
    setSelectedIds((current) => toggleNumberSetValues(current, filteredRows.map((row) => row.id)))
  }

  return {
    closeCreateLnkRequestModal,
    handleCreateLnkRequest,
    handleExtendLnkRequest,
    openCreateLnkRequestModal,
    openCreateLnkRequestModalForRow,
    openExtendLnkRequestModal,
    openExtendLnkRequestModalForRows,
    toggleAllLnkRequestRows,
    toggleLnkRequestRow,
  }
}
