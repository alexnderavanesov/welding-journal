import { FileSpreadsheet, Plus, Upload } from 'lucide-react'
import { HeatTreatmentHeaderActions, LnkHeaderActions } from '@/components/report-header-action-groups'
import { Button } from '@/components/ui/button'
import type { ActiveReport } from '@/lib/home-state'

export type ReportHeaderActionsProps = {
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

export function ReportHeaderActions({
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
          isShowMenuOpen={isLnkShowMenuOpen}
          onToggleShowMenu={onToggleLnkShowMenu}
          onOpenToRequestReport={onOpenLnkToRequestReport}
          onOpenWaitingNkReport={onOpenLnkWaitingNkReport}
          onOpenConclusionsReport={onOpenLnkConclusionsReport}
        />
      ) : null}
      {activeReport === 'weldingJournal' ? (
        <Button onClick={onCreateWeldJoint}>
          <Plus className="mr-2 h-4 w-4" />
          Новый стык
        </Button>
      ) : null}
      {activeReport === 'weldingJournal' ? (
        <Button variant="outline" onClick={onOpenImportDialog} disabled={importDisabled}>
          <Upload className="mr-2 h-4 w-4" />
          Импорт
        </Button>
      ) : null}
      {activeReport !== 'welderStamps' ? (
        <Button variant="outline" onClick={onExportXlsx}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Excel
        </Button>
      ) : null}
    </div>
  )
}
