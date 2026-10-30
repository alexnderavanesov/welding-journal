import { useAccess } from '@/lib/security-context'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ClipboardCheck, CopyCheck, FilePlus2, Gauge, ListChecks, ListFilter, Pencil, Plus, ShieldCheck, Upload } from 'lucide-react'
import { ReportShowMenu } from '@/components/report-show-menu'
import { Button } from '@/components/ui/button'
import { useCancelPendingWorkflowAction, WorkflowActionMenuItem, type WorkflowAvailability } from '@/components/workflow-action-menu-item'

const REPORT_WORKFLOW_BUTTON_CLASS =
  'border-sky-100 bg-sky-50 text-sky-700 hover:border-sky-200 hover:bg-sky-100 hover:text-sky-800'

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
  currentReportDisabled?: boolean
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
  currentReportDisabled,
  onOpenWaitingWeldReport,
  onOpenWaitingRequestReport,
  onOpenWaitingControlReport,
  onOpenWaitingRepairReport,
  onOpenCancelledAcceptedReport,
  onOpenSystemReport,
}: WeldingJournalHeaderActionsProps) {
  const { can } = useAccess()
  const editable = can('welding.edit')
  return (
    <>
      <Button onClick={onCreateWeldJoint} disabled={!editable}>
        <Plus className="mr-2 h-4 w-4" />
        Новый стык
      </Button>
      <ReportShowMenu
        disabled={!can('welding.export')}
        isOpen={isShowMenuOpen}
        onToggle={onToggleShowMenu}
        widthClassName="w-64"
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport, disabled: currentReportDisabled },
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
        disabled={!can('welding.generate') || !can('documents.generate')}
        isOpen={isGenerateMenuOpen}
        onToggle={onToggleGenerateMenu}
        widthClassName="w-56"
        items={[
          { label: 'ЖСР', onClick: onGenerateWeldingJournalDocument },
          { label: 'Чек-лист', onClick: onGenerateChecklistDocument },
          { label: 'ЗНИ', onClick: onGenerateZniDocument },
        ]}
      />
      <Button variant="outline" onClick={onOpenImportDialog} disabled={importDisabled || !can('welding.import')}>
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
  currentReportDisabled?: boolean
  onOpenWaitingRequestReport: () => void
  onOpenResultsReport: () => void
  availability?: WorkflowAvailability
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
  currentReportDisabled,
  onOpenWaitingRequestReport,
  onOpenResultsReport,
  availability = 'ready',
  onWorkflowMenuOpenChange = () => undefined,
}: HeatTreatmentHeaderActionsProps) {
  const { can } = useAccess()
  const editable = can('psto.edit')
  const workflowMenuRootRef = useRef<HTMLDivElement | null>(null)
  const cancelPendingAction = useCancelPendingWorkflowAction()
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const [isTvmtMenuOpen, setIsTvmtMenuOpen] = useState(false)
  const closeWorkflowMenus = () => {
    cancelPendingAction()
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(false)
  }
  useDismissWorkflowMenus({
    open: isRequestMenuOpen || isResultMenuOpen || isTvmtMenuOpen,
    rootRef: workflowMenuRootRef,
    onDismiss: closeWorkflowMenus,
  })
  const runWorkflowAction = (action: () => void) => {
    closeWorkflowMenus()
    action()
  }
  const toggleRequestMenu = () => {
    cancelPendingAction()
    const nextOpen = !isRequestMenuOpen
    setIsRequestMenuOpen(nextOpen)
    setIsResultMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleResultMenu = () => {
    cancelPendingAction()
    const nextOpen = !isResultMenuOpen
    setIsResultMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    setIsTvmtMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleTvmtMenu = () => {
    cancelPendingAction()
    const nextOpen = !isTvmtMenuOpen
    setIsTvmtMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleShowMenu = () => {
    closeWorkflowMenus()
    onToggleShowMenu()
  }

  return (
    <div ref={workflowMenuRootRef} className="contents">
      <Button
        variant="outline"
        className={REPORT_WORKFLOW_BUTTON_CLASS}
        onClick={() => runWorkflowAction(onOpenLineProgram)}
      >
        <ListChecks className="mr-2 h-4 w-4" />
        Программа ПСТО
      </Button>
      <div className="relative">
        <Button
          variant="outline"
          className={REPORT_WORKFLOW_BUTTON_CLASS}
          onClick={toggleRequestMenu}
          disabled={requestPending}
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          Заявка
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isRequestMenuOpen ? (
          <div data-workflow-menu className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка"
              icon={Plus}
              onClick={() => runWorkflowAction(onCreateRequest)}
              disabled={!editable || (availability === 'ready' && createRequestDisabled)}
              disabledReason="Нет стыков, готовых к ПСТО. Следующий этап — в истории стыка."
              description="Создать заявку для стыков, готовых к ПСТО."
              availability={availability}
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранную"
              icon={Pencil}
              onClick={() => runWorkflowAction(onEditSelectedRequest)}
              disabled={!editable || (editSelectedRequestDisabled)}
              disabledReason="Выберите в таблице стык с созданной заявкой ПСТО."
              description="Изменить заявку отмеченного в таблице стыка."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="История ПСТО и ТВМТ"
              icon={ListFilter}
              tone="slate"
              onClick={() => runWorkflowAction(onOpenRequestRegistry)}
            />
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button
          variant="outline"
          className={REPORT_WORKFLOW_BUTTON_CLASS}
          onClick={toggleResultMenu}
        >
          <ClipboardCheck className="mr-2 h-4 w-4" />
          Результат
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isResultMenuOpen ? (
          <div data-workflow-menu className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Внести результаты"
              icon={Plus}
              onClick={() => runWorkflowAction(onAddResult)}
              disabled={!editable || (availability === 'ready' && resultDisabled)}
              disabledReason="Нет заявок ПСТО, ожидающих результата. Сначала создайте заявку ПСТО."
              description="Внести результаты по ожидающим заявкам ПСТО."
              availability={availability}
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранные"
              icon={ClipboardCheck}
              onClick={() => runWorkflowAction(onEditSelectedResults)}
              disabled={!editable || (editSelectedResultsDisabled)}
              disabledReason="Выберите в таблице стык с уже внесенным результатом ПСТО."
              description="Открыть результаты отмеченных в таблице стыков."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="История ПСТО и ТВМТ"
              icon={ListFilter}
              tone="slate"
              onClick={() => runWorkflowAction(onOpenResultRegistry)}
              disabled={availability === 'ready' && resultRegistryDisabled}
              disabledReason="История пока пуста: ни один цикл ПСТО еще не начат."
              description="Посмотреть заявки, результаты и циклы ПСТО/ТВМТ."
              availability={availability}
            />
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button
          onClick={toggleTvmtMenu}
          disabled={tvmtPending}
          variant="outline"
          className={REPORT_WORKFLOW_BUTTON_CLASS}
        >
          <Gauge className="mr-2 h-4 w-4" />
          ТВМТ
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isTvmtMenuOpen ? (
          <div data-workflow-menu className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка ТВМТ"
              icon={FilePlus2}
              tone="violet"
              onClick={() => runWorkflowAction(onCreateTvmtRequest)}
              disabled={!editable || (availability === 'ready' && createTvmtRequestDisabled)}
              disabledReason="Нет стыков с проведенной ПСТО, ожидающих заявку ТВМТ."
              description="Создать заявку ТВМТ после проведённой ПСТО."
              availability={availability}
            />
            <WorkflowActionMenuItem
              label="Внести результаты ТВМТ"
              icon={ClipboardCheck}
              tone="violet"
              onClick={() => runWorkflowAction(onAddTvmtResult)}
              disabled={!editable || (availability === 'ready' && addTvmtResultDisabled)}
              disabledReason="Нет заявок ТВМТ, ожидающих результата. Сначала создайте заявку ТВМТ."
              description="Внести результаты по ожидающим заявкам ТВМТ."
              availability={availability}
            />
          </div>
        ) : null}
      </div>
      <ReportShowMenu
        disabled={!can('psto.export')}
        isOpen={isShowMenuOpen}
        onToggle={toggleShowMenu}
        widthClassName="w-56"
        buttonClassName={REPORT_WORKFLOW_BUTTON_CLASS}
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport, disabled: currentReportDisabled },
          { label: 'Ожидает заявку ПСТО', onClick: onOpenWaitingRequestReport },
          { label: 'Результаты ПСТО', onClick: onOpenResultsReport },
        ]}
      />
    </div>
  )
}

type LnkHeaderActionsProps = {
  onCreateRequest: () => void
  createRequestDisabled?: boolean
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
  currentReportDisabled?: boolean
  onOpenToRequestReport: () => void
  onOpenWaitingNkReport: () => void
  onOpenConclusionsReport: () => void
  availability?: WorkflowAvailability
  onWorkflowMenuOpenChange?: (open: boolean) => void
}

export function LnkHeaderActions({
  onCreateRequest,
  createRequestDisabled = false,
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
  currentReportDisabled,
  onOpenToRequestReport,
  onOpenWaitingNkReport,
  onOpenConclusionsReport,
  availability = 'ready',
  onWorkflowMenuOpenChange = () => undefined,
}: LnkHeaderActionsProps) {
  const { can } = useAccess()
  const editable = can('lnk.edit')
  const workflowMenuRootRef = useRef<HTMLDivElement | null>(null)
  const cancelPendingAction = useCancelPendingWorkflowAction()
  const [isRequestMenuOpen, setIsRequestMenuOpen] = useState(false)
  const [isResultMenuOpen, setIsResultMenuOpen] = useState(false)
  const closeWorkflowMenus = () => {
    cancelPendingAction()
    setIsRequestMenuOpen(false)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(false)
  }
  useDismissWorkflowMenus({
    open: isRequestMenuOpen || isResultMenuOpen,
    rootRef: workflowMenuRootRef,
    onDismiss: closeWorkflowMenus,
  })
  const runWorkflowAction = (action: () => void) => {
    closeWorkflowMenus()
    action()
  }
  const toggleRequestMenu = () => {
    cancelPendingAction()
    const nextOpen = !isRequestMenuOpen
    setIsRequestMenuOpen(nextOpen)
    setIsResultMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleResultMenu = () => {
    cancelPendingAction()
    const nextOpen = !isResultMenuOpen
    setIsResultMenuOpen(nextOpen)
    setIsRequestMenuOpen(false)
    onWorkflowMenuOpenChange(nextOpen)
    if (isShowMenuOpen) onToggleShowMenu()
  }
  const toggleShowMenu = () => {
    closeWorkflowMenus()
    onToggleShowMenu()
  }

  return (
    <div ref={workflowMenuRootRef} className="contents">
      <div className="relative">
        <Button
          variant="outline"
          className={REPORT_WORKFLOW_BUTTON_CLASS}
          onClick={toggleRequestMenu}
          disabled={requestPending}
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          Заявка
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isRequestMenuOpen ? (
          <div data-workflow-menu className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Новая заявка"
              icon={Plus}
              onClick={() => runWorkflowAction(onCreateRequest)}
              disabled={!editable || (createRequestDisabled)}
              disabledReason="Дождитесь загрузки текущей выборки и всех выбранных стыков."
            />
            <WorkflowActionMenuItem
              label="Добавить позиции"
              disabled={!editable}
              icon={FilePlus2}
              onClick={() => runWorkflowAction(onExtendRequest)}
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="Все заявки ЛНК"
              icon={ListFilter}
              tone="slate"
              onClick={() => runWorkflowAction(onOpenRequestRegistry)}
            />
          </div>
        ) : null}
      </div>
      <div className="relative">
        <Button
          variant="outline"
          className={REPORT_WORKFLOW_BUTTON_CLASS}
          onClick={toggleResultMenu}
        >
          <ClipboardCheck className="mr-2 h-4 w-4" />
          Результат
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isResultMenuOpen ? (
          <div data-workflow-menu className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10">
            <WorkflowActionMenuItem
              label="Внести результаты"
              icon={Plus}
              onClick={() => runWorkflowAction(onAddResult)}
              disabled={!editable || (availability === 'ready' && resultDisabled)}
              disabledReason="Нет ожидающих заявок ЛНК. Создайте заявку нужного этапа."
              description="Внести результаты по заявкам выбранного этапа НК."
              availability={availability}
            />
            <WorkflowActionMenuItem
              label="Редактировать выбранные"
              icon={ClipboardCheck}
              onClick={() => runWorkflowAction(onEditSelectedResults)}
              disabled={!editable || (editSelectedResultsDisabled)}
              disabledReason="Выберите в таблице стык с внесенным результатом ЛНК."
              description="Открыть результаты отмеченных в таблице стыков."
            />
            <div className="my-1 border-t border-slate-100" />
            <WorkflowActionMenuItem
              label="Все результаты ЛНК"
              icon={ListFilter}
              tone="slate"
              onClick={() => runWorkflowAction(onOpenResultRegistry)}
              disabled={availability === 'ready' && resultRegistryDisabled}
              disabledReason="Внесенных результатов ЛНК пока нет."
              description="Посмотреть внесённые результаты и заключения ЛНК."
              availability={availability}
            />
          </div>
        ) : null}
      </div>
      <Button
        variant="outline"
        className={REPORT_WORKFLOW_BUTTON_CLASS}
        onClick={() => runWorkflowAction(onOpenOfficiality)}
        disabled={!editable || (officialityPending)}
      >
        <ShieldCheck className="mr-2 h-4 w-4" />
        Официальность
      </Button>
      <Button
        variant="outline"
        className={REPORT_WORKFLOW_BUTTON_CLASS}
        onClick={() => runWorkflowAction(onOpenDuplicateControl)}
        disabled={!editable || (duplicateControlPending)}
      >
        <CopyCheck className="mr-2 h-4 w-4" />
        Дубль контроль
      </Button>
      <ReportShowMenu
        disabled={!can('lnk.export')}
        isOpen={isShowMenuOpen}
        onToggle={toggleShowMenu}
        buttonClassName={REPORT_WORKFLOW_BUTTON_CLASS}
        items={[
          { label: 'Текущая версия', onClick: onOpenCurrentReport, disabled: currentReportDisabled },
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
    const handleOutsideActivation = (event: Event) => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) onDismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onDismiss()
    }
    // Capture also covers entries that stop propagation. Click covers keyboard
    // activation outside the menu, which has no preceding pointerdown. Leaving
    // the group with Tab must also discard a pending choice.
    document.addEventListener('pointerdown', handleOutsideActivation, true)
    document.addEventListener('click', handleOutsideActivation, true)
    document.addEventListener('focusin', handleOutsideActivation, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsideActivation, true)
      document.removeEventListener('click', handleOutsideActivation, true)
      document.removeEventListener('focusin', handleOutsideActivation, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onDismiss, open, rootRef])
}
