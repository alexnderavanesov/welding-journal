import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { CalendarClock, CheckSquare2, ClipboardCheck, FileSpreadsheet, ListFilter, Pencil, Plus, Search, Trash2 } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogHeader } from '@/components/dialog-header'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { LnkResultManagerActions } from '@/components/lnk-result-manager-actions'
import {
  type LnkResultChangeHintState,
  type LnkResultManagerEntryData,
  type LnkResultMethod,
} from '@/components/lnk-result-manager-entry'
import { LnkResultManagerFooter } from '@/components/lnk-result-manager-footer'
import { LnkResultManagerSummary } from '@/components/lnk-result-manager-summary'
import { RequestManagerEmptyState } from '@/components/request-manager-panels'
import { BufferedFilterInput } from '@/components/result-filters'
import { ResultManagerDocumentEditor } from '@/components/result-manager-document-editor'
import { SystemDocumentDateEditor } from '@/components/system-document-date-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import { getLnkResultRemovalBlockReason } from '@/lib/lnk-chronology-checks'
import { getLnkRepairForbiddenReason, isLnkRepairForbidden } from '@/lib/lnk-result-rules'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { LNK_RESULT_OPTIONS } from '@/lib/report-config'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import type {
  WorkflowRootCauseAction,
  WorkflowRootCauseTarget,
} from '@/lib/workflow-root-cause-actions'

type ResultFilter = 'all' | 'годен' | 'ремонт' | 'вырез'

export type LnkResultManagerDialogProps = {
  embedded?: boolean
  elevated?: boolean
  rows: WeldRow[]
  methods: LnkResultMethod[]
  entries: LnkResultManagerEntryData[]
  pendingEntries: LnkResultManagerEntryData[]
  isContextReady: boolean
  methodKey: WeldFieldKey | ''
  initialEntryKey: string
  conclusionDrafts: Record<string, string>
  pendingResultChanges: Record<string, string>
  changeHint: LnkResultChangeHintState
  isResultCorrectionPending: boolean
  isResultReplacementPending: boolean
  isConclusionCorrectionPending: boolean
  isRequestCorrectionPending?: boolean
  onClose: () => void
  onStageChange?: () => void
  onOpenAddResult: () => void
  onOpenRows: (row: WeldRow) => void
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  canOpenDocument: (fieldKey: WeldFieldKey) => boolean
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onConclusionDraftChange: (changeKey: string, value: string) => void
  onRenameConclusion: (row: WeldRow, methodKey: WeldFieldKey, conclusionName: string) => void
  onRepairRequest?: (row: WeldRow, methodKey: WeldFieldKey, requestName: string, requestDate: string) => void
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
  onResetPendingChanges: () => void
  onSaveChanges: () => void
  rootCauseTarget?: Extract<WorkflowRootCauseTarget, { kind: 'lnk-control' }>
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onDocumentDateSaved?: () => void
  onMessage?: (message: string) => void
}

