import type { UseLnkRequestActionsOptions } from '@/lib/lnk-report-action-types'
import { getRequestNameFromNaming } from '@/lib/report-naming'
import { toggleNumberSetValue, toggleNumberSetValues } from '@/lib/report-ui-state'
import { getAvailableLnkRequestMethods } from '@/lib/lnk-status'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

export function useLnkRequestActions({
  filteredRows,
  lnkRows,
  naming,
  nextRequestName,
  selectedMethodKeys,
  selectedRows,
  selectedTargetCount,
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
  function handleCreateLnkRequest() {
    const methodKeys = selectedMethodKeys
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для заявки ЛНК')
      return
    }
    if (selectedTargetCount === 0) {
      setMessage('Нет доступных комбинаций стыков и видов контроля для заявки ЛНК')
      return
    }

    const requestName = getRequestNameFromNaming(naming, nextRequestName)
    if (!requestName) {
      setMessage('Укажите пользовательское наименование заявки ЛНК')
      return
    }

    mutation.mutate({ records: selectedRows, methodKeys, requestName })
  }

  function openCreateLnkRequestModal() {
    setPreservedOrderIds(null)
    setSelectedIds(new Set())
    setDraft({ methods: new Set() })
    setNaming(defaultNaming)
    setSearch('')
    setIsOpen(true)
  }

  function openCreateLnkRequestModalForRow(row: WeldRow) {
    const availableMethods = getAvailableLnkRequestMethods(row)
    if (availableMethods.length === 0) {
      setMessage('Все заявки ЛНК для этого стыка уже созданы')
      return
    }

    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedIds(new Set([row.id]))
    setDraft({ methods: new Set(availableMethods.map((method) => method.requestKey)) })
    setNaming(defaultNaming)
    setSearch(String(row.joint ?? row.line ?? ''))
    setIsOpen(true)
  }

  function closeCreateLnkRequestModal() {
    if (mutation.isPending) return
    setIsOpen(false)
  }

  function toggleLnkRequestMethod(requestKey: WeldFieldKey) {
    setDraft((current) => {
      const methods = new Set(current.methods)
      if (methods.has(requestKey)) {
        methods.delete(requestKey)
      } else {
        methods.add(requestKey)
      }
      return { methods }
    })
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
    toggleLnkRequestMethod,
    toggleLnkRequestRow,
  }
}
