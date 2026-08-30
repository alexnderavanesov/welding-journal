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
  onGenerateChecklistDocument: () => void
  onGenerateZniDocument: () => void
  onOpenWeldingJournalCurrentReport: () => void
  onOpenWeldingJournalWaitingWeldReport: () => void
  onOpenWeldingJournalWaitingRequestReport: () => void
  onOpenWeldingJournalWaitingControlReport: () => void
  onOpenWeldingJournalWaitingRepairReport: () => void
  onOpenWeldingJournalCancelledAcceptedReport: () => void
  onOpenWeldingJournalSystemReport: () => void
  onCreatePstoRequest: () => void
  createPstoRequestDisabled: boolean
  onOpenPstoLineProgram: () => void
  onEditSelectedPstoRequest: () => void
  editSelectedPstoRequestDisabled: boolean
  onOpenPstoRequestRegistry: () => void
  pstoRequestPending: boolean
  onAddPstoResult: () => void
  pstoResultDisabled: boolean
  onEditSelectedPstoResults: () => void
  editSelectedPstoResultsDisabled: boolean
  onOpenPstoResultRegistry: () => void
  pstoResultRegistryDisabled: boolean
  onCreateTvmtRequest: () => void
  createTvmtRequestDisabled: boolean
  onAddTvmtResult: () => void
  addTvmtResultDisabled: boolean
  tvmtPending: boolean
  isPstoShowMenuOpen: boolean
  onTogglePstoShowMenu: () => void
  onOpenPstoCurrentReport: () => void
  onOpenPstoWaitingRequestReport: () => void
  onOpenPstoResultsReport: () => void
  onPstoWorkflowMenuOpenChange: (open: boolean) => void
  onCreateLnkRequest: () => void
  onExtendLnkRequest: () => void
  onOpenLnkRequestRegistry: () => void
  lnkRequestPending: boolean
  onAddLnkResult: () => void
  lnkResultDisabled: boolean
  onEditSelectedLnkResults: () => void
  editSelectedLnkResultsDisabled: boolean
  onOpenLnkResultRegistry: () => void
  lnkResultRegistryDisabled: boolean
  onOpenPreHeatTreatmentLnkResultRegistry: (mode?: 'request' | 'result') => void
  preHeatTreatmentLnkResultRegistryDisabled: boolean
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
  onLnkWorkflowMenuOpenChange: (open: boolean) => void
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
  onGenerateChecklistDocument,
  onGenerateZniDocument,
  onOpenWeldingJournalCurrentReport,
  onOpenWeldingJournalWaitingWeldReport,
  onOpenWeldingJournalWaitingRequestReport,
  onOpenWeldingJournalWaitingControlReport,
  onOpenWeldingJournalWaitingRepairReport,
  onOpenWeldingJournalCancelledAcceptedReport,
  onOpenWeldingJournalSystemReport,
  onCreatePstoRequest,
  createPstoRequestDisabled,
  onOpenPstoLineProgram,
  onEditSelectedPstoRequest,
  editSelectedPstoRequestDisabled,
  onOpenPstoRequestRegistry,
  pstoRequestPending,
  onAddPstoResult,
  pstoResultDisabled,
  onEditSelectedPstoResults,
  editSelectedPstoResultsDisabled,
  onOpenPstoResultRegistry,
  pstoResultRegistryDisabled,
  onCreateTvmtRequest,
  createTvmtRequestDisabled,
  onAddTvmtResult,
  addTvmtResultDisabled,
  tvmtPending,
  isPstoShowMenuOpen,
  onTogglePstoShowMenu,
  onOpenPstoCurrentReport,
  onOpenPstoWaitingRequestReport,
  onOpenPstoResultsReport,
  onPstoWorkflowMenuOpenChange,
  onCreateLnkRequest,
  onExtendLnkRequest,
  onOpenLnkRequestRegistry,
  lnkRequestPending,
  onAddLnkResult,
  lnkResultDisabled,
  onEditSelectedLnkResults,
  editSelectedLnkResultsDisabled,
  onOpenLnkResultRegistry,
  lnkResultRegistryDisabled,
  onOpenPreHeatTreatmentLnkResultRegistry,
  preHeatTreatmentLnkResultRegistryDisabled,
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
  onLnkWorkflowMenuOpenChange,
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
    onGenerateChecklistDocument,
    onGenerateZniDocument,
    onOpenWeldingJournalCurrentReport,
    onOpenWeldingJournalWaitingWeldReport,
    onOpenWeldingJournalWaitingRequestReport,
    onOpenWeldingJournalWaitingControlReport,
    onOpenWeldingJournalWaitingRepairReport,
    onOpenWeldingJournalCancelledAcceptedReport,
    onOpenWeldingJournalSystemReport,
    onCreatePstoRequest,
    createPstoRequestDisabled,
    onOpenPstoLineProgram,
    onEditSelectedPstoRequest,
    editSelectedPstoRequestDisabled,
    onOpenPstoRequestRegistry,
    pstoRequestPending,
    onAddPstoResult,
    pstoResultDisabled,
    onEditSelectedPstoResults,
    editSelectedPstoResultsDisabled,
    onOpenPstoResultRegistry,
    pstoResultRegistryDisabled,
    onCreateTvmtRequest,
    createTvmtRequestDisabled,
    onAddTvmtResult,
    addTvmtResultDisabled,
    tvmtPending,
    isPstoShowMenuOpen,
    onTogglePstoShowMenu,
    onOpenPstoCurrentReport,
    onOpenPstoWaitingRequestReport,
    onOpenPstoResultsReport,
    onPstoWorkflowMenuOpenChange,
    onCreateLnkRequest,
    onExtendLnkRequest,
    onOpenLnkRequestRegistry,
    lnkRequestPending,
    onAddLnkResult,
    lnkResultDisabled,
    onEditSelectedLnkResults,
    editSelectedLnkResultsDisabled,
    onOpenLnkResultRegistry,
    lnkResultRegistryDisabled,
    onOpenPreHeatTreatmentLnkResultRegistry,
    preHeatTreatmentLnkResultRegistryDisabled,
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
    onLnkWorkflowMenuOpenChange,
  }
}
