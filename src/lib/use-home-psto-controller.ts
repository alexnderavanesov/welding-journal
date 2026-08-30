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
