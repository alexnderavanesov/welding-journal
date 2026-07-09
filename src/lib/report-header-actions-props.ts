import type { ReportHeaderActionsProps } from '@/components/report-header-actions'
import type { ActiveReport } from '@/lib/home-state'

type CreateReportHeaderActionsPropsOptions = {
  activeReport: ActiveReport
  onOpenImportDialog: () => void
  onCreateWeldJoint: () => void
  importDisabled: boolean
  isWeldingJournalShowMenuOpen: boolean
  onToggleWeldingJournalShowMenu: () => void
  isWeldingJournalGenerateMenuOpen: boolean
  onToggleWeldingJournalGenerateMenu: () => void
  onGenerateWeldingJournalDocument: () => void
  onOpenWeldingJournalCurrentReport: () => void
  onOpenWeldingJournalWaitingWeldReport: () => void
  onOpenWeldingJournalWaitingRequestReport: () => void
  onOpenWeldingJournalWaitingControlReport: () => void
  onOpenWeldingJournalWaitingRepairReport: () => void
  onOpenWeldingJournalCancelledAcceptedReport: () => void
  onOpenWeldingJournalSystemReport: () => void
  onCreatePstoRequest: () => void
  pstoRequestPending: boolean
  onAddPstoResult: () => void
  pstoResultDisabled: boolean
  isPstoShowMenuOpen: boolean
  onTogglePstoShowMenu: () => void
  onOpenPstoCurrentReport: () => void
  onOpenPstoWaitingRequestReport: () => void
  onOpenPstoResultsReport: () => void
  onCreateLnkRequest: () => void
  lnkRequestPending: boolean
  onAddLnkResult: () => void
  lnkResultDisabled: boolean
  onOpenLnkOfficiality: () => void
  lnkOfficialityPending: boolean
  onOpenDuplicateControl: () => void
  duplicateControlPending: boolean
  isLnkShowMenuOpen: boolean
  onToggleLnkShowMenu: () => void
  onOpenLnkCurrentReport: () => void
  onOpenLnkToRequestReport: () => void
  onOpenLnkWaitingNkReport: () => void
  onOpenLnkConclusionsReport: () => void
}

export function createReportHeaderActionsProps({
  activeReport,
  onOpenImportDialog,
  onCreateWeldJoint,
  importDisabled,
  isWeldingJournalShowMenuOpen,
  onToggleWeldingJournalShowMenu,
  isWeldingJournalGenerateMenuOpen,
  onToggleWeldingJournalGenerateMenu,
  onGenerateWeldingJournalDocument,
  onOpenWeldingJournalCurrentReport,
  onOpenWeldingJournalWaitingWeldReport,
  onOpenWeldingJournalWaitingRequestReport,
  onOpenWeldingJournalWaitingControlReport,
  onOpenWeldingJournalWaitingRepairReport,
  onOpenWeldingJournalCancelledAcceptedReport,
  onOpenWeldingJournalSystemReport,
  onCreatePstoRequest,
  pstoRequestPending,
  onAddPstoResult,
  pstoResultDisabled,
  isPstoShowMenuOpen,
  onTogglePstoShowMenu,
  onOpenPstoCurrentReport,
  onOpenPstoWaitingRequestReport,
  onOpenPstoResultsReport,
  onCreateLnkRequest,
  lnkRequestPending,
  onAddLnkResult,
  lnkResultDisabled,
  onOpenLnkOfficiality,
  lnkOfficialityPending,
  onOpenDuplicateControl,
  duplicateControlPending,
  isLnkShowMenuOpen,
  onToggleLnkShowMenu,
  onOpenLnkCurrentReport,
  onOpenLnkToRequestReport,
  onOpenLnkWaitingNkReport,
  onOpenLnkConclusionsReport,
}: CreateReportHeaderActionsPropsOptions): ReportHeaderActionsProps {
  return {
    activeReport,
    onOpenImportDialog,
    onCreateWeldJoint,
    importDisabled,
    isWeldingJournalShowMenuOpen,
    onToggleWeldingJournalShowMenu,
    isWeldingJournalGenerateMenuOpen,
    onToggleWeldingJournalGenerateMenu,
    onGenerateWeldingJournalDocument,
    onOpenWeldingJournalCurrentReport,
    onOpenWeldingJournalWaitingWeldReport,
    onOpenWeldingJournalWaitingRequestReport,
    onOpenWeldingJournalWaitingControlReport,
    onOpenWeldingJournalWaitingRepairReport,
    onOpenWeldingJournalCancelledAcceptedReport,
    onOpenWeldingJournalSystemReport,
    onCreatePstoRequest,
    pstoRequestPending,
    onAddPstoResult,
    pstoResultDisabled,
    isPstoShowMenuOpen,
    onTogglePstoShowMenu,
    onOpenPstoCurrentReport,
    onOpenPstoWaitingRequestReport,
    onOpenPstoResultsReport,
    onCreateLnkRequest,
    lnkRequestPending,
    onAddLnkResult,
    lnkResultDisabled,
    onOpenLnkOfficiality,
    lnkOfficialityPending,
    onOpenDuplicateControl,
    duplicateControlPending,
    isLnkShowMenuOpen,
    onToggleLnkShowMenu,
    onOpenLnkCurrentReport,
    onOpenLnkToRequestReport,
    onOpenLnkWaitingNkReport,
    onOpenLnkConclusionsReport,
  }
}
