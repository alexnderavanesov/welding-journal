import type { UseLnkRequestActionsOptions } from '@/lib/lnk-report-action-types'
import { getDateInputValidationReason } from '@/lib/date-format'
import { createDefaultLnkRequestDraft } from '@/lib/report-draft-state'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { countLnkRequestTargets } from '@/lib/report-modal-rows'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
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
  defaultNaming,
  setDraft,
  setIsOpen,
  setMessage,
  setNaming,
  setPreservedOrderIds,
  setSearch,
  setSelectedIds,
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

  function openCreateLnkRequestModal() {
    setMessage(null)
    setPreservedOrderIds(null)
    setSelectedIds(new Set())
    setDraft(createDefaultLnkRequestDraft())
    setNaming(defaultNaming)
    setSearch('')
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
    setIsOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (mutation.isPending) return
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
    openCreateLnkRequestModal,
    openCreateLnkRequestModalForRow,
    toggleAllLnkRequestRows,
    toggleLnkRequestRow,
  }
}
