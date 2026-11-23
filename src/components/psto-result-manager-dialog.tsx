import { PSTO_DOCUMENTS } from '@/lib/workflow-document-choices'
import { WorkflowManagerViews, WorkflowDocumentLink, useWorkflowManagerView } from './workflow-manager-views'
import { useDocumentPositionChange } from '@/lib/use-document-position-change'
import { ManagerEditPanel, ManagerEditSection, useDocumentJointCount } from './manager-edit-panel'
import { DocumentConnectionsButton } from './document-connections-button'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { getDocumentRequisiteErrors } from '@/lib/document-requisites'
import { ArrowRight, Pencil, FileSpreadsheet, Search, Trash2 } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogHeader } from '@/components/dialog-header'
import { JointConnectionTypeMeta, MetaSeparator } from '@/components/joint-meta'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { RequestManagerEmptyState } from '@/components/request-manager-panels'
import { BufferedFilterInput } from '@/components/result-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import {
  buildPstoCycleTimeline,
  type PstoCycleSnapshot,
} from '@/lib/psto-cycle'
import {
  applyPstoCycleCorrection,
  applyPstoTvmtCorrectionWithLaterCycleRemoval,
  getPstoCycleStageDeleteBlockReason,
  getPstoCycleStageInlineLabel,
  getPstoCycleStageLabel,
  type PstoCycleStage,
} from '@/lib/psto-cycle-corrections'
import {
  buildPrimaryPstoSystemDocumentRow,
  buildPstoRepeatSystemDocumentRow,
} from '@/lib/system-document-virtual-row'
import {
  getPstoTvmtWorkflowLabel,
  getPstoTvmtWorkflowState,
  isCompletedPstoResult,
  normalizeTvmtResult,
} from '@/lib/tvmt-cycle'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { useAccess } from '@/lib/security-context'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import type {
  WorkflowRootCauseAction,
  WorkflowRootCauseTarget,
} from '@/lib/workflow-root-cause-actions'
import type {
  CorrectPstoCycleStagePayload,
  CorrectPstoTvmtAndRemoveLaterCyclesPayload,
} from '@/server/psto-repeat-workflow'

type StageDraft = {
  date: string
  name: string
  result: string
}

export type PstoResultManagerDialogProps = {
  elevated?: boolean
  rows: WeldRow[]
  registryScope?: 'all' | 'selected'
  isPending: boolean
  canOpenDocument: boolean
  onClose: () => void
  onRenameDiagram: (row: WeldRow, diagramName: string) => void
  onDeleteResult: (row: WeldRow) => void
  onCorrectStage?: (payload: CorrectPstoCycleStagePayload) => void
  onDeleteStage?: (row: WeldRow, payload: CorrectPstoCycleStagePayload) => void
  onCorrectTvmtAndRemoveLaterCycles?: (
    row: WeldRow,
    payload: CorrectPstoTvmtAndRemoveLaterCyclesPayload,
  ) => void
  onOpenDocument: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  canOpenDocumentForField?: (fieldKey: WeldFieldKey) => boolean
  initialRowId?: number
  initialSequence?: number
  initialStage?: PstoCycleStage
  rootCauseTarget?: Extract<WorkflowRootCauseTarget, { kind: 'psto-cycle' }>
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onDocumentDateSaved?: () => void
  onMessage?: (message: string) => void
  hasMoreRows?: boolean
  onLoadMoreRows?: () => void
  onRegistrySearchChange?: (value: string) => void
}

