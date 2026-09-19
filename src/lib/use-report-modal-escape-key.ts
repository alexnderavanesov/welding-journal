import { useEffect } from 'react'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'

type ReportModalEscapeKeyOptions = {
  isReportModalOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultManagerOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultManagerOpen: boolean
  isLnkStageTransferOpen?: boolean
  isPreHeatTreatmentWorkflowOpen?: boolean
  isPreHeatTreatmentResultManagerOpen?: boolean
  isTvmtWorkflowOpen?: boolean
  isPstoRepeatWorkflowOpen?: boolean
  isPstoLineProgramOpen?: boolean
  isRkExposureModalOpen: boolean
  isPstoResultModalOpen: boolean
  isPstoRequestModalOpen: boolean
  isLnkOfficialityModalOpen: boolean
  isDuplicateControlModalOpen?: boolean
  isLnkResultModalOpen: boolean
  isLnkRequestModalOpen: boolean
  isReportImportModalOpen: boolean
  canClosePstoRequestManager: boolean
  canClosePstoResultManager: boolean
  canCloseLnkRequestManager: boolean
  canCloseLnkResultManager: boolean
  canCloseLnkStageTransfer?: boolean
  canClosePreHeatTreatmentResultManager?: boolean
  canCloseRkExposureModal: boolean
  onClosePstoRequestManager: () => void
  onClosePstoResultManager: () => void
  onCloseLnkRequestManager: () => void
  onCloseLnkResultManager: () => void
  onCloseLnkStageTransfer?: () => void
  onClosePreHeatTreatmentWorkflow?: () => void
  onClosePreHeatTreatmentResultManager?: () => void
  onCloseTvmtWorkflow?: () => void
  onClosePstoRepeatWorkflow?: () => void
  onClosePstoLineProgram?: () => void
  onCloseRkExposureModal: () => void
  onClosePstoResultModal: () => void
  onClosePstoRequestModal: () => void
  onCloseLnkOfficialityModal: () => void
  onCloseDuplicateControlModal?: () => void
  onCloseLnkResultModal: () => void
  onCloseLnkRequestModal: () => void
  onCloseReportImportModal: () => void
}

