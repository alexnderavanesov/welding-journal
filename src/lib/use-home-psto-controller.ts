import { type RequestDocumentIdentity } from '@/lib/request-document-identity'
import { WORKFLOW_REGISTRY_PAGE_SIZE } from '@/server/weld-contracts'

import { useCallback, useRef, useState } from 'react'
import { usePstoModalState } from '@/lib/use-psto-modal-state'

export function useHomePstoController() {
  const modal = usePstoModalState()
  const {
    setIsPstoRequestManagerOpen,
    setIsPstoRequestModalOpen,
    setIsPstoResultManagerOpen,
    setIsPstoResultModalOpen,
  } = modal
  const [isPstoResultRegistryAll, setIsPstoResultRegistryAll] = useState(false)
  const pstoResultRegistryInitializedRef = useRef(false)
  const [tvmtWorkflowMode, setTvmtWorkflowMode] = useState<'request' | 'result' | null>(null)
  const [pstoRepeatWorkflowMode, setPstoRepeatWorkflowMode] = useState<'request' | 'result' | null>(null)
  const [isPstoLineProgramOpen, setIsPstoLineProgramOpen] = useState(false)
  const [isPstoWorkflowMenuOpen, setIsPstoWorkflowMenuOpen] = useState(false)

  const { setManagedPstoDiagramDrafts, setPstoResultDraft } = modal
  const [pstoResultRegistrySearch, setPstoResultRegistrySearch] = useState('')
  const [pstoResultRegistryLimit, setPstoResultRegistryLimit] = useState(WORKFLOW_REGISTRY_PAGE_SIZE)
  const [pstoWorkflowRequestSearch, setPstoWorkflowRequestSearch] = useState('')
  const [pstoRepeatCandidateIds, setPstoRepeatCandidateIds] = useState<number[] | null>(null)
  const [tvmtCandidateIds, setTvmtCandidateIds] = useState<number[] | null>(null)
  const [pstoRepeatCandidateSearch, setPstoRepeatCandidateSearch] = useState('')
  const [tvmtCandidateSearch, setTvmtCandidateSearch] = useState('')
  const [pstoRepeatCandidateRequest, setPstoRepeatCandidateRequest] = useState({ name: '', date: '' })
  const [tvmtCandidateRequest, setTvmtCandidateRequest] = useState({ name: '', date: '' })
  const handlePstoRepeatCandidateRequestChange = useCallback((request: RequestDocumentIdentity | null) => {
    const name = request?.name ?? ''
    const date = request?.date ?? ''
    setPstoRepeatCandidateRequest((current) => (
      current.name === name && current.date === date ? current : { name, date }
    ))
  }, [])
  const handleTvmtCandidateRequestChange = useCallback((request: RequestDocumentIdentity | null) => {
    const name = request?.name ?? ''
    const date = request?.date ?? ''
    setTvmtCandidateRequest((current) => (
      current.name === name && current.date === date ? current : { name, date }
    ))
  }, [])
  const closePstoResultManager = () => {
    setIsPstoResultRegistryAll(false)
    setIsPstoResultManagerOpen(false)
    setManagedPstoDiagramDrafts({})
    setPstoResultRegistrySearch('')
    setPstoResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
  }
  const openAllPstoHistory = () => {
    setIsPstoResultRegistryAll(true)
    setPstoResultRegistrySearch('')
    setPstoResultRegistryLimit(WORKFLOW_REGISTRY_PAGE_SIZE)
    setPstoResultDraft((current) => ({ ...current, rowIds: new Set() }))
    setManagedPstoDiagramDrafts({})
    setIsPstoResultManagerOpen(true)
  }

  const closePrimaryPstoDialogs = useCallback(() => {
    setIsPstoRequestModalOpen(false)
    setIsPstoRequestManagerOpen(false)
    setIsPstoResultModalOpen(false)
    setIsPstoResultManagerOpen(false)
    setIsPstoResultRegistryAll(false)
  }, [
    setIsPstoRequestManagerOpen,
    setIsPstoRequestModalOpen,
    setIsPstoResultManagerOpen,
    setIsPstoResultModalOpen,
  ])

  const openTvmtWorkflow = useCallback((mode: 'request' | 'result') => {
    closePrimaryPstoDialogs()
    setPstoRepeatWorkflowMode(null)
    setIsPstoLineProgramOpen(false)
    setTvmtWorkflowMode(mode)
  }, [closePrimaryPstoDialogs])

  const openPstoRepeatWorkflow = useCallback((mode: 'request' | 'result') => {
    closePrimaryPstoDialogs()
    setTvmtWorkflowMode(null)
    setIsPstoLineProgramOpen(false)
    setPstoRepeatWorkflowMode(mode)
  }, [closePrimaryPstoDialogs])

  const openPstoLineProgram = useCallback(() => {
    closePrimaryPstoDialogs()
    setTvmtWorkflowMode(null)
    setPstoRepeatWorkflowMode(null)
    setIsPstoLineProgramOpen(true)
  }, [closePrimaryPstoDialogs])

  return {
    ...modal,
    pstoResultRegistrySearch,
    setPstoResultRegistrySearch,
    pstoResultRegistryLimit,
    setPstoResultRegistryLimit,
    pstoWorkflowRequestSearch,
    setPstoWorkflowRequestSearch,
    pstoRepeatCandidateIds,
    setPstoRepeatCandidateIds,
    tvmtCandidateIds,
    setTvmtCandidateIds,
    pstoRepeatCandidateSearch,
    setPstoRepeatCandidateSearch,
    tvmtCandidateSearch,
    setTvmtCandidateSearch,
    pstoRepeatCandidateRequest,
    setPstoRepeatCandidateRequest,
    tvmtCandidateRequest,
    setTvmtCandidateRequest,
    handlePstoRepeatCandidateRequestChange,
    handleTvmtCandidateRequestChange,
    closePstoResultManager,
    openAllPstoHistory,
    isPstoResultRegistryAll,
    setIsPstoResultRegistryAll,
    pstoResultRegistryInitializedRef,
    tvmtWorkflowMode,
    setTvmtWorkflowMode,
    pstoRepeatWorkflowMode,
    setPstoRepeatWorkflowMode,
    isPstoLineProgramOpen,
    setIsPstoLineProgramOpen,
    isPstoWorkflowMenuOpen,
    setIsPstoWorkflowMenuOpen,
    closePrimaryPstoDialogs,
    openTvmtWorkflow,
    openPstoRepeatWorkflow,
    openPstoLineProgram,
  }
}
