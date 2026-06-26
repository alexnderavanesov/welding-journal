import { isAnyReportModalOpen } from '@/lib/report-ui-state'

type ReportModalOpenStateParams = {
  isPstoRequestModalOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultModalOpen: boolean
  isPstoResultManagerOpen: boolean
  isLnkRequestModalOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultModalOpen: boolean
  isLnkResultPreviewOpen: boolean
  isLnkResultManagerOpen: boolean
  isLnkOfficialityModalOpen: boolean
}

export function getReportModalOpenState({
  isPstoRequestModalOpen,
  isPstoRequestManagerOpen,
  isPstoResultModalOpen,
  isPstoResultManagerOpen,
  isLnkRequestModalOpen,
  isLnkRequestManagerOpen,
  isLnkResultModalOpen,
  isLnkResultPreviewOpen,
  isLnkResultManagerOpen,
  isLnkOfficialityModalOpen,
}: ReportModalOpenStateParams) {
  return isAnyReportModalOpen([
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    isLnkResultModalOpen,
    isLnkResultPreviewOpen,
    isLnkResultManagerOpen,
    isLnkOfficialityModalOpen,
  ])
}