export function useReportModalEscapeKey({
  isReportModalOpen,
  isPstoRequestManagerOpen,
  isPstoResultManagerOpen,
  isLnkRequestManagerOpen,
  isLnkResultManagerOpen,
  isLnkStageTransferOpen = false,
  isPreHeatTreatmentWorkflowOpen = false,
  isPreHeatTreatmentResultManagerOpen = false,
  isTvmtWorkflowOpen = false,
  isPstoRepeatWorkflowOpen = false,
  isPstoLineProgramOpen = false,
  isRkExposureModalOpen,
  isPstoResultModalOpen,
  isPstoRequestModalOpen,
  isLnkOfficialityModalOpen,
  isDuplicateControlModalOpen = false,
  isLnkResultModalOpen,
  isLnkRequestModalOpen,
  isReportImportModalOpen,
  canClosePstoRequestManager,
  canClosePstoResultManager,
  canCloseLnkRequestManager,
  canCloseLnkResultManager,
  canCloseLnkStageTransfer = true,
  canClosePreHeatTreatmentResultManager = true,
  canCloseRkExposureModal,
  onClosePstoRequestManager,
  onClosePstoResultManager,
  onCloseLnkRequestManager,
  onCloseLnkResultManager,
  onCloseLnkStageTransfer,
  onClosePreHeatTreatmentWorkflow,
  onClosePreHeatTreatmentResultManager,
  onCloseTvmtWorkflow,
  onClosePstoRepeatWorkflow,
  onClosePstoLineProgram,
  onCloseRkExposureModal,
  onClosePstoResultModal,
  onClosePstoRequestModal,
  onCloseLnkOfficialityModal,
  onCloseDuplicateControlModal,
  onCloseLnkResultModal,
  onCloseLnkRequestModal,
  onCloseReportImportModal,
}: ReportModalEscapeKeyOptions) {
  useEffect(() => {
    if (!isReportModalOpen) return

    function handleReportModalKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (shouldDeferModalEscape()) return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (isReportImportModalOpen) {
        onCloseReportImportModal()
        return
      }
      if (isLnkStageTransferOpen) {
        if (canCloseLnkStageTransfer) onCloseLnkStageTransfer?.()
        return
      }
      if (isPstoLineProgramOpen) {
        onClosePstoLineProgram?.()
        return
      }
      if (isPreHeatTreatmentWorkflowOpen) {
        onClosePreHeatTreatmentWorkflow?.()
        return
      }
      if (isTvmtWorkflowOpen) {
        onCloseTvmtWorkflow?.()
        return
      }
      if (isPstoRepeatWorkflowOpen) {
        onClosePstoRepeatWorkflow?.()
        return
      }
      if (isPstoRequestManagerOpen) {
        if (canClosePstoRequestManager) onClosePstoRequestManager()
        return
      }
      if (isPstoResultManagerOpen) {
        if (canClosePstoResultManager) onClosePstoResultManager()
        return
      }
      if (isLnkRequestManagerOpen) {
        if (canCloseLnkRequestManager) onCloseLnkRequestManager()
        return
      }
      if (isLnkResultManagerOpen) {
        if (canCloseLnkResultManager) onCloseLnkResultManager()
        return
      }
      if (isPreHeatTreatmentResultManagerOpen) {
        if (canClosePreHeatTreatmentResultManager) onClosePreHeatTreatmentResultManager?.()
        return
      }
      if (isRkExposureModalOpen) {
        if (canCloseRkExposureModal) onCloseRkExposureModal()
        return
      }
      if (isPstoResultModalOpen) {
        onClosePstoResultModal()
        return
      }
      if (isPstoRequestModalOpen) {
        onClosePstoRequestModal()
        return
      }
      if (isLnkOfficialityModalOpen) {
        onCloseLnkOfficialityModal()
        return
      }
      if (isDuplicateControlModalOpen) {
        onCloseDuplicateControlModal?.()
        return
      }
      if (isLnkResultModalOpen) {
        onCloseLnkResultModal()
        return
      }
      if (isLnkRequestModalOpen) {
        onCloseLnkRequestModal()
      }
    }

    window.addEventListener('keydown', handleReportModalKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleReportModalKeyDown, { capture: true })
  }, [
    isReportModalOpen,
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
    isLnkStageTransferOpen,
    isPreHeatTreatmentWorkflowOpen,
    isPreHeatTreatmentResultManagerOpen,
    isTvmtWorkflowOpen,
    isPstoRepeatWorkflowOpen,
    isPstoLineProgramOpen,
    isRkExposureModalOpen,
    isPstoResultModalOpen,
    isPstoRequestModalOpen,
    isLnkOfficialityModalOpen,
    isDuplicateControlModalOpen,
    isLnkResultModalOpen,
    isLnkRequestModalOpen,
    isReportImportModalOpen,
    canClosePstoRequestManager,
    canClosePstoResultManager,
    canCloseLnkRequestManager,
    canCloseLnkResultManager,
    canCloseLnkStageTransfer,
    canClosePreHeatTreatmentResultManager,
    canCloseRkExposureModal,
    onClosePstoRequestManager,
    onClosePstoResultManager,
    onCloseLnkRequestManager,
    onCloseLnkResultManager,
    onCloseLnkStageTransfer,
    onClosePreHeatTreatmentWorkflow,
    onClosePreHeatTreatmentResultManager,
    onCloseTvmtWorkflow,
    onClosePstoRepeatWorkflow,
    onClosePstoLineProgram,
    onCloseRkExposureModal,
    onClosePstoResultModal,
    onClosePstoRequestModal,
    onCloseLnkOfficialityModal,
    onCloseDuplicateControlModal,
    onCloseLnkResultModal,
    onCloseLnkRequestModal,
    onCloseReportImportModal,
  ])
}

export function shouldDeferModalEscape() {
  return Boolean(
    document.querySelector('[data-confirm-action-dialog="true"]') ||
    document.querySelector('[data-dispatcher-action-menu="true"]') ||
    isContextActionMenuOpen(),
  )
}
