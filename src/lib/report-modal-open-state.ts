import { isAnyReportModalOpen } from '@/lib/report-ui-state'

export function hasOpenReportDialogProps(dialogProps: Record<string, unknown>) {
  return Object.values(dialogProps).some(Boolean)
}

type ReportModalOpenStateParams = {
  isPstoRequestModalOpen: boolean
  isPstoRequestManagerOpen: boolean
  isPstoResultModalOpen: boolean
  isPstoResultManagerOpen: boolean
  isLnkRequestModalOpen: boolean
  isLnkRequestManagerOpen: boolean
  isLnkResultModalOpen: boolean
  isLnkResultManagerOpen: boolean
  isLnkOfficialityModalOpen: boolean
  isDuplicateControlModalOpen?: boolean
}

export function getReportModalOpenState({
  isPstoRequestModalOpen,
  isPstoRequestManagerOpen,
  isPstoResultModalOpen,
  isPstoResultManagerOpen,
  isLnkRequestModalOpen,
  isLnkRequestManagerOpen,
  isLnkResultModalOpen,
  isLnkResultManagerOpen,
  isLnkOfficialityModalOpen,
  isDuplicateControlModalOpen = false,
}: ReportModalOpenStateParams) {
  return isAnyReportModalOpen([
    isPstoRequestModalOpen,
    isPstoRequestManagerOpen,
    isPstoResultModalOpen,
    isPstoResultManagerOpen,
    isLnkRequestModalOpen,
    isLnkRequestManagerOpen,
    isLnkResultModalOpen,
    isLnkResultManagerOpen,
    isLnkOfficialityModalOpen,
    isDuplicateControlModalOpen,
  ])
}
