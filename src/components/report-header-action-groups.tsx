import { ClipboardCheck, CopyCheck, Plus, ShieldCheck, Upload } from 'lucide-react'
import { ReportShowMenu } from '@/components/report-show-menu'
import { Button } from '@/components/ui/button'

type WeldingJournalHeaderActionsProps = {
  onCreateWeldJoint: () => void
  onOpenImportDialog: () => void
  importDisabled: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  isGenerateMenuOpen: boolean
  onToggleGenerateMenu: () => void
  onGenerateWeldingJournalDocument: () => void
  onOpenCurrentReport: () => void
  onOpenWaitingWeldReport: () => void
  onOpenWaitingRequestReport: () => void
  onOpenWaitingControlReport: () => void
  onOpenWaitingRepairReport: () => void
  onOpenCancelledAcceptedReport: () => void
  onOpenSystemReport: () => void
}

export function WeldingJournalHeaderActions({
  onCreateWeldJoint,
  onOpenImportDialog,
  importDisabled,
  isShowMenuOpen,
  onToggleShowMenu,
  isGenerateMenuOpen,
  onToggleGenerateMenu,
  onGenerateWeldingJournalDocument,
  onOpenCurrentReport,
  onOpenWaitingWeldReport,
  onOpenWaitingRequestReport,
  onOpenWaitingControlReport,
  onOpenWaitingRepairReport,
  onOpenCancelledAcceptedReport,
  onOpenSystemReport,
}: WeldingJournalHeaderActionsProps) {
  return (
    <>
      <Button onClick={onCreateWeldJoint}>
        <Plus className="mr-2 h-4 w-4" />
        Новый стык
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        widthClassName="w-64"
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport },
          { label: 'Системная версия', onClick: onOpenSystemReport },
          { label: 'Ожидает сварку', onClick: onOpenWaitingWeldReport },
          { label: 'Ожидает заявки', onClick: onOpenWaitingRequestReport },
          { label: 'Ожидает контроль', onClick: onOpenWaitingControlReport },
          { label: 'Ожидает ремонт', onClick: onOpenWaitingRepairReport },
          { label: 'Отмененные годные результаты', onClick: onOpenCancelledAcceptedReport },
        ]}
      />
      <ReportShowMenu
        label="Сформировать"
        isOpen={isGenerateMenuOpen}
        onToggle={onToggleGenerateMenu}
        widthClassName="w-56"
        items={[{ label: 'Сварочный журнал', onClick: onGenerateWeldingJournalDocument }]}
      />
      <Button variant="outline" onClick={onOpenImportDialog} disabled={importDisabled}>
        <Upload className="mr-2 h-4 w-4" />
        Импорт
      </Button>
    </>
  )
}

type HeatTreatmentHeaderActionsProps = {
  onCreateRequest: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  onOpenCurrentReport: () => void
  onOpenWaitingRequestReport: () => void
  onOpenResultsReport: () => void
}

export function HeatTreatmentHeaderActions({
  onCreateRequest,
  requestPending,
  onAddResult,
  resultDisabled,
  isShowMenuOpen,
  onToggleShowMenu,
  onOpenCurrentReport,
  onOpenWaitingRequestReport,
  onOpenResultsReport,
}: HeatTreatmentHeaderActionsProps) {
  return (
    <>
      <Button onClick={onCreateRequest} disabled={requestPending}>
        <Plus className="mr-2 h-4 w-4" />
        Заявка
      </Button>
      <Button onClick={onAddResult} disabled={resultDisabled}>
        <ClipboardCheck className="mr-2 h-4 w-4" />
        Результат
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        widthClassName="w-56"
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport },
          { label: 'Ожидает заявку ПСТО', onClick: onOpenWaitingRequestReport },
          { label: 'Результаты ПСТО', onClick: onOpenResultsReport },
        ]}
      />
    </>
  )
}

type LnkHeaderActionsProps = {
  onCreateRequest: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  onOpenOfficiality: () => void
  officialityPending: boolean
  onOpenDuplicateControl: () => void
  duplicateControlPending: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  onOpenCurrentReport: () => void
  onOpenToRequestReport: () => void
  onOpenWaitingNkReport: () => void
  onOpenConclusionsReport: () => void
}

export function LnkHeaderActions({
  onCreateRequest,
  requestPending,
  onAddResult,
  resultDisabled,
  onOpenOfficiality,
  officialityPending,
  onOpenDuplicateControl,
  duplicateControlPending,
  isShowMenuOpen,
  onToggleShowMenu,
  onOpenCurrentReport,
  onOpenToRequestReport,
  onOpenWaitingNkReport,
  onOpenConclusionsReport,
}: LnkHeaderActionsProps) {
  return (
    <>
      <Button onClick={onCreateRequest} disabled={requestPending}>
        <Plus className="mr-2 h-4 w-4" />
        Заявка
      </Button>
      <Button onClick={onAddResult} disabled={resultDisabled}>
        <ClipboardCheck className="mr-2 h-4 w-4" />
        Результат
      </Button>
      <Button variant="outline" onClick={onOpenOfficiality} disabled={officialityPending}>
        <ShieldCheck className="mr-2 h-4 w-4" />
        Официальность
      </Button>
      <Button variant="outline" onClick={onOpenDuplicateControl} disabled={duplicateControlPending}>
        <CopyCheck className="mr-2 h-4 w-4" />
        Дубль контроль
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport },
          { label: 'Ожидание заявки', onClick: onOpenToRequestReport },
          { label: 'Ожидание НК', onClick: onOpenWaitingNkReport },
          { label: 'Показать заключения', onClick: onOpenConclusionsReport },
        ]}
      />
    </>
  )
}
