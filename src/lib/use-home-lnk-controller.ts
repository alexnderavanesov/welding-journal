import { useCallback, useState } from 'react'
import { createEmptyDuplicateControlDraft, type DuplicateControlDraft } from '@/lib/duplicate-control-types'
import type { PreHeatTreatmentLnkMethodCode } from '@/lib/lnk-control-stage'
import type { LnkRequestComposerMode } from '@/lib/use-lnk-request-modal-state'
import { useLnkRequestModalState } from '@/lib/use-lnk-request-modal-state'
import { useLnkResultModalState } from '@/lib/use-lnk-result-modal-state'

export function useHomeLnkController() {
  const request = useLnkRequestModalState()
  const result = useLnkResultModalState()
  const {
    setIsLnkRequestManagerOpen,
    setIsLnkRequestModalOpen,
  } = request
  const {
    setIsLnkOfficialityModalOpen,
    setIsLnkResultManagerOpen,
    setIsLnkResultModalOpen,
  } = result
  const [isWorkflowMenuOpen, setIsWorkflowMenuOpen] = useState(false)
  const [preHeatTreatmentWorkflowMode, setPreHeatTreatmentWorkflowMode] =
    useState<'request' | 'result' | null>(null)
  const [preHeatTreatmentInitialMethodCode, setPreHeatTreatmentInitialMethodCode] =
    useState<PreHeatTreatmentLnkMethodCode | undefined>(undefined)
  const [preHeatTreatmentRequestSubmitMode, setPreHeatTreatmentRequestSubmitMode] =
    useState<LnkRequestComposerMode>('create')
  const [isPreHeatTreatmentResultManagerOpen, setIsPreHeatTreatmentResultManagerOpen] = useState(false)
  const [preHeatTreatmentResultManagerRowIds, setPreHeatTreatmentResultManagerRowIds] = useState<number[] | null>(null)
  const [preHeatTreatmentResultManagerInitialRelationId, setPreHeatTreatmentResultManagerInitialRelationId] =
    useState<number | null>(null)
  const [preHeatTreatmentResultManagerMode, setPreHeatTreatmentResultManagerMode] =
    useState<'request' | 'result'>('result')
  const [isDuplicateControlModalOpen, setIsDuplicateControlModalOpen] = useState(false)
  const [duplicateControlDraft, setDuplicateControlDraft] = useState<DuplicateControlDraft>(() =>
    createEmptyDuplicateControlDraft(),
  )

  const closePrimaryLnkDialogs = useCallback(() => {
    setIsLnkRequestModalOpen(false)
    setIsLnkRequestManagerOpen(false)
    setIsLnkResultModalOpen(false)
    setIsLnkResultManagerOpen(false)
    setIsLnkOfficialityModalOpen(false)
    setIsDuplicateControlModalOpen(false)
  }, [
    setIsLnkOfficialityModalOpen,
    setIsLnkRequestManagerOpen,
    setIsLnkRequestModalOpen,
    setIsLnkResultManagerOpen,
    setIsLnkResultModalOpen,
  ])

  const openPreHeatTreatmentResultRegistry = useCallback(({
    rowIds = null,
    relationId = null,
    registryMode = 'result',
  }: {
    rowIds?: number[] | null
    relationId?: number | null
    registryMode?: 'request' | 'result'
  } = {}) => {
    closePrimaryLnkDialogs()
    setPreHeatTreatmentWorkflowMode(null)
    setPreHeatTreatmentResultManagerRowIds(rowIds)
    setPreHeatTreatmentResultManagerInitialRelationId(relationId)
    setPreHeatTreatmentResultManagerMode(registryMode)
    setIsPreHeatTreatmentResultManagerOpen(true)
  }, [closePrimaryLnkDialogs])

  const closePreHeatTreatmentResultRegistry = useCallback((isPending = false) => {
    if (isPending) return
    setIsPreHeatTreatmentResultManagerOpen(false)
    setPreHeatTreatmentResultManagerRowIds(null)
    setPreHeatTreatmentResultManagerInitialRelationId(null)
  }, [])

  const openPreHeatTreatmentLnkWorkflow = useCallback((
    mode: 'request' | 'result',
    methodCode?: PreHeatTreatmentLnkMethodCode,
    requestSubmitMode: LnkRequestComposerMode = 'create',
  ) => {
    closePrimaryLnkDialogs()
    setIsPreHeatTreatmentResultManagerOpen(false)
    setPreHeatTreatmentResultManagerRowIds(null)
    setPreHeatTreatmentResultManagerInitialRelationId(null)
    setPreHeatTreatmentInitialMethodCode(methodCode)
    setPreHeatTreatmentRequestSubmitMode(requestSubmitMode)
    setPreHeatTreatmentWorkflowMode(mode)
  }, [closePrimaryLnkDialogs])

  return {
    ...request,
    ...result,
    isLnkWorkflowMenuOpen: isWorkflowMenuOpen,
    setIsLnkWorkflowMenuOpen: setIsWorkflowMenuOpen,
    preHeatTreatmentLnkWorkflowMode: preHeatTreatmentWorkflowMode,
    setPreHeatTreatmentLnkWorkflowMode: setPreHeatTreatmentWorkflowMode,
    preHeatTreatmentLnkInitialMethodCode: preHeatTreatmentInitialMethodCode,
    setPreHeatTreatmentLnkInitialMethodCode: setPreHeatTreatmentInitialMethodCode,
    preHeatTreatmentLnkRequestSubmitMode: preHeatTreatmentRequestSubmitMode,
    isPreHeatTreatmentResultManagerOpen,
    setIsPreHeatTreatmentResultManagerOpen,
    preHeatTreatmentResultManagerRowIds,
    setPreHeatTreatmentResultManagerRowIds,
    preHeatTreatmentResultManagerInitialRelationId,
    setPreHeatTreatmentResultManagerInitialRelationId,
    preHeatTreatmentResultManagerMode,
    setPreHeatTreatmentResultManagerMode,
    isDuplicateControlModalOpen,
    setIsDuplicateControlModalOpen,
    duplicateControlDraft,
    setDuplicateControlDraft,
    closePrimaryLnkDialogs,
    openPreHeatTreatmentResultRegistry,
    closePreHeatTreatmentResultRegistry,
    openPreHeatTreatmentLnkWorkflow,
  }
}
