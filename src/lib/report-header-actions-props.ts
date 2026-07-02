import type { ReportHeaderActionsProps } from '@/components/report-header-actions'
import type { ActiveReport } from '@/lib/home-state'

type CreateReportHeaderActionsPropsOptions = {
  activeReport: ActiveReport
  onOpenImportDialog: () => void
  onExportXlsx: () => void
  onCreateWeldJoint: () => void
  importDisabled: boolean
  onCreatePstoRequest: () => void
  pstoRequestPending: boolean
  onAddPstoResult: () => void
  pstoResultDisabled: boolean
  isPstoShowMenuOpen: boolean
  onTogglePstoShowMenu: () => void
  onOpenPstoWaitingRequestReport: () => void
  onOpenPstoResultsReport: () => void
  onCreateLnkRequest: () => void
  lnkRequestPending: boolean
  onAddLnkResult: () => void
  lnkResultDisabled: boolean
  onOpenLnkOfficiality: () => void
  lnkOfficialityPending: boolean
  isLnkShowMenuOpen: boolean
  onToggleLnkShowMenu: () => void
  onOpenLnkToRequestReport: () => void
  onOpenLnkWaitingNkReport: () => void
  onOpenLnkConclusionsReport: () => void
}

export function createReportHeaderActionsProps({
  activeReport,
  onOpenImportDialog,
  onExportXlsx,
  onCreateWeldJoint,
  importDisabled,
  onCreatePstoRequest,
  pstoRequestPending,
  onAddPstoResult,
  pstoResultDisabled,
  isPstoShowMenuOpen,
  onTogglePstoShowMenu,
  onOpenPstoWaitingRequestReport,
  onOpenPstoResultsReport,
  onCreateLnkRequest,
  lnkRequestPending,
  onAddLnkResult,
  lnkResultDisabled,
  onOpenLnkOfficiality,
  lnkOfficialityPending,
  isLnkShowMenuOpen,
  onToggleLnkShowMenu,
  onOpenLnkToRequestReport,
  onOpenLnkWaitingNkReport,
  onOpenLnkConclusionsReport,
}: CreateReportHeaderActionsPropsOptions): ReportHeaderActionsProps {
  return {
    activeReport,
    onOpenImportDialog,
    onExportXlsx,
    onCreateWeldJoint,
    importDisabled,
    onCreatePstoRequest,
    pstoRequestPending,
    onAddPstoResult,
    pstoResultDisabled,
    isPstoShowMenuOpen,
    onTogglePstoShowMenu,
    onOpenPstoWaitingRequestReport,
    onOpenPstoResultsReport,
    onCreateLnkRequest,
    lnkRequestPending,
    onAddLnkResult,
    lnkResultDisabled,
    onOpenLnkOfficiality,
    lnkOfficialityPending,
    isLnkShowMenuOpen,
    onToggleLnkShowMenu,
    onOpenLnkToRequestReport,
    onOpenLnkWaitingNkReport,
    onOpenLnkConclusionsReport,
  }
}