export function LnkResultManagerDialog({
  embedded = false,
  elevated = false,
  rows,
  methods,
  entries,
  pendingEntries,
  isContextReady,
  methodKey,
  initialEntryKey,
  conclusionDrafts,
  pendingResultChanges,
  changeHint,
  isResultCorrectionPending,
  isResultReplacementPending,
  isConclusionCorrectionPending,
  isRequestCorrectionPending = false,
  onClose,
  onStageChange,
  onOpenAddResult,
  onOpenRows,
  onOpenDocument,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  canOpenDocument,
  onMethodChange,
  onConclusionDraftChange,
  onRenameConclusion,
  onRepairRequest,
  onReplaceResult,
  onClearResult,
  onResetPendingChanges,
  onSaveChanges,
  rootCauseTarget,
  onRunRootCauseAction,
  onDocumentDateSaved,
  onMessage,
}: LnkResultManagerDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [dateEditorTarget, setDateEditorTarget] = useState<{ entryKey: string; token: number } | null>(null)
  const [selectedEntryKey, setSelectedEntryKey] = useState(
    () => initialEntryKey || entries[0]?.changeKey || '',
  )
  const saveCheckSettings = useSaveCheckSettings()
  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru')
    return entries.filter(({ row, method }) => {
      const result = String(row[method.resultKey] ?? '').trim().toLocaleLowerCase('ru')
      if (resultFilter !== 'all' && result !== resultFilter) return false
      if (!query) return true
      return [
        row.projectTitle,
        row.subtitleCode,
        row.line,
        row.spool,
        row.joint,
        method.code,
        row[method.requestKey],
        row[method.requestDateKey],
        row[method.resultKey],
        row[method.conclusionKey],
        row[method.conclusionDateKey],
      ]
        .map((value) => String(value ?? '').trim())
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(query)
    })
  }, [entries, resultFilter, search])

  useEffect(() => {
    if (initialEntryKey && entries.some((entry) => entry.changeKey === initialEntryKey)) {
      setSelectedEntryKey(initialEntryKey)
    }
  }, [entries, initialEntryKey])

  useEffect(() => {
    if (selectedEntryKey && filteredEntries.some((entry) => entry.changeKey === selectedEntryKey)) return
    setSelectedEntryKey(filteredEntries[0]?.changeKey ?? '')
  }, [filteredEntries, selectedEntryKey])

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.changeKey === selectedEntryKey) ?? filteredEntries[0],
    [filteredEntries, selectedEntryKey],
  )
  const activeSelectedEntryKey = selectedEntry?.changeKey ?? ''
  const selectedRow = selectedEntry?.row
  const selectedMethod = selectedEntry?.method
  const selectedResult = selectedEntry
    ? String(selectedEntry.row[selectedEntry.method.resultKey] ?? '').trim()
    : ''
  const selectedConclusion = selectedEntry
    ? String(selectedEntry.row[selectedEntry.method.conclusionKey] ?? '').trim()
    : ''
  const selectedConclusionDate = selectedEntry
    ? String(selectedEntry.row[selectedEntry.method.conclusionDateKey] ?? '').trim()
    : ''
  const selectedRequest = selectedEntry
    ? String(selectedEntry.row[selectedEntry.method.requestKey] ?? '').trim()
    : ''
  const selectedRequestDate = selectedEntry
    ? String(selectedEntry.row[selectedEntry.method.requestDateKey] ?? '').trim()
    : ''
  const isRequestIntegrityRepair = Boolean(
    selectedEntry &&
    rootCauseTarget?.documentPart === 'request' &&
    rootCauseTarget.rowId === selectedEntry.row.id &&
    rootCauseTarget.methodCode === selectedEntry.method.code &&
    !selectedRequest,
  )
  const [requestRepairDraft, setRequestRepairDraft] = useState(() => ({
    name: selectedRequest,
    date: parseDateLikeToIso(selectedRequestDate) ?? '',
  }))
  useEffect(() => {
    setRequestRepairDraft({
      name: selectedRequest,
      date: parseDateLikeToIso(selectedRequestDate) ?? '',
    })
  }, [activeSelectedEntryKey, selectedRequest, selectedRequestDate])
  const selectedDocumentReference = useMemo(
    () => selectedRow && selectedMethod
      ? getSystemDocumentReferenceForField(selectedRow, selectedMethod.conclusionKey)
      : null,
    [selectedMethod, selectedRow],
  )
  const openResultContextMenu = (event: MouseEvent<HTMLElement>, entry: LnkResultManagerEntryData) => {
    const point = getDialogMenuPoint(event)
    const { row, method, changeKey } = entry
    const currentResult = String(row[method.resultKey] ?? '').trim()
    const pendingResult = pendingResultChanges[changeKey] ?? ''
    const conclusionName = String(row[method.conclusionKey] ?? '').trim()
    const conclusionDraft = formatCustomDocumentName(conclusionDrafts[changeKey] ?? conclusionName)
    const removalBlockReason = getLnkResultRemovalBlockReason(row, method.requestKey, saveCheckSettings)
    const actionPending = isResultCorrectionPending || isResultReplacementPending
    const documentReason = !conclusionName
      ? 'Заключение не указано'
      : !canOpenDocument(method.conclusionKey)
        ? 'Сначала загрузите шаблон этого заключения в настройках документов'
        : null

    setSelectedEntryKey(changeKey)
    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: `${String(row.line ?? '-').trim() || '-'} · ${String(row.joint ?? '-').trim() || '-'}`,
      description: `${method.code} · ${pendingResult || currentResult}`,
      documentName: conclusionName,
      documentLabel: 'заключение',
      rows: [row],
      sourceLabel: `результат ${method.code} · стык ${String(row.joint ?? row.id)}`,
      actions: [
        {
          id: 'replace-result',
          label: 'Изменить результат',
          icon: CheckSquare2,
          disabled: actionPending,
          onSelect: () => undefined,
          children: LNK_RESULT_OPTIONS.map((option) => {
            const repairReason = saveCheckSettings.lnkResultRepairRules && option === 'ремонт' && isLnkRepairForbidden(row)
              ? getLnkRepairForbiddenReason(row)
              : null
            return {
              id: `replace-result-${option}`,
              label: option,
              disabled: actionPending || Boolean(repairReason),
              title: repairReason ?? undefined,
              onSelect: () => onReplaceResult(row, method.requestKey, option),
            }
          }),
        },
        {
          id: 'change-conclusion-date',
          label: 'Изменить дату заключения',
          icon: CalendarClock,
          disabled: !conclusionName || isConclusionCorrectionPending,
          onSelect: () => setDateEditorTarget((current) => ({
            entryKey: changeKey,
            token: (current?.token ?? 0) + 1,
          })),
        },
        {
          id: 'rename-conclusion',
          label: 'Переименовать заключение',
          icon: Pencil,
          disabled: isConclusionCorrectionPending || !conclusionDraft || conclusionDraft === conclusionName,
          title: !conclusionDraft || conclusionDraft === conclusionName
            ? 'Сначала введите новое название в карточке результата'
            : undefined,
          onSelect: () => onRenameConclusion(row, method.requestKey, conclusionDraft),
        },
      ],
      dangerActions: [{
        id: 'delete-result',
        label: 'Удалить результат',
        icon: Trash2,
        danger: true,
        disabled: !currentResult || actionPending || Boolean(removalBlockReason),
        title: removalBlockReason || undefined,
        onSelect: () => onClearResult(row, method.requestKey),
      }],
      openDocumentDisabledReason: documentReason,
      onOpenDocument: () => onOpenDocument(row, method.conclusionKey),
      onCopyDocumentName,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  }

  const content = (
    <>
      <DialogHeader
        title="Редактирование результатов ЛНК"
        subtitle="Найдите внесенный результат, проверьте связанные документы или выполните допустимое изменение."
        onClose={onClose}
        actions={onStageChange ? <LnkControlStageSwitch value="primary" onChange={(stage) => {
          if (stage === 'beforeHeatTreatment') onStageChange()
        }} /> : null}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <Button className="w-full" onClick={onOpenAddResult}>
              <Plus className="mr-2 h-4 w-4" />
              Внести результаты
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <BufferedFilterInput
                value={search}
                onValueChange={setSearch}
                placeholder="Стык, линия, заявка или заключение"
                className="h-10 bg-white pl-9"
              />
            </label>
            <Select
              aria-label="Вид контроля в реестре"
              value={methodKey}
              onChange={(event) => {
                setSelectedEntryKey('')
                onMethodChange(event.target.value as WeldFieldKey)
              }}
              disabled={methods.length === 0}
            >
              <option value="">Все виды контроля</option>
              {methods.map((method) => (
                <option key={method.requestKey} value={method.requestKey}>{method.code}</option>
              ))}
            </Select>
            <div className="grid grid-cols-4 rounded-md border border-slate-200 bg-white p-1 text-xs" role="group" aria-label="Фильтр результатов">
              {(['all', 'годен', 'ремонт', 'вырез'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={resultFilter === value}
                  onClick={() => {
                    setSelectedEntryKey('')
                    setResultFilter(value)
                  }}
                  className={`min-h-8 rounded px-1.5 font-medium transition ${
                    resultFilter === value ? 'bg-sky-50 text-sky-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {value === 'all' ? 'Все' : value}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Найдено: {filteredEntries.length}</span>
              <span>Стыков в области: {rows.length}</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-2 lg:max-h-none">
            {!isContextReady ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                Загружаю результаты ЛНК...
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                {entries.length === 0 ? 'В выбранной области нет внесенных результатов.' : 'По заданным условиям результаты не найдены.'}
              </div>
            ) : (
              <DialogVirtualizedRows
                items={filteredEntries}
                estimateRowHeight={112}
                getItemKey={(entry) => entry.changeKey}
                renderItem={(entry) => {
                  const { row, method, changeKey } = entry
                  const currentResult = String(row[method.resultKey] ?? '').trim()
                  const pendingResult = pendingResultChanges[changeKey]
                  const conclusion = String(row[method.conclusionKey] ?? '').trim()
                  const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
                  const selected = changeKey === activeSelectedEntryKey
                  return (
                    <button
                      type="button"
                      onClick={() => setSelectedEntryKey(changeKey)}
                      onContextMenu={(event) => openResultContextMenu(event, entry)}
                      className={`mb-1 w-full rounded-md border px-3 py-3 text-left transition ${
                        selected
                          ? 'border-sky-300 bg-white shadow-sm ring-1 ring-sky-100'
                          : 'border-transparent hover:border-slate-200 hover:bg-white'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {String(row.line ?? '-').trim() || '-'} · {String(row.joint ?? '-').trim() || '-'}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">{method.code}</span>
                        </span>
                        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getLnkResultBadgeClass(pendingResult || currentResult)}`}>
                          {pendingResult || currentResult}
                        </span>
                      </span>
                      <span className="mt-2 block truncate text-xs text-slate-600">
                        {conclusion || 'Заключение не указано'}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {conclusionDate ? formatDisplayDate(conclusionDate) : 'Дата контроля не указана'}
                      </span>
                    </button>
                  )
                }}
                footer={null}
              />
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto bg-white">
          {!isContextReady ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <RequestManagerEmptyState>Загружаю реестр и карточки результатов ЛНК...</RequestManagerEmptyState>
            </div>
          ) : !selectedEntry || !selectedRow || !selectedMethod ? (
            <div className="flex min-h-[420px] items-center justify-center p-8">
              <RequestManagerEmptyState>Выберите результат слева, чтобы открыть его карточку.</RequestManagerEmptyState>
            </div>
          ) : (
            <div className="space-y-5 p-5 lg:p-6">
              <section className="border-b border-slate-200 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                        {selectedMethod.code}
                      </span>
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${getLnkResultBadgeClass(pendingResultChanges[selectedEntry.changeKey] || selectedResult)}`}>
                        {pendingResultChanges[selectedEntry.changeKey] || selectedResult}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {selectedConclusionDate ? formatDisplayDate(selectedConclusionDate) : 'Дата контроля не указана'}
                      </span>
                    </div>
                    <h2 className="break-words text-xl font-semibold text-slate-950">
                      {String(selectedRow.line ?? '-').trim() || '-'} · {String(selectedRow.joint ?? '-').trim() || '-'}
                    </h2>
                    <p className="mt-1 text-sm leading-5 text-slate-500">
                      Проект: {String(selectedRow.projectTitle ?? '-').trim() || '-'} · Шифр: {String(selectedRow.subtitleCode ?? '-').trim() || '-'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => onOpenRows(selectedRow)}>
                      <ListFilter className="mr-2 h-4 w-4" />
                      Показать в ЛНК
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onOpenDocument(selectedRow, selectedMethod.conclusionKey)}
                      disabled={!selectedConclusion || !canOpenDocument(selectedMethod.conclusionKey)}
                      title={!canOpenDocument(selectedMethod.conclusionKey) ? 'Сначала загрузите шаблон этого заключения в настройках документов' : undefined}
                    >
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Открыть документ
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(260px,0.85fr)]">
                  <ResultMetric label="Заявка" value={selectedRequest || '-'} />
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                    <ResultDateMetric
                      label="Дата заявки"
                      value={selectedRequestDate ? formatDisplayDate(selectedRequestDate) : '-'}
                    />
                    <ResultDateMetric
                      label="Дата контроля"
                      value={selectedConclusionDate ? formatDisplayDate(selectedConclusionDate) : '-'}
                      separated
                    />
                  </div>
                </div>
              </section>

              {isRequestIntegrityRepair ? (
                <section className="rounded-md border border-amber-200 bg-amber-50/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Восстановление заявки</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    У этой позиции есть результат НК, но реквизиты заявки неполные. Заполните оба поля одновременно.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(260px,1fr)]">
                    <label className="space-y-1.5 text-xs font-medium text-slate-600">
                      <span>Дата заявки</span>
                      <Input
                        type="date"
                        value={requestRepairDraft.date}
                        autoFocus={rootCauseTarget?.focus === 'date'}
                        disabled={isRequestCorrectionPending}
                        onChange={(event) => setRequestRepairDraft((current) => ({
                          ...current,
                          date: event.target.value,
                        }))}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-slate-600">
                      <span>Наименование заявки</span>
                      <Input
                        value={requestRepairDraft.name}
                        autoFocus={rootCauseTarget?.focus === 'name'}
                        disabled={isRequestCorrectionPending}
                        onChange={(event) => setRequestRepairDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))}
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex justify-end border-t border-amber-200 pt-4">
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        isRequestCorrectionPending ||
                        !requestRepairDraft.name.trim() ||
                        !requestRepairDraft.date ||
                        !onRepairRequest
                      }
                      onClick={() => onRepairRequest?.(
                        selectedEntry.row,
                        selectedEntry.method.requestKey,
                        requestRepairDraft.name.trim(),
                        requestRepairDraft.date,
                      )}
                    >
                      Восстановить заявку
                    </Button>
                  </div>
                </section>
              ) : null}

              <section className="space-y-4">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ClipboardCheck className="h-4 w-4 text-sky-600" />
                    Результат и заключение
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Изменение результата сохраняет заключение. Удаление очищает результат, дату контроля и заключение с учетом действующей хронологии НК.
                  </p>
                </div>
                <div
                  className="rounded-md border border-slate-200 bg-slate-50/60 p-4"
                  onContextMenu={(event) => {
                    if (isNativeContextMenuTarget(event.target)) return
                    openResultContextMenu(event, selectedEntry)
                  }}
                >
                  <LnkResultManagerSummary
                    row={selectedRow}
                    methodCode={selectedMethod.code}
                    currentResult={selectedResult}
                    pendingResult={pendingResultChanges[selectedEntry.changeKey] ?? ''}
                    activeChangeHint={changeHint?.changeKey === selectedEntry.changeKey ? changeHint : null}
                    conclusionName={selectedConclusion}
                    conclusionDate={selectedConclusionDate}
                  />
                  {selectedDocumentReference && (
                    dateEditorTarget?.entryKey === selectedEntry.changeKey ||
                    (rootCauseTarget?.focus === 'date' &&
                      rootCauseTarget.rowId === selectedRow.id &&
                      rootCauseTarget.methodCode === selectedMethod.code &&
                      rootCauseTarget.documentPart === 'conclusion')
                  ) ? (
                    <div className="mt-4">
                      <SystemDocumentDateEditor
                        key={`${selectedEntry.changeKey}:${dateEditorTarget?.token ?? 0}`}
                        reference={selectedDocumentReference}
                        label={`Дата заключения ${selectedMethod.code}`}
                        disabled={isConclusionCorrectionPending || isResultCorrectionPending}
                        autoFocus
                        onMessage={onMessage}
                        onRunRootCauseAction={onRunRootCauseAction}
                        onSaved={() => {
                          setDateEditorTarget(null)
                          onDocumentDateSaved?.()
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <ResultManagerDocumentEditor
                      value={conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion}
                      placeholder="Наименование заключения для этого стыка"
                      hint="Название меняется отдельно от даты документа."
                      disabled={isConclusionCorrectionPending}
                      canRename={Boolean(
                        !isConclusionCorrectionPending &&
                        formatCustomDocumentName(conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion) &&
                        formatCustomDocumentName(conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion) !== selectedConclusion
                      )}
                      onChange={(value) => onConclusionDraftChange(selectedEntry.changeKey, value)}
                      onRename={(value) => onRenameConclusion(selectedRow, selectedMethod.requestKey, value)}
                    />
                    <LnkResultManagerActions
                      row={selectedRow}
                      method={selectedMethod}
                      currentResult={selectedResult}
                      pendingResult={pendingResultChanges[selectedEntry.changeKey] ?? ''}
                      isResultCorrectionPending={isResultCorrectionPending}
                      isResultReplacementPending={isResultReplacementPending}
                      onReplaceResult={onReplaceResult}
                      onClearResult={onClearResult}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      <LnkResultManagerFooter
        pendingEntriesCount={pendingEntries.length}
        isResultReplacementPending={isResultReplacementPending}
        onResetPendingChanges={onResetPendingChanges}
        onSaveChanges={onSaveChanges}
      />
      <DialogContextMenuLayer ref={contextMenuRef} />
    </>
  )

  return embedded ? content : <WorkflowDialogShell variant="manager" elevated={elevated}>{content}</WorkflowDialogShell>
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-14 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <strong className="mt-1 block break-words text-sm font-semibold leading-5 text-slate-900" title={value}>{value}</strong>
    </div>
  )
}

function ResultDateMetric({
  label,
  value,
  separated = false,
}: {
  label: string
  value: string
  separated?: boolean
}) {
  return (
    <div className={`min-w-0 px-3 py-2 ${separated ? 'border-l border-slate-200' : ''}`}>
      <span className="block truncate text-xs font-medium text-slate-500">{label}</span>
      <strong className="mt-1 block whitespace-nowrap text-sm font-semibold leading-5 text-slate-900">
        {value}
      </strong>
    </div>
  )
}