export function PstoResultManagerDialog({
  elevated = false,
  rows,
  registryScope = 'all',
  isPending,
  canOpenDocument,
  onClose,
  onRenameDiagram,
  onDeleteResult,
  onCorrectStage,
  onDeleteStage,
  onCorrectTvmtAndRemoveLaterCycles,
  onOpenDocument,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  canOpenDocumentForField,
  initialRowId,
  initialSequence,
  initialStage,
  rootCauseTarget,
  onRunRootCauseAction,
  onDocumentDateSaved,
  onMessage,
  hasMoreRows = false,
  onLoadMoreRows,
  onRegistrySearchChange,
}: PstoResultManagerDialogProps) {
  const saveCheckSettings = useSaveCheckSettings()
  const managerView = useWorkflowManagerView()
  const documentReferences = useMemo(() => registryScope === 'selected'
    ? rows.flatMap(row => buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? []).flatMap(cycle => {
        const documentRow = getCycleDocumentRow(row, cycle)
        return getExistingStages(cycle).flatMap(stage => {
          const reference = getSystemDocumentReferenceForField(documentRow, getStageDocumentField(stage))
          return reference ? [reference] : []
        })
      }))
    : undefined, [rows, registryScope])
  const [dirtyStages, setDirtyStages] = useState<ReadonlySet<PstoCycleStage>>(() => new Set())
  const onStageDirtyChange = useCallback((stage: PstoCycleStage, dirty: boolean) => {
    setDirtyStages(current => {
      if (current.has(stage) === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(stage)
      else next.delete(stage)
      return next
    })
  }, [])
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const [search, setSearch] = useState('')
  const filteredRows = useMemo(() => {
    const query = normalize(search)
    if (!query) return rows
    return rows.filter((row) => normalize([
      row.projectTitle,
      row.subtitleCode,
      row.line,
      row.spool,
      row.joint,
      row.pstoRequest,
      row.heatTreatmentDiagram,
      row.tvmtRequest,
      row.tvmtConclusion,
      ...(row.pstoRepeatCycles ?? []).flatMap((cycle) => [
        cycle.pstoRequest,
        cycle.heatTreatmentDiagram,
        cycle.tvmtRequest,
        cycle.tvmtConclusion,
      ]),
    ].join(' ')).includes(query))
  }, [rows, search])
  const pagination = usePagePagination({ items: filteredRows, defaultPageSize: 50, resetKeys: [search] })
  const [selectedRowId, setSelectedRowId] = useState<number | null>(initialRowId ?? rows[0]?.id ?? null)
  const [dateEditorTarget, setDateEditorTarget] = useState<{
    rowId: number
    sequence: number
    stage: PstoCycleStage
    token: number
  } | null>(null)
  const onStageEditingChange = useCallback((rowId: number, sequence: number, stage: PstoCycleStage, editing: boolean) => {
    if (editing) return
    setDateEditorTarget(current => current?.rowId === rowId && current.sequence === sequence && current.stage === stage && current.token
      ? { ...current, token: 0 }
      : current)
  }, [])
  const selectedRow = filteredRows.find((row) => row.id === selectedRowId) ?? filteredRows[0] ?? null
  const timeline = useMemo(
    () => selectedRow ? buildPstoCycleTimeline(selectedRow, selectedRow.pstoRepeatCycles ?? []) : [],
    [selectedRow],
  )
  const [selectedSequence, setSelectedSequence] = useState(
    () => initialSequence ?? timeline.at(-1)?.sequence ?? 1,
  )
  const selectionBeforeRootCauseRef = useRef<{ rowId: number | null; sequence: number } | null>(null)
  const selectedCycle = timeline.find((cycle) => cycle.sequence === selectedSequence)
    ?? timeline.at(-1)
    ?? null

  useEffect(() => {
    if (selectedRow && selectedRow.id !== selectedRowId) {
      setSelectedRowId(selectedRow.id)
      setSelectedSequence(timeline.at(-1)?.sequence ?? 1)
    }
  }, [selectedRow, selectedRowId, timeline])
  useEffect(() => {
    // Search/refetch can temporarily have no rows. Keep the user's cycle
    // until the next response instead of resetting it to the primary cycle.
    if (!selectedRow) return
    setSelectedSequence((current) => {
      if (initialRowId === selectedRow?.id && initialSequence && timeline.some((cycle) => cycle.sequence === initialSequence)) {
        return initialSequence
      }
      return timeline.some((cycle) => cycle.sequence === current)
        ? current
        : timeline.at(-1)?.sequence ?? 1
    })
  }, [initialRowId, initialSequence, selectedRow?.id, timeline])
  useEffect(() => {
    if (initialRowId && rows.some((row) => row.id === initialRowId)) setSelectedRowId(initialRowId)
  }, [initialRowId, rows])
  const rootCauseTargetKey = rootCauseTarget
    ? `${rootCauseTarget.rowId}:${rootCauseTarget.sequence}:${rootCauseTarget.stage}:${rootCauseTarget.focus}`
    : ''
  useEffect(() => {
    if (rootCauseTarget) {
      if (!selectionBeforeRootCauseRef.current) {
        selectionBeforeRootCauseRef.current = { rowId: selectedRowId, sequence: selectedSequence }
      }
      setSelectedRowId(rootCauseTarget.rowId)
      setSelectedSequence(rootCauseTarget.sequence)
      return
    }
    const previous = selectionBeforeRootCauseRef.current
    if (!previous) return
    selectionBeforeRootCauseRef.current = null
    setSelectedRowId(previous.rowId)
    setSelectedSequence(previous.sequence)
  }, [rootCauseTargetKey])

  const openStageContextMenu = (
    event: MouseEvent<HTMLElement>,
    row: WeldRow,
    cycle: PstoCycleSnapshot,
    stage: PstoCycleStage,
  ) => {
    if (isNativeContextMenuTarget(event.target)) return
    const point = getDialogMenuPoint(event)
    const stageData = getStageData(cycle, stage)
    const fieldKey = getStageDocumentField(stage)
    const documentRow = getCycleDocumentRow(row, cycle)
    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: `${text(row.line) || '-'} · ${text(row.joint) || '-'}`,
      description: `${cycle.sequence === 1 ? 'Основной цикл' : `Повтор #${cycle.sequence}`} · ${getPstoCycleStageLabel(stage)}`,
      documentName: stageData.name,
      documentLabel: getDocumentLabel(stage),
      rows: [row],
      sourceLabel: `цикл ПСТО/ТВМТ · стык ${text(row.joint) || row.id}`,
      actions: [{
        id: 'edit-stage',
        label: 'Внести изменения',
        icon: Pencil,
        disabled: isPending,
        onSelect: () => {
          setSelectedRowId(row.id)
          setSelectedSequence(cycle.sequence)
          setDateEditorTarget((current) => ({
            rowId: row.id,
            sequence: cycle.sequence,
            stage,
            token: (current?.token ?? 0) + 1,
          }))
        },
      }],
      openDocumentDisabledReason: !canOpenDocumentForStage(fieldKey)
        ? 'Сначала загрузите шаблон этого документа в настройках'
        : null,
      onOpenDocument: () => onOpenDocument(documentRow, fieldKey),
      onCopyDocumentName,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  }

  const runDeleteStage = (row: WeldRow, cycle: PstoCycleSnapshot, stage: PstoCycleStage) => {
    const payload = createPayload(row, cycle, stage, 'delete')
    if (onDeleteStage) {
      onDeleteStage(row, payload)
      return
    }
    if (cycle.source === 'primary' && stage === 'pstoResult') onDeleteResult(row)
  }

  const canOpenDocumentForStage = (fieldKey: WeldFieldKey) =>
    canOpenDocumentForField ? canOpenDocumentForField(fieldKey) : canOpenDocument

  return (
    <WorkflowDialogShell variant="manager" elevated={elevated}>
      <DialogHeader
        title="История ПСТО и ТВМТ"
        subtitle={managerView.tab === 'documents' ? 'Выберите документ для просмотра состава и изменения общих реквизитов.' : 'Основной и повторные циклы одного стыка показаны в хронологическом порядке. Удаление выполняется только с конца цепочки.'}
        onClose={onClose}
      />
      <WorkflowManagerViews view={managerView} documents={{ choices: PSTO_DOCUMENTS, references: documentReferences,
        disabled: isPending || dirtyStages.size > 0,
        disabledReason: dirtyStages.size > 0 ? 'Сначала сохраните или отмените изменения позиции на вкладке «Стыки».' : undefined,
        onSaved: onDocumentDateSaved, onMessage, onRunRootCauseAction, onOpenJournalRows }}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <BufferedFilterInput
                value={search}
                onValueChange={(value) => {
                  setSearch(value)
                  onRegistrySearchChange?.(value)
                }}
                placeholder="Стык, линия или документ"
                className="pl-9"
              />
            </label>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Найдено: {filteredRows.length}</span>
              <span>Стыков в области: {rows.length}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {pagination.pageItems.length > 0 ? (
              <div className="space-y-1">
                {pagination.pageItems.map((row) => {
                  const cycles = buildPstoCycleTimeline(row, row.pstoRepeatCycles ?? [])
                  const selected = row.id === selectedRow?.id
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setSelectedRowId(row.id)
                        setSelectedSequence(cycles.at(-1)?.sequence ?? 1)
                      }}
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${selected
                        ? 'border-sky-300 bg-white shadow-sm ring-1 ring-sky-100'
                        : 'border-transparent hover:border-slate-200 hover:bg-white'}`}
                    >
                      <strong className="block truncate text-sm text-slate-900">
                        {text(row.line) || '-'} · {text(row.joint) || '-'}
                      </strong>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {text(row.projectTitle) || '-'} · {text(row.subtitleCode) || '-'}
                      </span>
                      <span className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-600">Циклов: {cycles.length}</span>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
                          {getPstoTvmtWorkflowLabel(getPstoTvmtWorkflowState(row))}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <RequestManagerEmptyState>Циклы ПСТО/ТВМТ не найдены.</RequestManagerEmptyState>
            )}
          </div>
          {hasMoreRows && onLoadMoreRows ? (
            <div className="border-t border-slate-200 p-2">
              <Button variant="outline" className="w-full" onClick={onLoadMoreRows}>
                Загрузить ещё стыки
              </Button>
            </div>
          ) : null}
          <DialogRowPagination
            totalCount={pagination.totalCount}
            firstItemNumber={pagination.firstItemNumber}
            lastItemNumber={pagination.lastItemNumber}
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            onPreviousPage={pagination.goToPreviousPage}
            onNextPage={pagination.goToNextPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </aside>
        <main className="min-h-0 overflow-y-auto bg-white">
          {!selectedRow || !selectedCycle ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <RequestManagerEmptyState>Выберите стык слева.</RequestManagerEmptyState>
            </div>
          ) : (
            <div className="space-y-5 p-5 lg:p-6">
              <section className="border-b border-slate-200 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">
                      {text(selectedRow.line) || '-'} · {text(selectedRow.joint) || '-'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Проект: {text(selectedRow.projectTitle) || '-'} · Шифр: {text(selectedRow.subtitleCode) || '-'}
                      <MetaSeparator /><JointConnectionTypeMeta row={selectedRow} />
                    </p>
                  </div>
                  <span className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800">
                    {getPstoTvmtWorkflowLabel(getPstoTvmtWorkflowState(selectedRow))}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Циклы ПСТО и ТВМТ">
                  {timeline.map((cycle) => (
                    <button
                      key={cycleKey(cycle)}
                      type="button"
                      role="tab"
                      aria-selected={cycle.sequence === selectedCycle.sequence}
                      onClick={() => setSelectedSequence(cycle.sequence)}
                      className={`border-b-2 px-4 py-2 text-sm font-medium transition ${cycle.sequence === selectedCycle.sequence
                        ? 'border-sky-500 text-sky-800'
                        : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                      {cycle.sequence === 1 ? 'Основной цикл' : `Повтор #${cycle.sequence}`}
                    </button>
                  ))}
                </div>
              </section>
              <section className="grid min-w-0 gap-3 xl:grid-cols-2">
                {getDisplayedStages(
                  selectedCycle,
                  rootCauseTarget?.rowId === selectedRow.id &&
                    rootCauseTarget.sequence === selectedCycle.sequence
                    ? rootCauseTarget.stage
                    : initialSequence === selectedCycle.sequence ? initialStage : undefined,
                ).map((stage) => (
                  <CycleStageEditor
                    key={`${selectedRow.id}:${cycleKey(selectedCycle)}:${stage}`}
                    row={selectedRow}
                    cycle={selectedCycle}
                    stage={stage}
                    saveCheckSettings={saveCheckSettings}
                    isPending={isPending}
                    canOpenDocument={canOpenDocumentForStage(getStageDocumentField(stage))}
                    onSave={(draft) => {
                      if (onCorrectStage) {
                        onCorrectStage({
                          ...createPayload(selectedRow, selectedCycle, stage, 'update'),
                          ...draft,
                        })
                        return
                      }
                      if (selectedCycle.source === 'primary' && stage === 'pstoResult') {
                        onRenameDiagram(selectedRow, draft.name)
                      }
                    }}
                    onDelete={() => runDeleteStage(selectedRow, selectedCycle, stage)}
                    onOpenDocument={() => onOpenDocument(
                      getCycleDocumentRow(selectedRow, selectedCycle),
                      getStageDocumentField(stage),
                    )}
                    onOpenCycle={setSelectedSequence}
                    onCorrectTvmtAndRemoveLaterCycles={onCorrectTvmtAndRemoveLaterCycles
                      ? (draft) => onCorrectTvmtAndRemoveLaterCycles(selectedRow, {
                          rowId: selectedRow.id,
                          expectedVersion: String(selectedRow.rowVersion ?? '').trim(),
                          sequence: selectedCycle.sequence,
                          cycleId: selectedCycle.id,
                          date: draft.date,
                          name: draft.name,
                          result: draft.result,
                        })
                      : undefined}
                    onOpenContextMenu={(event) => openStageContextMenu(event, selectedRow, selectedCycle, stage)}
                    dateEditorFocusKey={dateEditorTarget?.rowId === selectedRow.id &&
                      dateEditorTarget.sequence === selectedCycle.sequence &&
                      dateEditorTarget.stage === stage
                      ? dateEditorTarget.token
                      : undefined}
                    onStageEditingChange={onStageEditingChange}
                    onStageDirtyChange={onStageDirtyChange}
                    rootCauseFocus={rootCauseTarget?.rowId === selectedRow.id &&
                      rootCauseTarget.sequence === selectedCycle.sequence &&
                      rootCauseTarget.stage === stage
                      ? rootCauseTarget.focus
                      : initialStage === stage && initialSequence === selectedCycle.sequence
                        ? rootCauseTarget?.focus ?? 'date'
                        : undefined}
                    onEditDocument={managerView.openDocument}
                  />
                ))}
              </section>
            </div>
          )}
        </main>
      </div>
      </WorkflowManagerViews>
      <DialogContextMenuLayer ref={contextMenuRef} />
    </WorkflowDialogShell>
  )
}

