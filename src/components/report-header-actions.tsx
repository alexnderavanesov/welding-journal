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
}: ReportHeaderActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 lg:pt-0.5">
      {activeReport === 'heatTreatment' ? (
        <HeatTreatmentHeaderActions
          onOpenLineProgram={onOpenPstoLineProgram}
          onCreateRequest={onCreatePstoRequest}
          createRequestDisabled={createPstoRequestDisabled}
          onEditSelectedRequest={onEditSelectedPstoRequest}
          editSelectedRequestDisabled={editSelectedPstoRequestDisabled}
          onOpenRequestRegistry={onOpenPstoRequestRegistry}
          requestPending={pstoRequestPending}
          onAddResult={onAddPstoResult}
          resultDisabled={pstoResultDisabled}
          onEditSelectedResults={onEditSelectedPstoResults}
          editSelectedResultsDisabled={editSelectedPstoResultsDisabled}
          onOpenResultRegistry={onOpenPstoResultRegistry}
          resultRegistryDisabled={pstoResultRegistryDisabled}
          onCreateTvmtRequest={onCreateTvmtRequest}
          createTvmtRequestDisabled={createTvmtRequestDisabled}
          onAddTvmtResult={onAddTvmtResult}
          addTvmtResultDisabled={addTvmtResultDisabled}
          tvmtPending={tvmtPending}
          isShowMenuOpen={isPstoShowMenuOpen}
          onToggleShowMenu={onTogglePstoShowMenu}
          onOpenCurrentReport={onOpenPstoCurrentReport}
          onOpenWaitingRequestReport={onOpenPstoWaitingRequestReport}
          onOpenResultsReport={onOpenPstoResultsReport}
          onWorkflowMenuOpenChange={onPstoWorkflowMenuOpenChange}
        />
      ) : null}
      {activeReport === 'lnk' ? (
        <LnkHeaderActions
          onCreateRequest={onCreateLnkRequest}
          onExtendRequest={onExtendLnkRequest}
          onOpenRequestRegistry={onOpenLnkRequestRegistry}
          requestPending={lnkRequestPending}
          onAddResult={onAddLnkResult}
          resultDisabled={lnkResultDisabled}
          onEditSelectedResults={onEditSelectedLnkResults}
          editSelectedResultsDisabled={editSelectedLnkResultsDisabled}
          onOpenResultRegistry={onOpenLnkResultRegistry}
          resultRegistryDisabled={lnkResultRegistryDisabled}
          onOpenPreHeatTreatmentResultRegistry={onOpenPreHeatTreatmentLnkResultRegistry}
          preHeatTreatmentResultRegistryDisabled={preHeatTreatmentLnkResultRegistryDisabled}
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
          onWorkflowMenuOpenChange={onLnkWorkflowMenuOpenChange}
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
          onGenerateChecklistDocument={onGenerateChecklistDocument}
          onGenerateZniDocument={onGenerateZniDocument}
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
