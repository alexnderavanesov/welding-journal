import { useState } from 'react'
import { ChevronDown, ClipboardCheck, CopyCheck, FilePlus2, ListFilter, Plus, ShieldCheck, Upload } from 'lucide-react'
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
  onGenerateChecklistDocument: () => void
  onGenerateZniDocument: () => void
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
  onGenerateChecklistDocument,
  onGenerateZniDocument,
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
        items={[
          { label: 'ЖСР', onClick: onGenerateWeldingJournalDocument },
          { label: 'Чек-лист', onClick: onGenerateChecklistDocument },
          { label: 'ЗНИ', onClick: onGenerateZniDocument },
        ]}
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
  onExtendRequest: () => void
  onOpenRequestRegistry: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  onEditSelectedResults: () => void
  editSelectedResultsDisabled: boolean
  onOpenResultRegistry: () => void
  resultRegistryDisabled: boolean
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
  onExtendRequest,
  onOpenRequestRegistry,
  requestPending,
  onAddResult,
  resultDisabled,
  onEditSelectedResults,
  editSelectedResultsDisabled,
  onOpenResultRegistry,
  resultRegistryDisabled,
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
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const runRequestAction = (action: () => void) => {
    setIsRequestMenuOpen(false)
    action()
  }
  const runResultAction = (action: () => void) => {
    setIsResultMenuOpen(false)
    action()
  }

  return (
    <>
      <div className="relative">
        <Button onClick={() => setIsRequestMenuOpen((current) => !current)} disabled={requestPending}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          Заявка
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isRequestMenuOpen ? (
          <div className="absolute left-0 z-50 mt-2 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <button
              type="button"
              onClick={() => runRequestAction(onCreateRequest)}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900"
            >
              <Plus className="h-4 w-4 text-sky-600" />
              Новая заявка
            </button>
            <button
              type="button"
              onClick={() => runRequestAction(onExtendRequest)}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900"
            >
              <FilePlus2 className="h-4 w-4 text-sky-600" />
              Добавить позиции
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              onClick={() => runRequestAction(onOpenRequestRegistry)}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900"
            >
              <ListFilter className="h-4 w-4 text-slate-500" />
              Все заявки ЛНК
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button onClick={() => setIsResultMenuOpen((current) => !current)}>
          <ClipboardCheck className="mr-2 h-4 w-4" />
          Результат
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isResultMenuOpen ? (
          <div className="absolute left-0 z-50 mt-2 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <button
              type="button"
              onClick={() => runResultAction(onAddResult)}
              disabled={resultDisabled}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4 text-sky-600" />
              Внести результаты
            </button>
            <button
              type="button"
              onClick={() => runResultAction(onEditSelectedResults)}
              disabled={editSelectedResultsDisabled}
              title={editSelectedResultsDisabled ? 'Выберите в таблице стыки с внесенными результатами' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4 text-sky-600" />
              Редактировать выбранные
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              onClick={() => runResultAction(onOpenResultRegistry)}
              disabled={resultRegistryDisabled}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListFilter className="h-4 w-4 text-slate-500" />
              Все результаты ЛНК
            </button>
          </div>
        ) : null}
      </div>
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
