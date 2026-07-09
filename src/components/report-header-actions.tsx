import { HeatTreatmentHeaderActions, LnkHeaderActions, WeldingJournalHeaderActions } from '@/components/report-header-action-groups'
import type { ActiveReport } from '@/lib/home-state'

export type ReportHeaderActionsProps = {
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

export function ReportHeaderActions({
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
}: ReportHeaderActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 lg:pt-0.5">
      {activeReport === 'heatTreatment' ? (
        <HeatTreatmentHeaderActions
          onCreateRequest={onCreatePstoRequest}
          requestPending={pstoRequestPending}
          onAddResult={onAddPstoResult}
          resultDisabled={pstoResultDisabled}
          isShowMenuOpen={isPstoShowMenuOpen}
          onToggleShowMenu={onTogglePstoShowMenu}
          onOpenCurrentReport={onOpenPstoCurrentReport}
          onOpenWaitingRequestReport={onOpenPstoWaitingRequestReport}
          onOpenResultsReport={onOpenPstoResultsReport}
        />
      ) : null}
      {activeReport === 'lnk' ? (
        <LnkHeaderActions
          onCreateRequest={onCreateLnkRequest}
          requestPending={lnkRequestPending}
          onAddResult={onAddLnkResult}
          resultDisabled={lnkResultDisabled}
          onOpenOfficiality={onOpenLnkOfficiality}
          officialityPending={lnkOfficialityPending}
          onOpenDuplicateControl={onOpenDuplicateControl}
          duplicateControlPending={duplicateControlPending}
          isShowMenuOpen={isLnkShowMenuOpen}
          onToggleShowMenu={onToggleLnkShowMenu}
          onOpenCurrentReport={onOpenLnkCurrentReport}
          onOpenToRequestReport={onOpenLnkToRequestReport}
          onOpenWaitingNkReport={onOpenLnkWaitingNkReport}
          onOpenConclusionsReport={onOpenLnkConclusionsReport}
        />
      ) : null}
      {activeReport === 'weldingJournal' ? (
        <WeldingJournalHeaderActions
          onCreateWeldJoint={onCreateWeldJoint}
          onOpenImportDialog={onOpenImportDialog}
          importDisabled={importDisabled}
          isShowMenuOpen={isWeldingJournalShowMenuOpen}
          onToggleShowMenu={onToggleWeldingJournalShowMenu}
          isGenerateMenuOpen={isWeldingJournalGenerateMenuOpen}
          onToggleGenerateMenu={onToggleWeldingJournalGenerateMenu}
          onGenerateWeldingJournalDocument={onGenerateWeldingJournalDocument}
          onOpenCurrentReport={onOpenWeldingJournalCurrentReport}
          onOpenWaitingWeldReport={onOpenWeldingJournalWaitingWeldReport}
          onOpenWaitingRequestReport={onOpenWeldingJournalWaitingRequestReport}
          onOpenWaitingControlReport={onOpenWeldingJournalWaitingControlReport}
          onOpenWaitingRepairReport={onOpenWeldingJournalWaitingRepairReport}
          onOpenCancelledAcceptedReport={onOpenWeldingJournalCancelledAcceptedReport}
          onOpenSystemReport={onOpenWeldingJournalSystemReport}
        />
      ) : null}
    </div>
  )
}