function CycleStageEditor({
  row,
  cycle,
  stage,
  saveCheckSettings,
  isPending,
  canOpenDocument,
  onSave,
  onDelete,
  onOpenDocument,
  onOpenCycle,
  onCorrectTvmtAndRemoveLaterCycles,
  onOpenContextMenu,
  dateEditorFocusKey,
  onStageEditingChange,
  onStageDirtyChange,
  rootCauseFocus,
  onEditDocument,
}: {
  row: WeldRow
  cycle: PstoCycleSnapshot
  stage: PstoCycleStage
  saveCheckSettings: SaveCheckSettings
  isPending: boolean
  canOpenDocument: boolean
  onSave: (draft: StageDraft) => void
  onDelete: () => void
  onOpenDocument: () => void
  onOpenCycle: (sequence: number) => void
  onCorrectTvmtAndRemoveLaterCycles?: (draft: StageDraft) => void
  onOpenContextMenu: (event: MouseEvent<HTMLElement>) => void
  dateEditorFocusKey?: number
  onStageEditingChange: (rowId: number, sequence: number, stage: PstoCycleStage, editing: boolean) => void
  onStageDirtyChange: (stage: PstoCycleStage, dirty: boolean) => void
  rootCauseFocus?: 'date' | 'name' | 'result'
  onEditDocument: (reference: import('@/lib/system-document-types').SystemDocumentReference) => void
}) {
  const confirmPositionChange = useDocumentPositionChange()
  const { can } = useAccess()
  // Keep this callback stable while a menu request changes: only folding an
  // opened editor consumes its request, not an ordinary parent rerender.
  const onEditingChange = useCallback((editing: boolean) => onStageEditingChange(row.id, cycle.sequence, stage, editing),
    [onStageEditingChange, row.id, cycle.sequence, stage])
  const stageData = getStageData(cycle, stage)
  const documentField = getStageDocumentField(stage)
  const documentReference = getSystemDocumentReferenceForField(getCycleDocumentRow(row, cycle), documentField)
  const { jointCount, onCompositionLoaded } = useDocumentJointCount(JSON.stringify(documentReference))
  const canMovePosition = !documentReference || (jointCount ?? 0) > 1
  const usesWholeDocumentDateEditor = Boolean(documentReference)
  const [draft, setDraft] = useState<StageDraft>(stageData)
  useEffect(() => setDraft(stageData), [stageData.date, stageData.name, stageData.result])
  const deletePermissionReason = can('psto.delete') ? '' : 'Нет права удаления в ПСТО. Обратитесь к администратору.'
  const deleteReason = deletePermissionReason || getPstoCycleStageDeleteBlockReason(row, cycle.sequence, stage)
  const hasChanges = (
    (!usesWholeDocumentDateEditor && draft.date !== stageData.date) ||
    draft.name !== stageData.name ||
    draft.result !== stageData.result
  )
  useEffect(() => { onStageDirtyChange(stage, hasChanges) }, [onStageDirtyChange, stage, hasChanges])
  useEffect(() => () => onStageDirtyChange(stage, false), [onStageDirtyChange, stage])
  const requisiteErrors = getDocumentRequisiteErrors({ name: draft.name, date: draft.date, nameLabel: 'наименование документа', dateLabel: 'Дата документа' })
  const draftComplete = requisiteErrors.length === 0 && (stage !== 'tvmtResult' || Boolean(draft.result))
  const saveBlockReason = hasChanges
    ? requisiteErrors.join('\n') || getPstoCycleStageSaveBlockReason(row, cycle, stage, draft, saveCheckSettings)
    : ''
  const blockingLaterCycleSequence = getBlockingLaterCycleSequence(
    row,
    cycle,
    stage,
    draft,
    saveBlockReason,
    saveCheckSettings,
  )

  return (
    <article
      className="min-w-0 rounded-md border border-slate-200 bg-slate-50/60 p-4"
      onContextMenu={onOpenContextMenu}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{getPstoCycleStageLabel(stage)}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {stage === 'tvmtResult' ? `Результат: ${stageData.result || '-'}` : `Дата: ${stageData.date ? formatDisplayDate(stageData.date) : '-'}`}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!canOpenDocument} onClick={onOpenDocument}>
          <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
          Открыть
        </Button>
      </div>
      <p className="mt-2 break-words text-sm text-slate-700">{stageData.name || 'Документ не указан'}</p>
      <DocumentConnectionsButton reference={documentReference} />
      <div className="mt-4">
      <ManagerEditPanel title="Документ и выбранная позиция" requestToken={dateEditorFocusKey ?? rootCauseFocus} onEditingChange={onEditingChange}>
        {documentReference ? <WorkflowDocumentLink reference={documentReference} onOpen={onEditDocument}
          onCompositionLoaded={onCompositionLoaded} focusDate={rootCauseFocus === 'date'} /> : null}
        <ManagerEditSection title={`${stage === 'pstoRequest' || stage === 'tvmtRequest' ? 'Редактирование позиции заявки' : 'Редактирование результата стыка'} · ${text(row.joint) || '-'} · ${getPstoCycleStageInlineLabel(stage)}`}
          description="Изменения применяются только к выбранной позиции. Остальные стыки и их результаты сохраняются.">
      <div className={`mt-4 grid min-w-0 gap-3 ${stage === 'tvmtResult'
        ? 'sm:grid-cols-2'
        : !usesWholeDocumentDateEditor ? 'sm:grid-cols-[minmax(145px,0.8fr)_minmax(0,1.6fr)]' : ''}`}>
        {stage === 'tvmtResult' ? (
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-600">
            <span>Результат</span>
            <Select
              className="min-w-0"
              value={draft.result}
              autoFocus={rootCauseFocus === 'result'}
              disabled={isPending}
              onChange={(event) => setDraft((current) => ({ ...current, result: event.target.value }))}
            >
              <option value="" disabled>не выбран</option>
              <option value="годен">годен</option>
              <option value="не годен">не годен</option>
            </Select>
          </label>
        ) : null}
        {!usesWholeDocumentDateEditor ? (
          <label className="min-w-0 space-y-1.5 text-xs font-medium text-slate-600">
            <span>Дата</span>
            <Input
              className="min-w-0 aria-invalid:border-rose-400"
              type="date"
              aria-invalid={!draft.date}
              value={draft.date}
              autoFocus={rootCauseFocus === 'date'}
              disabled={isPending}
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
        ) : null}
        {canMovePosition ? <label className={`min-w-0 space-y-1.5 text-xs font-medium text-slate-600 ${stage === 'tvmtResult' ? 'sm:col-span-2' : ''}`}>
          <span>{getNameLabel(stage)} только этого стыка</span>
          <Input
            className="min-w-0 aria-invalid:border-rose-400"
            aria-invalid={!draft.name.trim()}
            value={draft.name}
            autoFocus={rootCauseFocus === 'name'}
            disabled={isPending}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label> : null}
      </div>
      {canMovePosition ? <p className="mt-3 text-xs leading-5 text-slate-500">Другое название перенесёт выбранную позицию в отдельный документ или присоединит к существующему с теми же реквизитами. Для переименования всех позиций используйте вкладку «Документы».</p> : null}
      <div className="mt-4 grid min-w-0 gap-3 border-t border-slate-200 pt-4">
        <div className="min-w-0 space-y-2 break-words text-xs leading-5">
          <p className="text-slate-500">
            {deleteReason
              ? `Удаление заблокировано: ${deleteReason}`
              : 'Последний этап можно удалить без каскадного удаления предыдущих данных.'}
          </p>
          {saveBlockReason ? <p className="font-medium text-rose-700">Сохранение заблокировано: {saveBlockReason}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={isPending || !hasChanges} onClick={() => setDraft(stageData)}>
            Отменить изменения
          </Button>
          {blockingLaterCycleSequence ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                disabled={isPending}
                onClick={() => onOpenCycle(blockingLaterCycleSequence)}
              >
                Просмотреть цикл №{blockingLaterCycleSequence}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
              {onCorrectTvmtAndRemoveLaterCycles ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={isPending || Boolean(deletePermissionReason)}
                  title={deletePermissionReason || undefined}
                  onClick={() => void confirmPositionChange({ previousName: stageData.name, nextName: draft.name,
                    position: `${text(row.line)} · ${text(row.joint)} · ТВМТ`,
                    save: () => onCorrectTvmtAndRemoveLaterCycles(draft) })}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Удалить последующие циклы и сохранить
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                disabled={isPending || Boolean(deleteReason)}
                title={deleteReason || undefined}
                onClick={onDelete}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Удалить этап
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isPending || !hasChanges || !draftComplete || Boolean(saveBlockReason)}
                title={saveBlockReason || undefined}
                onClick={() => void confirmPositionChange({ previousName: stageData.name, nextName: draft.name,
                  position: `${text(row.line)} · ${text(row.joint)} · ${getPstoCycleStageLabel(stage)}`,
                  save: () => onSave(draft) })}
              >
                Сохранить изменения
              </Button>
            </>
          )}
        </div>
      </div>
        </ManagerEditSection>
      </ManagerEditPanel>
      </div>
    </article>
  )
}

