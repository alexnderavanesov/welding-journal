import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ClipboardCheck, CopyCheck, FilePlus2, Gauge, ListChecks, ListFilter, Pencil, Plus, ShieldCheck, Upload } from 'lucide-react'
import { ReportShowMenu } from '@/components/report-show-menu'
import { Button } from '@/components/ui/button'
import { WorkflowActionMenuItem } from '@/components/workflow-action-menu-item'

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
  const workflowMenuRootRef = useRef<HTMLDivElement | null>(null)
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const [isTvmtMenuOpen, setIsTvmtMenuOpen] = useState(false)
  useDismissWorkflowMenus({
    open: isRequestMenuOpen || isResultMenuOpen || isTvmtMenuOpen,
    rootRef: workflowMenuRootRef,
    onDismiss: () => {
      setIsRequestMenuOpen(false)
      setIsResultMenuOpen(false)
      setIsTvmtMenuOpen(false)
      onWorkflowMenuOpenChange(false)
    },
  })
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
    <div ref={workflowMenuRootRef} className="contents">
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
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка"
              icon={Plus}
              onClick={() => runRequestAction(onCreateRequest)}
              disabled={createRequestDisabled}
              disabledReason="Нет стыков, ожидающих заявку ПСТО. Откройте историю стыка, чтобы увидеть следующий обязательный этап."
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранную"
              icon={Pencil}
              onClick={() => runRequestAction(onEditSelectedRequest)}
              disabled={editSelectedRequestDisabled}
              disabledReason="Выберите в таблице стык с созданной заявкой ПСТО."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="История ПСТО и ТВМТ"
              icon={ListFilter}
              tone="slate"
              onClick={() => runRequestAction(onOpenRequestRegistry)}
            />
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
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Внести результаты"
              icon={Plus}
              onClick={() => runResultAction(onAddResult)}
              disabled={resultDisabled}
              disabledReason="Нет заявок ПСТО, ожидающих результата. Сначала создайте заявку ПСТО."
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранные"
              icon={ClipboardCheck}
              onClick={() => runResultAction(onEditSelectedResults)}
              disabled={editSelectedResultsDisabled}
              disabledReason="Выберите в таблице стык с уже внесенным результатом ПСТО."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="История ПСТО и ТВМТ"
              icon={ListFilter}
              tone="slate"
              onClick={() => runResultAction(onOpenResultRegistry)}
              disabled={resultRegistryDisabled}
              disabledReason="История пока пуста: ни один цикл ПСТО еще не начат."
            />
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
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка ТВМТ"
              icon={FilePlus2}
              tone="violet"
              onClick={() => runTvmtAction(onCreateTvmtRequest)}
              disabled={createTvmtRequestDisabled}
              disabledReason="Нет стыков с проведенной ПСТО, ожидающих заявку ТВМТ."
            />
            <WorkflowActionMenuItem
              label="Внести результаты ТВМТ"
              icon={ClipboardCheck}
              tone="violet"
              onClick={() => runTvmtAction(onAddTvmtResult)}
              disabled={addTvmtResultDisabled}
              disabledReason="Нет заявок ТВМТ, ожидающих результата. Сначала создайте заявку ТВМТ."
            />
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
    </div>
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
  const workflowMenuRootRef = useRef<HTMLDivElement | null>(null)
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  useDismissWorkflowMenus({
    open: isRequestMenuOpen || isResultMenuOpen,
    rootRef: workflowMenuRootRef,
    onDismiss: () => {
      setIsRequestMenuOpen(false)
      setIsResultMenuOpen(false)
      onWorkflowMenuOpenChange(false)
    },
  })
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
    <div ref={workflowMenuRootRef} className="contents">
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
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка"
              icon={Plus}
              onClick={() => runRequestAction(onCreateRequest)}
            />
            <WorkflowActionMenuItem
              label="Добавить позиции"
              icon={FilePlus2}
              onClick={() => runRequestAction(onExtendRequest)}
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="Все заявки ЛНК"
              icon={ListFilter}
              tone="slate"
              onClick={() => runRequestAction(onOpenRequestRegistry)}
            />
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
          <div className="absolute left-0 z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Внести результаты"
              icon={Plus}
              onClick={() => runResultAction(onAddResult)}
              disabled={resultDisabled}
              disabledReason="Нет заявок ЛНК, ожидающих результата. Сначала создайте заявку нужного этапа."
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранные"
              icon={ClipboardCheck}
              onClick={() => runResultAction(onEditSelectedResults)}
              disabled={editSelectedResultsDisabled}
              disabledReason="Выберите в таблице стык с внесенным результатом ЛНК."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="Все результаты ЛНК"
              icon={ListFilter}
              tone="slate"
              onClick={() => runResultAction(onOpenResultRegistry)}
              disabled={resultRegistryDisabled}
              disabledReason="Внесенных результатов ЛНК пока нет."
            />
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
    </div>
  )
}

function useDismissWorkflowMenus({
  open,
  rootRef,
  onDismiss,
}: {
  open: boolean
  rootRef: RefObject<HTMLDivElement | null>
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) onDismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss, open, rootRef])
}
