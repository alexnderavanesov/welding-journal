import { startTransition } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { getLnkResultNavigationEntry } from '@/lib/lnk-result-navigation'
import { type WeldFieldKey } from '@/lib/weld-fields'
import {
  getCommonLnkRequestStage,
  getCommonLnkResultStage,
  getPreferredLnkRequestStage,
  getPreferredLnkResultStage,
} from '@/lib/lnk-workflow-routing'
import { PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE, type LnkControlStage } from '@/lib/lnk-control-stage'
import { getLnkRowRequestNames } from '@/lib/report-modal-rows'
import { WORKFLOW_REGISTRY_PAGE_SIZE } from '@/server/weld-contracts'

import type { Dispatch, SetStateAction } from 'react'
import type { useHomeLnkController } from '@/lib/use-home-lnk-controller'
import type { useLnkRequestActions } from '@/lib/use-lnk-request-actions'
import type { useLnkResultActions } from '@/lib/use-lnk-result-actions'
import type { useManagedLnkResultActions } from '@/lib/use-managed-lnk-result-actions'

type LnkDialogNavigationOptions = Pick<ReturnType<typeof useHomeLnkController>,
  | 'preHeatTreatmentResultManagerMode'
  | 'preHeatTreatmentResultManagerRowIds'
  | 'setIsPreHeatTreatmentResultManagerOpen'
  | 'setLnkResultRegistryFilter'
  | 'setLnkResultRegistryLimit'
  | 'setLnkResultRegistrySearch'
  | 'setPreHeatTreatmentLnkInitialMethodCode'
  | 'setPreHeatTreatmentLnkWorkflowMode'
  | 'setPreHeatTreatmentResultManagerInitialRelationId'
  | 'setPreHeatTreatmentResultManagerRowIds'
  | 'openPreHeatTreatmentLnkWorkflow'
> & Pick<ReturnType<typeof useLnkRequestActions>,
  | 'openCreateLnkRequestModal'
  | 'openCreateLnkRequestModalForRow'
  | 'openCreateLnkRequestModalForRows'
  | 'openExtendLnkRequestModalForRows'
> &
  Pick<ReturnType<typeof useLnkResultActions>, 'openAddLnkResultModal' | 'openAddLnkResultModalForRow'> &
  Pick<ReturnType<typeof useManagedLnkResultActions>, 'closeLnkResultManager' | 'openLnkResultManager'> & {
  closePreHeatTreatmentResultRegistryState: ReturnType<typeof useHomeLnkController>['closePreHeatTreatmentResultRegistry']
  controlProcessSettings: { preHeatTreatmentLnkEnabled: boolean }
  lnkRows: WeldRow[]
  openLnkRequestRegistry: () => void
  preHeatTreatmentResultCorrectionMutation: { isPending: boolean }
  selectedLnkIds: ReadonlySet<number>
  setMessage: (message: string) => void
  setSelectedLnkIds: Dispatch<SetStateAction<Set<number>>>
  tableActionRows: WeldRow[]
}