function getBlockingLaterCycleSequence(
  row: WeldRow,
  cycle: PstoCycleSnapshot,
  stage: PstoCycleStage,
  draft: StageDraft,
  saveBlockReason: string,
  saveCheckSettings: SaveCheckSettings,
) {
  if (
    stage !== 'tvmtResult' ||
    normalizeTvmtResult(draft.result) !== 'good' ||
    !saveBlockReason
  ) return null

  try {
    return applyPstoTvmtCorrectionWithLaterCycleRemoval(row, {
      sequence: cycle.sequence,
      cycleId: cycle.source === 'repeat' ? cycle.id : undefined,
      date: draft.date,
      name: draft.name,
      result: draft.result,
    }, saveCheckSettings).deletedRepeatCycles[0]?.sequence ?? null
  } catch {
    return null
  }
}

function getPstoCycleStageSaveBlockReason(
  row: WeldRow,
  cycle: PstoCycleSnapshot,
  stage: PstoCycleStage,
  draft: StageDraft,
  saveCheckSettings: SaveCheckSettings,
) {
  try {
    applyPstoCycleCorrection(row, {
      sequence: cycle.sequence,
      cycleId: cycle.source === 'repeat' ? cycle.id : undefined,
      stage,
      action: 'update',
      date: draft.date,
      name: draft.name,
      result: draft.result,
    }, saveCheckSettings)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : 'Проверьте хронологию цикла.'
  }
}

