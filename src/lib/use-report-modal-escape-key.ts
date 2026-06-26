import { useEffect } from 'react'

type ReportModalEscapeKeyOptions = {
  isReportModalOpen: boolean
  isLnkResultPreviewOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultManagerOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultManagerOpen: boolean
  isPstoResultModalOpen: boolean
  isPstoRequestModalOpen: boolean
  isLnkOfficialityModalOpen: boolean
  isLnkResultModalOpen: boolean
  isLnkRequestModalOpen: boolean
  canClosePstoRequestManager: boolean
  canClosePstoResultManager: boolean
  canCloseLnkRequestManager: boolean
  canCloseLnkResultManager: boolean
  onCloseLnkResultPreview: () => void
  onClosePstoRequestManager: () => void
  onClosePstoResultManager: () => void
  onCloseLnkRequestManager: () => void
  onCloseLnkResultManager: () => void
  onClosePstoResultModal: () => void
  onClosePstoRequestModal: () => void
  onCloseLnkOfficialityModal: () => void
  onCloseLnkResultModal: () => void
  onCloseLnkRequestModal: () => void
}

export function useReportModalEscapeKey({
  isReportModalOpen,
  isLnkResultPreviewOpen,
  isPstoRequestManagerOpen,
  isPstoResultManagerOpen,
  isLnkRequestManagerOpen,
  isLnkResultManagerOpen,
  isPstoResultModalOpen,
  isPstoRequestModalOpen,
  isLnkOfficialityModalOpen,
  isLnkResultModalOpen,
  isLnkRequestModalOpen,
  canClosePstoRequestManager,
  canClosePstoResultManager,
  canCloseLnkRequestManager,
  canCloseLnkResultManager,
  onCloseLnkResultPreview,
  onClosePstoRequestManager,
  onClosePstoResultManager,
  onCloseLnkRequestManager,
  onCloseLnkResultManager,
  onClosePstoResultModal,
  onClosePstoRequestModal,
  onCloseLnkOfficialityModal,
  onCloseLnkResultModal,
  onCloseLnkRequestModal,
}: ReportModalEscapeKeyOptions) {
  useEffect(() => {
    if (!isReportModalOpen) return

    function handleReportModalKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (isLnkResultPreviewOpen) {
        onCloseLnkResultPreview()
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
    isLnkResultPreviewOpen,
    isPstoRequestManagerOpen,
    isPstoResultManagerOpen,
    isLnkRequestManagerOpen,
    isLnkResultManagerOpen,
    isPstoResultModalOpen,
    isPstoRequestModalOpen,
    isLnkOfficialityModalOpen,
    isLnkResultModalOpen,
    isLnkRequestModalOpen,
    canClosePstoRequestManager,
    canClosePstoResultManager,
    canCloseLnkRequestManager,
    canCloseLnkResultManager,
    onCloseLnkResultPreview,
    onClosePstoRequestManager,
    onClosePstoResultManager,
    onCloseLnkRequestManager,
    onCloseLnkResultManager,
    onClosePstoResultModal,
    onClosePstoRequestModal,
    onCloseLnkOfficialityModal,
    onCloseLnkResultModal,
    onCloseLnkRequestModal,
  ])
}