export function createLnkDialogNavigation({
  preHeatTreatmentResultManagerMode,
  preHeatTreatmentResultManagerRowIds,
  setIsPreHeatTreatmentResultManagerOpen,
  setLnkResultRegistryFilter,
  setLnkResultRegistryLimit,
  setLnkResultRegistrySearch,
  setPreHeatTreatmentLnkInitialMethodCode,
  setPreHeatTreatmentLnkWorkflowMode,
  setPreHeatTreatmentResultManagerInitialRelationId,
  setPreHeatTreatmentResultManagerRowIds,
  openPreHeatTreatmentLnkWorkflow,
  openCreateLnkRequestModal,
  openCreateLnkRequestModalForRow,
  openCreateLnkRequestModalForRows,
  openExtendLnkRequestModalForRows,
  openAddLnkResultModal,
  openAddLnkResultModalForRow,
  closeLnkResultManager,
  openLnkResultManager,
  closePreHeatTreatmentResultRegistryState,
  controlProcessSettings,
  lnkRows,
  openLnkRequestRegistry,
  preHeatTreatmentResultCorrectionMutation,
  selectedLnkIds,
  setMessage,
  setSelectedLnkIds,
  tableActionRows,
}: LnkDialogNavigationOptions) {
  const openAllLnkResultRegistry = () => {
    setLnkResultRegistrySearch('')
    setLnkResultRegistryFilter('all')
    setLnkResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
    openLnkResultManager({ rowIds: null })
  }
  const openSelectedLnkResultRegistry = () => openLnkResultManager({ rowIds: [...selectedLnkIds] })
  const openLnkResultRegistryForRows = (selectedRows: WeldRow[]) =>
    openLnkResultManager({ rowIds: selectedRows.map((selectedRow) => selectedRow.id) })
  const openExactLnkResult = (row: WeldRow, methodKey: WeldFieldKey) => {
    const entry = getLnkResultNavigationEntry(row, methodKey)
    if (!entry) {
      setMessage('Не удалось определить внесенный результат ЛНК')
      return
    }
    openLnkResultManager({
      rowIds: [row.id],
      methodKey,
      targetKey: entry.changeKey,
    })
  }
  const openAddLnkResultFromRegistry = () => {
    closeLnkResultManager()
    openAddLnkResultModal()
  }
  const closePreHeatTreatmentResultRegistry = () => {
    closePreHeatTreatmentResultRegistryState(preHeatTreatmentResultCorrectionMutation.isPending)
  }
  const openPrimaryLnkRegistryFromPreHeatTreatment = () => {
    const rowIds = preHeatTreatmentResultManagerRowIds
    startTransition(() => {
      setIsPreHeatTreatmentResultManagerOpen(false)
      setPreHeatTreatmentResultManagerRowIds(null)
      setPreHeatTreatmentResultManagerInitialRelationId(null)
      if (preHeatTreatmentResultManagerMode === 'request') {
        openLnkRequestRegistry()
        return
      }
      openLnkResultManager({ rowIds, allowEmpty: true })
    })
  }
  const switchLnkWorkflowStage = (
    mode: 'request' | 'result',
    stage: LnkControlStage,
    selectedRowIds: number[],
    requestSubmitMode: LnkRequestComposerMode = 'create',
  ) => {
    const selectedRows = lnkRows.filter((row) => selectedRowIds.includes(row.id))
    if (
      stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE &&
      !controlProcessSettings.preHeatTreatmentLnkEnabled
    ) {
      setMessage('НК до ТО выключен в настройках проекта.')
      return
    }

    startTransition(() => {
      if (stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
        if (selectedRowIds.length > 0) setSelectedLnkIds(new Set(selectedRowIds))
        openPreHeatTreatmentLnkWorkflow(mode, undefined, requestSubmitMode)
        return
      }

      setPreHeatTreatmentLnkWorkflowMode(null)
      setPreHeatTreatmentLnkInitialMethodCode(undefined)
      if (mode === 'request') {
        if (requestSubmitMode === 'extend') {
          openExtendLnkRequestModalForRows(selectedRows)
        } else {
          openCreateLnkRequestModalForRows(selectedRows)
        }
        return
      }
      if (
        selectedRows.length === 1 &&
        getLnkRowRequestNames(selectedRows[0]!).length > 0
      ) {
        openAddLnkResultModalForRow(selectedRows[0]!)
        return
      }
      openAddLnkResultModal()
    })
  }
  const openCreateLnkWorkflowRequestForRow = (row: WeldRow) => {
    if (getPreferredLnkRequestStage(row) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set([row.id]))
      openPreHeatTreatmentLnkWorkflow('request')
      return
    }
    openCreateLnkRequestModalForRow(row)
  }
  const openCreateLnkWorkflowRequestForRows = (selectedRows: WeldRow[]) => {
    if (selectedRows.length === 0) {
      openCreateLnkRequestModal()
      return
    }
    const stage = getCommonLnkRequestStage(selectedRows)
    if (stage === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set(selectedRows.map((row) => row.id)))
      openPreHeatTreatmentLnkWorkflow('request')
      return
    }
    if (stage) {
      openCreateLnkRequestModalForRows(selectedRows)
      return
    }
    setMessage('Выбранные стыки требуют заявок на разных этапах ЛНК. Выберите стыки одного этапа.')
  }
  const openAddLnkWorkflowResultForRow = (row: WeldRow) => {
    if (getPreferredLnkResultStage(row) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE) {
      setSelectedLnkIds(new Set([row.id]))
      openPreHeatTreatmentLnkWorkflow('result')
      return
    }
    openAddLnkResultModalForRow(row)
  }
  const openAddLnkWorkflowResultFromHeader = () => {
    const selectedRows = tableActionRows.filter((row) => selectedLnkIds.has(row.id))
    if (
      selectedRows.length > 0 &&
      getCommonLnkResultStage(selectedRows) === PRE_HEAT_TREATMENT_LNK_CONTROL_STAGE
    ) {
      openPreHeatTreatmentLnkWorkflow('result')
      return
    }
    openAddLnkResultModal()
  }
  return {
    openAllLnkResultRegistry,
    openSelectedLnkResultRegistry,
    openLnkResultRegistryForRows,
    openExactLnkResult,
    openAddLnkResultFromRegistry,
    closePreHeatTreatmentResultRegistry,
    openPrimaryLnkRegistryFromPreHeatTreatment,
    switchLnkWorkflowStage,
    openCreateLnkWorkflowRequestForRow,
    openCreateLnkWorkflowRequestForRows,
    openAddLnkWorkflowResultForRow,
    openAddLnkWorkflowResultFromHeader,
  }
}