function getExistingStages(cycle: PstoCycleSnapshot): PstoCycleStage[] {
  return [
    cycle.pstoRequest || cycle.pstoRequestDate ? 'pstoRequest' : null,
    isCompletedPstoResult(cycle.pstoResult) || cycle.pstoDate || cycle.heatTreatmentDiagram ? 'pstoResult' : null,
    cycle.tvmtRequest || cycle.tvmtRequestDate ? 'tvmtRequest' : null,
    normalizeTvmtResult(cycle.tvmtResult) || cycle.tvmtConclusionDate || cycle.tvmtConclusion ? 'tvmtResult' : null,
  ].filter((stage): stage is PstoCycleStage => Boolean(stage))
}

function getDisplayedStages(cycle: PstoCycleSnapshot, requestedStage?: PstoCycleStage) {
  const stages = new Set(getExistingStages(cycle))
  if (requestedStage) stages.add(requestedStage)
  return (['pstoRequest', 'pstoResult', 'tvmtRequest', 'tvmtResult'] as const)
    .filter((stage) => stages.has(stage))
}

function getStageData(cycle: PstoCycleSnapshot, stage: PstoCycleStage): StageDraft {
  if (stage === 'pstoRequest') {
    return { date: parseDateLikeToIso(cycle.pstoRequestDate) ?? '', name: cycle.pstoRequest, result: '' }
  }
  if (stage === 'pstoResult') {
    return { date: parseDateLikeToIso(cycle.pstoDate) ?? '', name: cycle.heatTreatmentDiagram, result: cycle.pstoResult }
  }
  if (stage === 'tvmtRequest') {
    return { date: parseDateLikeToIso(cycle.tvmtRequestDate) ?? '', name: cycle.tvmtRequest, result: '' }
  }
  const normalizedResult = normalizeTvmtResult(cycle.tvmtResult)
  return {
    date: parseDateLikeToIso(cycle.tvmtConclusionDate) ?? '',
    name: cycle.tvmtConclusion,
    result: normalizedResult === 'failed' ? 'не годен' : normalizedResult === 'good' ? 'годен' : '',
  }
}

