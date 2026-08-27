import { useEffect } from 'react'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'

type ReportModalEscapeKeyOptions = {
  isReportModalOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultManagerOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultManagerOpen: boolean
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
  canCloseRkExposureModal: boolean
  onClosePstoRequestManager: () => void
  onClosePstoResultManager: () => void
  onCloseLnkRequestManager: () => void
  onCloseLnkResultManager: () => void
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
  canCloseRkExposureModal,
  onClosePstoRequestManager,
  onClosePstoResultManager,
  onCloseLnkRequestManager,
  onCloseLnkResultManager,
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
      if (document.querySelector('[data-confirm-action-dialog="true"]')) return
      if (isContextActionMenuOpen()) return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (isReportImportModalOpen) {
        onCloseReportImportModal()
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
    canCloseRkExposureModal,
    onClosePstoRequestManager,
    onClosePstoResultManager,
    onCloseLnkRequestManager,
    onCloseLnkResultManager,
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
