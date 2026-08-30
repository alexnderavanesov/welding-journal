import { useState } from 'react'
import { ChevronDown, ClipboardCheck, CopyCheck, FilePlus2, Gauge, ListChecks, ListFilter, Pencil, Plus, ShieldCheck, Upload } from 'lucide-react'
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
  onOpenLineProgram: () => void
  onCreateRequest: () => void
  createRequestDisabled: boolean
  onEditSelectedRequest: () => void
  editSelectedRequestDisabled: boolean
  onOpenRequestRegistry: () => void
  requestPending: boolean
  onAddResult: () => void
  resultDisabled: boolean
  onEditSelectedResults: () => void
  editSelectedResultsDisabled: boolean
  onOpenResultRegistry: () => void
  resultRegistryDisabled: boolean
  onCreateTvmtRequest: () => void
  createTvmtRequestDisabled: boolean
  onAddTvmtResult: () => void
  addTvmtResultDisabled: boolean
  tvmtPending: boolean
  isShowMenuOpen: boolean
  onToggleShowMenu: () => void
  onOpenCurrentReport: () => void
  onOpenWaitingRequestReport: () => void
  onOpenResultsReport: () => void
  onWorkflowMenuOpenChange?: (open: boolean) => void
}

export function HeatTreatmentHeaderActions({
  onOpenLineProgram,
  onCreateRequest,
  createRequestDisabled,
  onEditSelectedRequest,
  editSelectedRequestDisabled,
  onOpenRequestRegistry,
  requestPending,
  onAddResult,
  resultDisabled,
  onEditSelectedResults,
  editSelectedResultsDisabled,
  onOpenResultRegistry,
  resultRegistryDisabled,
  onCreateTvmtRequest,
  createTvmtRequestDisabled,
  onAddTvmtResult,
  addTvmtResultDisabled,
  tvmtPending,
  isShowMenuOpen,
  onToggleShowMenu,
  onOpenCurrentReport,
  onOpenWaitingRequestReport,
  onOpenResultsReport,
  onWorkflowMenuOpenChange = () => undefined,
}: HeatTreatmentHeaderActionsProps) {
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const [isTvmtMenuOpen, setIsTvmtMenuOpen] = useState(false)
  const runRequestAction = (action: () => void) => {
    setIsRequestMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    action()
  }
  const runResultAction = (action: () => void) => {
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    action()
  }
  const runTvmtAction = (action: () => void) => {
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    action()
  }
  const toggleRequestMenu = () => {
    const nextOpen = !isRequestMenuOpen
    setIsRequestMenuOpen(nextOpen)
    setIsResultMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleResultMenu = () => {
    const nextOpen = !isResultMenuOpen
    setIsResultMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleTvmtMenu = () => {
    const nextOpen = !isTvmtMenuOpen
    setIsTvmtMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleShowMenu = () => {
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    onToggleShowMenu()
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100 hover:text-teal-950"
        onClick={() => {
          setIsRequestMenuOpen(false)
          setIsResultMenuOpen(false)
          setIsTvmtMenuOpen(false)
          onWorkflowMenuOpenChange(false)
          onOpenLineProgram()
        }}
      >
        <ListChecks className="mr-2 h-4 w-4" />
        Программа ПСТО
      </Button>
      <div className="relative">
        <Button
          variant="outline"
          className="border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 hover:text-sky-950"
          onClick={toggleRequestMenu}
          disabled={requestPending}
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          Заявка
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isRequestMenuOpen ? (
          <div className="absolute left-0 z-50 mt-2 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <button
              type="button"
              onClick={() => runRequestAction(onCreateRequest)}
              disabled={createRequestDisabled}
              title={createRequestDisabled ? 'Нет стыков, ожидающих заявку ПСТО' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4 text-sky-600" />
              Новая заявка
            </button>
            <button
              type="button"
              onClick={() => runRequestAction(onEditSelectedRequest)}
              disabled={editSelectedRequestDisabled}
              title={editSelectedRequestDisabled ? 'Выберите в таблице стыки одной созданной заявки ПСТО' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="h-4 w-4 text-sky-600" />
              Редактировать выбранную
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              onClick={() => runRequestAction(onOpenRequestRegistry)}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900"
            >
              <ListFilter className="h-4 w-4 text-slate-500" />
              История ПСТО и ТВМТ
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 hover:text-emerald-950"
          onClick={toggleResultMenu}
        >
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
              title={resultDisabled ? 'Нет заявок ПСТО, ожидающих результата' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4 text-sky-600" />
              Внести результаты
            </button>
            <button
              type="button"
              onClick={() => runResultAction(onEditSelectedResults)}
              disabled={editSelectedResultsDisabled}
              title={editSelectedResultsDisabled ? 'Выберите в таблице стыки с внесенными результатами ПСТО' : undefined}
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
              title={resultRegistryDisabled ? 'История ПСТО и ТВМТ пока пуста' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListFilter className="h-4 w-4 text-slate-500" />
              История ПСТО и ТВМТ
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button
          onClick={toggleTvmtMenu}
          disabled={tvmtPending}
          variant="outline"
          className="border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100 hover:text-violet-950"
        >
          <Gauge className="mr-2 h-4 w-4" />
          ТВМТ
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isTvmtMenuOpen ? (
          <div className="absolute left-0 z-50 mt-2 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <button
              type="button"
              onClick={() => runTvmtAction(onCreateTvmtRequest)}
              disabled={createTvmtRequestDisabled}
              title={createTvmtRequestDisabled ? 'Нет стыков с проведенной ПСТО, ожидающих заявку ТВМТ' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FilePlus2 className="h-4 w-4 text-violet-600" />
              Новая заявка ТВМТ
            </button>
            <button
              type="button"
              onClick={() => runTvmtAction(onAddTvmtResult)}
              disabled={addTvmtResultDisabled}
              title={addTvmtResultDisabled ? 'Нет заявок ТВМТ, ожидающих результата' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4 text-violet-600" />
              Внести результаты ТВМТ
            </button>
          </div>
        ) : null}
      </div>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={toggleShowMenu}
        widthClassName="w-56"
        buttonClassName="border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100 hover:text-slate-950"
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
  onOpenPreHeatTreatmentResultRegistry?: (mode?: 'request' | 'result') => void
  preHeatTreatmentResultRegistryDisabled?: boolean
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
  onWorkflowMenuOpenChange?: (open: boolean) => void
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
  onOpenPreHeatTreatmentResultRegistry = () => undefined,
  preHeatTreatmentResultRegistryDisabled = false,
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
  onWorkflowMenuOpenChange = () => undefined,
}: LnkHeaderActionsProps) {
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const runRequestAction = (action: () => void) => {
    setIsRequestMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    action()
  }
  const runResultAction = (action: () => void) => {
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    action()
  }
  const toggleRequestMenu = () => {
    const nextOpen = !isRequestMenuOpen
    setIsRequestMenuOpen(nextOpen)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleResultMenu = () => {
    const nextOpen = !isResultMenuOpen
    setIsResultMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleShowMenu = () => {
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(false)
    onToggleShowMenu()
  }

  return (
    <>
      <div className="relative">
        <Button
          variant="outline"
          className="border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 hover:text-sky-950"
          onClick={toggleRequestMenu}
          disabled={requestPending}
        >
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
              onClick={() => runRequestAction(() => onOpenPreHeatTreatmentResultRegistry('request'))}
              disabled={preHeatTreatmentResultRegistryDisabled}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListFilter className="h-4 w-4 text-violet-600" />
              Все заявки до ТО
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
        <Button
          variant="outline"
          className="border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 hover:text-emerald-950"
          onClick={toggleResultMenu}
        >
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
              title={resultDisabled ? 'Нет заявок ЛНК, ожидающих результата' : undefined}
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
              title={resultRegistryDisabled ? 'Нет внесенных результатов ЛНК' : undefined}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListFilter className="h-4 w-4 text-slate-500" />
              Все результаты ЛНК
            </button>
            <button
              type="button"
              onClick={() => runResultAction(() => onOpenPreHeatTreatmentResultRegistry('result'))}
              disabled={preHeatTreatmentResultRegistryDisabled}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-800 hover:bg-violet-50 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListFilter className="h-4 w-4 text-violet-600" />
              Все результаты до ТО
            </button>
          </div>
        ) : null}
      </div>
      <Button
        variant="outline"
        className="border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100 hover:text-violet-950"
        onClick={onOpenOfficiality}
        disabled={officialityPending}
      >
        <ShieldCheck className="mr-2 h-4 w-4" />
        Официальность
      </Button>
      <Button
        variant="outline"
        className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-950"
        onClick={onOpenDuplicateControl}
        disabled={duplicateControlPending}
      >
        <CopyCheck className="mr-2 h-4 w-4" />
        Дубль контроль
      </Button>
      <ReportShowMenu
        isOpen={isShowMenuOpen}
        onToggle={toggleShowMenu}
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