function createPayload(
  row: WeldRow,
  cycle: PstoCycleSnapshot,
  stage: PstoCycleStage,
  action: 'update' | 'delete',
): CorrectPstoCycleStagePayload {
  return {
    rowId: row.id,
    expectedVersion: String(row.rowVersion ?? '').trim(),
    sequence: cycle.sequence,
    cycleId: cycle.id,
    stage,
    action,
  }
}

function getCycleDocumentRow(row: WeldRow, cycle: PstoCycleSnapshot) {
  if (cycle.source === 'primary') return buildPrimaryPstoSystemDocumentRow(row)
  const relation = row.pstoRepeatCycles?.find((candidate) => candidate.id === cycle.id)
  return relation ? buildPstoRepeatSystemDocumentRow(row, relation) : row
}

function getStageDocumentField(stage: PstoCycleStage): WeldFieldKey {
  if (stage === 'pstoRequest') return 'pstoRequest'
  if (stage === 'pstoResult') return 'heatTreatmentDiagram'
  if (stage === 'tvmtRequest') return 'tvmtRequest'
  return 'tvmtConclusion'
}

function getDocumentLabel(stage: PstoCycleStage) {
  if (stage === 'pstoRequest') return 'заявку ПСТО'
  if (stage === 'pstoResult') return 'диаграмму ПСТО'
  if (stage === 'tvmtRequest') return 'заявку ТВМТ'
  return 'заключение ТВМТ'
}

function getNameLabel(stage: PstoCycleStage) {
  if (stage === 'pstoResult') return 'Наименование диаграммы'
  if (stage === 'tvmtResult') return 'Наименование заключения'
  return 'Наименование заявки'
}

function cycleKey(cycle: PstoCycleSnapshot) {
  return cycle.source === 'primary' ? 'primary' : `repeat-${cycle.id ?? cycle.sequence}`
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU')
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
