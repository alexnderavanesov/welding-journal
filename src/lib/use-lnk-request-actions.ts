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
import { buildSystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { buildLnkRequestDraftRows } from '@/lib/lnk-request-mutation-updates'
import { LNK_METHODS } from '@/lib/report-config'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getPrimaryLnkStageAccess } from '@/lib/lnk-control-stage'
import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'

export function useLnkRequestActions({
  controlProcessSettings,
  draft,
  filteredRows,
  lnkRows,
  naming,
  nextRequestName,
  nextRequestNumber,
  requestConclusionSettings,
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
  const confirmAction = useConfirmAction()

  async function handleCreateLnkRequest(methodKeys: WeldFieldKey[]) {
    setMessage(null)
    if (selectedRows.length === 0) {
      setMessage('Выберите один или несколько стыков для заявки ЛНК')
      return
    }
    if (methodKeys.length === 0) {
      setMessage('Выберите один или несколько видов контроля для заявки ЛНК')
      return
    }
    if (countLnkRequestTargets(selectedRows, methodKeys, controlProcessSettings) === 0) {
      setMessage('Нет доступных комбинаций стыков и видов контроля для заявки ЛНК')
      return
    }

    const eligibleRowIds = new Set(buildLnkRequestDraftRows({
      records: selectedRows,
      methodKeys,
      requestName: '__system-document-group-preview__',
      requestDate: draft.requestDate,
      controlProcessSettings,
    }).map((row) => row.id))
    const creationPlan = buildSystemDocumentCreationPlan({
      type: 'lnkRequest',
      date: draft.requestDate,
      rows: selectedRows.filter((row) => eligibleRowIds.has(row.id)),
      naming,
      settings: requestConclusionSettings,
      nextNumber: nextRequestNumber,
    })
    const requestName = creationPlan.groups[0]?.name ?? getRequestNameFromNaming(naming, nextRequestName)
    if (!requestName || creationPlan.error) {
      setMessage(creationPlan.error || 'Укажите пользовательское наименование заявки ЛНК')
      return
    }
    const requestDateReason = getDateInputValidationReason(draft.requestDate, 'Дата заявки ЛНК')
    if (requestDateReason) {
      setMessage(requestDateReason)
      return
    }

    if (!await confirmPrimaryLnkStageDebt(selectedRows, methodKeys)) return

    mutation.mutate({
      records: selectedRows,
      methodKeys,
      requestName,
      requestDate: draft.requestDate,
      useSystemName: naming.mode === 'system',
      documentGroups: creationPlan.groups,
    })
  }

  async function handleExtendLnkRequest(
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
      controlProcessSettings,
    })
    if (analysis.targets.length === 0) {
      setMessage('По выбранным стыкам и видам контроля нет позиций, которые можно добавить в эту заявку')
      return
    }

    const targetKeys = new Set(analysis.targets.map((target) => `${target.rowId}:${target.methodKey}`))
    if (!await confirmPrimaryLnkStageDebt(selectedRows, methodKeys, targetKeys)) return

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
      rows.flatMap((row) => getAvailableLnkRequestMethods(row, controlProcessSettings).map((method) => method.requestKey)),
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
    const availableMethods = getAvailableLnkRequestMethods(row, controlProcessSettings)
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

  function openCreateLnkRequestModalForRows(rows: WeldRow[]) {
    const availableMethods = new Set(
      rows.flatMap((row) => getAvailableLnkRequestMethods(row, controlProcessSettings).map((method) => method.requestKey)),
    )
    if (rows.length === 0 || availableMethods.size === 0) {
      openCreateLnkRequestModal()
      return
    }

    setMessage(null)
    setPreservedOrderIds(lnkRows.map((lnkRow) => lnkRow.id))
    setSelectedIds(new Set(rows.map((row) => row.id)))
    setDraft({ ...createDefaultLnkRequestDraft(), methods: availableMethods })
    setNaming(defaultNaming)
    setSearch(rows.length === 1 ? String(rows[0]?.joint ?? rows[0]?.line ?? '') : '')
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

  async function confirmPrimaryLnkStageDebt(
    rows: WeldRow[],
    methodKeys: WeldFieldKey[],
    targetKeys?: ReadonlySet<string>,
  ) {
    const warnings = rows.flatMap((row) => methodKeys.flatMap((methodKey) => {
      if (targetKeys && !targetKeys.has(`${row.id}:${methodKey}`)) return []
      const method = LNK_METHODS.find((candidate) => candidate.requestKey === methodKey)
      if (
        !method ||
        !isEnabledControlValue(row[method.enabledKey]) ||
        hasText(row[method.requestKey])
      ) return []
      const access = getPrimaryLnkStageAccess(row, method.code, controlProcessSettings)
      return access.status === 'allowed-with-warning' ? [{ row, method, reason: access.reason }] : []
    }))
    if (warnings.length === 0) return true

    const jointCount = new Set(warnings.map(({ row }) => row.id)).size
    const methods = [...new Set(warnings.map(({ method }) => method.code))].join(', ')
    return confirmAction({
      title: 'Продолжить основной НК раньше?',
      itemName: `Стыков: ${jointCount} · Позиций НК: ${warnings.length} · Методы: ${methods}`,
      description: 'Предыдущие этапы контроля еще не завершены. Выбранные позиции будут оформлены в основном этапе ЛНК.',
      warning: 'В диспетчере появится системное предупреждение СП-01 до завершения НК до ТО, ПСТО и ТВМТ.',
      confirmLabel: 'Продолжить',
      tone: 'warning',
    })
  }

  return {
    closeCreateLnkRequestModal,
    handleCreateLnkRequest,
    handleExtendLnkRequest,
    openCreateLnkRequestModal,
    openCreateLnkRequestModalForRow,
    openCreateLnkRequestModalForRows,
    openExtendLnkRequestModal,
    openExtendLnkRequestModalForRows,
    toggleAllLnkRequestRows,
    toggleLnkRequestRow,
  }
}
