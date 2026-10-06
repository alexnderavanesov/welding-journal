import {
  DEFAULT_PRE_HEAT_TREATMENT_REGISTRY_FILTERS,
  type PreHeatTreatmentRegistryFilters,
} from '@/lib/pre-heat-treatment-registry'
import { LNK_METHODS } from '@/lib/report-config'
import { type WeldFieldKey } from '@/lib/weld-fields'
import { type RequestDocumentIdentity } from '@/lib/request-document-identity'
import { WORKFLOW_REGISTRY_PAGE_SIZE } from '@/server/weld-contracts'
import { type SystemDocumentReference } from '@/lib/system-document-types'

import { startTransition, useCallback, useEffect, useState } from 'react'
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

  const [isDuplicateControlRegistryOpen, setIsDuplicateControlRegistryOpen] = useState(false)
  const [isSelectingDuplicateControlRows, setIsSelectingDuplicateControlRows] = useState(false)
  const [lnkStageTransferReference, setLnkStageTransferReference] = useState<
    (SystemDocumentReference & { documentId: number }) | null
  >(null)
  const [isLnkStageTransferPending, setIsLnkStageTransferPending] = useState(false)
  const [lnkWorkflowRequestSearch, setLnkWorkflowRequestSearch] = useState('')
  const [lnkResultRegistrySearch, setLnkResultRegistrySearch] = useState('')
  const [lnkResultRegistryFilter, setLnkResultRegistryFilter] =
    useState<'all' | 'годен' | 'ремонт' | 'вырез'>('all')
  const [lnkResultRegistryLimit, setLnkResultRegistryLimit] = useState(WORKFLOW_REGISTRY_PAGE_SIZE)
  const [preRegistry, setPreRegistry] = useState<PreHeatTreatmentRegistryFilters & { page: number }>(
    { ...DEFAULT_PRE_HEAT_TREATMENT_REGISTRY_FILTERS, page: 0 },
  )
  const [preHeatTreatmentCandidateSearch, setPreHeatTreatmentCandidateSearch] = useState('')
  const [preHeatTreatmentCandidateIds, setPreHeatTreatmentCandidateIds] = useState<number[] | null>(null)
  const [preHeatTreatmentCandidateFilter, setPreHeatTreatmentCandidateFilter] = useState<{
    methodKeys: WeldFieldKey[]
    requestName: string
    requestDate: string
  }>({ methodKeys: [], requestName: '', requestDate: '' })
  const handlePreHeatTreatmentCandidateFilterChange = useCallback((filter: {
    methodCodes: PreHeatTreatmentLnkMethodCode[]
    request: RequestDocumentIdentity | null
  }) => {
    const methodKeys = filter.methodCodes.flatMap((methodCode) => {
      const method = LNK_METHODS.find((candidate) => candidate.code === methodCode)
      return method ? [method.requestKey] : []
    })
    const requestName = filter.request?.name ?? ''
    const requestDate = filter.request?.date ?? ''
    setPreHeatTreatmentCandidateFilter((current) => (
      current.requestName === requestName &&
      current.requestDate === requestDate &&
      current.methodKeys.length === methodKeys.length &&
      current.methodKeys.every((key, index) => key === methodKeys[index])
        ? current
        : { methodKeys, requestName, requestDate }
    ))
  }, [])
  useEffect(() => {
    if (!isPreHeatTreatmentResultManagerOpen) {
      setPreRegistry({ ...DEFAULT_PRE_HEAT_TREATMENT_REGISTRY_FILTERS, page: 0 })
    }
  }, [isPreHeatTreatmentResultManagerOpen])

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
    startTransition(() => {
      closePrimaryLnkDialogs()
      setPreHeatTreatmentWorkflowMode(null)
      setPreHeatTreatmentResultManagerRowIds(rowIds)
      setPreHeatTreatmentResultManagerInitialRelationId(relationId)
      setPreHeatTreatmentResultManagerMode(registryMode)
      setIsPreHeatTreatmentResultManagerOpen(true)
    })
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
    isDuplicateControlRegistryOpen,
    setIsDuplicateControlRegistryOpen,
    isSelectingDuplicateControlRows,
    setIsSelectingDuplicateControlRows,
    lnkStageTransferReference,
    setLnkStageTransferReference,
    isLnkStageTransferPending,
    setIsLnkStageTransferPending,
    lnkWorkflowRequestSearch,
    setLnkWorkflowRequestSearch,
    lnkResultRegistrySearch,
    setLnkResultRegistrySearch,
    lnkResultRegistryFilter,
    setLnkResultRegistryFilter,
    lnkResultRegistryLimit,
    setLnkResultRegistryLimit,
    preRegistry,
    setPreRegistry,
    preHeatTreatmentCandidateSearch,
    setPreHeatTreatmentCandidateSearch,
    preHeatTreatmentCandidateIds,
    setPreHeatTreatmentCandidateIds,
    preHeatTreatmentCandidateFilter,
    setPreHeatTreatmentCandidateFilter,
    handlePreHeatTreatmentCandidateFilterChange,
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
