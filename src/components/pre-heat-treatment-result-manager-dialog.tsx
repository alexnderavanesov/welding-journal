import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { FileSpreadsheet, Plus, Search, Trash2 } from 'lucide-react'

import { DialogContextMenuLayer, type DialogContextMenuLayerHandle } from '@/components/dialog-context-menu-layer'
import { DialogHeader } from '@/components/dialog-header'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import {
  LNK_MANAGER_DIALOG_HEIGHT_CLASS,
  LNK_MANAGER_DIALOG_WIDTH_CLASS,
} from '@/components/lnk-dialog-layout'
import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'
import { RequestManagerEmptyState } from '@/components/request-manager-panels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDisplayDate, parseDateLikeToIso } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getDialogMenuPoint } from '@/lib/dialog-context-menu-items'
import {
  getPreHeatTreatmentControls,
  isPreHeatTreatmentLnkMethodCode,
  PRE_HEAT_TREATMENT_LNK_METHODS,
  type PreHeatTreatmentControlRecord,
  type PreHeatTreatmentLnkMethodCode,
} from '@/lib/lnk-control-stage'
import { buildManagerContextMenu, isNativeContextMenuTarget } from '@/lib/manager-context-menu-items'
import {
  getPreHeatTreatmentRequestRemovalBlockReason,
  getPreHeatTreatmentResultRemovalBlockReason,
  PRE_HEAT_TREATMENT_RESULT_OPTIONS,
} from '@/lib/pre-heat-treatment-control-updates'
import { PRE_HEAT_TREATMENT_REPORT_FIELDS } from '@/lib/pre-heat-treatment-report-fields'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { usePagePagination } from '@/lib/use-page-pagination'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { CorrectPreHeatTreatmentLnkResultPayload } from '@/server/pre-heat-treatment-lnk-workflow'

type PreResultEntry = {
  row: WeldRow
  control: PreHeatTreatmentControlRecord
  methodCode: PreHeatTreatmentLnkMethodCode
}

type PreHeatTreatmentRegistryMode = 'request' | 'result'
type RequestFilter = 'all' | 'open' | 'fixed'
type ResultFilter = 'all' | 'годен' | 'ремонт' | 'вырез'

export type PreHeatTreatmentResultManagerDialogProps = {
  rows: WeldRow[]
  registryMode: PreHeatTreatmentRegistryMode
  initialRelationId?: number | null
  isPending: boolean
  onClose: () => void
  onStageChange?: () => void
  onOpenWorkflow: () => void
  onCorrect: (payload: CorrectPreHeatTreatmentLnkResultPayload) => void
  onDeleteRequest: (row: WeldRow, control: PreHeatTreatmentControlRecord) => void
  onDeleteResult: (row: WeldRow, control: PreHeatTreatmentControlRecord) => void
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenJournalRows: (rows: readonly WeldRow[], sourceLabel: string) => void
  onOpenPstoHistory?: (row: WeldRow) => void
  onCopyDocumentName: (documentName: string) => void
  canOpenDocument: (fieldKey: WeldFieldKey) => boolean
}

export function PreHeatTreatmentResultManagerDialog({
  rows,
  registryMode,
  initialRelationId,
  isPending,
  onClose,
  onStageChange,
  onOpenWorkflow,
  onCorrect,
  onDeleteRequest,
  onDeleteResult,
  onOpenDocument,
  onOpenJournalRows,
  onOpenPstoHistory,
  onCopyDocumentName,
  canOpenDocument,
}: PreHeatTreatmentResultManagerDialogProps) {
  const contextMenuRef = useRef<DialogContextMenuLayerHandle>(null)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('all')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const entries = useMemo(() => buildEntries(rows, registryMode), [registryMode, rows])
  const filteredEntries = useMemo(() => {
    const query = normalizeSearchText(search)
    return entries.filter((entry) => {
      if (methodFilter && entry.methodCode !== methodFilter) return false
      if (registryMode === 'request') {
        const completed = isFinalResult(entry.control.result)
        if (requestFilter === 'open' && completed) return false
        if (requestFilter === 'fixed' && !completed) return false
      } else if (resultFilter !== 'all' && text(entry.control.result).toLocaleLowerCase('ru-RU') !== resultFilter) {
        return false
      }
      if (!query) return true
      return normalizeSearchText([
        entry.row.projectTitle,
        entry.row.subtitleCode,
        entry.row.line,
        entry.row.spool,
        entry.row.joint,
        entry.methodCode,
        entry.control.requestName,
        entry.control.conclusionName,
        entry.control.result,
      ].join(' ')).includes(query)
    })
  }, [entries, methodFilter, registryMode, requestFilter, resultFilter, search])
  const pagination = usePagePagination({
    items: filteredEntries,
    defaultPageSize: 50,
    resetKeys: [methodFilter, registryMode, requestFilter, resultFilter, search],
  })
  const [selectedRelationId, setSelectedRelationId] = useState<number | null>(initialRelationId ?? null)
  const selectedEntry = filteredEntries.find((entry) => entry.control.id === selectedRelationId)
    ?? filteredEntries[0]
    ?? null
  const [requestDraft, setRequestDraft] = useState(() => createRequestDraft(selectedEntry?.control))
  const [resultDraft, setResultDraft] = useState(() => createResultDraft(selectedEntry?.control))

  useEffect(() => {
    if (initialRelationId && entries.some((entry) => entry.control.id === initialRelationId)) {
      setSelectedRelationId(initialRelationId)
    }
  }, [entries, initialRelationId])
  useEffect(() => {
    if (selectedEntry && selectedEntry.control.id !== selectedRelationId) {
      setSelectedRelationId(selectedEntry.control.id)
    }
  }, [selectedEntry, selectedRelationId])
  useEffect(() => {
    setRequestDraft(createRequestDraft(selectedEntry?.control))
    setResultDraft(createResultDraft(selectedEntry?.control))
  }, [selectedEntry?.control.id, selectedEntry?.control.updatedAt])

  const openContextMenu = (event: MouseEvent<HTMLElement>, entry: PreResultEntry) => {
    if (isNativeContextMenuTarget(event.target)) return
    setSelectedRelationId(entry.control.id)
    const point = getDialogMenuPoint(event)
    const managesResult = registryMode === 'result'
    const documentField = getPreFieldKey(
      entry.methodCode,
      managesResult ? 'conclusionName' : 'requestName',
    )
    const documentName = text(managesResult ? entry.control.conclusionName : entry.control.requestName)
    const deleteReason = managesResult
      ? getPreHeatTreatmentResultRemovalBlockReason(entry.row, entry.control)
      : getPreHeatTreatmentRequestRemovalBlockReason(entry.row, entry.control)
    contextMenuRef.current?.open(buildManagerContextMenu({
      ...point,
      heading: `${text(entry.row.line) || '-'} · ${text(entry.row.joint) || '-'}`,
      description: `${entry.methodCode} до ТО · ${managesResult ? text(entry.control.result) : text(entry.control.requestName)}`,
      documentName,
      documentLabel: managesResult ? 'заключение до ТО' : 'заявку до ТО',
      rows: [entry.row],
      sourceLabel: `НК ${entry.methodCode} до ТО · стык ${text(entry.row.joint) || entry.row.id}`,
      dangerActions: [{
        id: managesResult ? 'delete-pre-result' : 'delete-pre-request',
        label: managesResult ? 'Удалить результат' : 'Удалить заявку',
        icon: Trash2,
        danger: true,
        disabled: isPending || Boolean(deleteReason),
        title: deleteReason || undefined,
        onSelect: () => managesResult
          ? onDeleteResult(entry.row, entry.control)
          : onDeleteRequest(entry.row, entry.control),
      }],
      openDocumentDisabledReason: !documentField
        ? 'Поле документа не найдено'
        : !canOpenDocument(documentField)
          ? 'Сначала загрузите шаблон этого документа в настройках документов'
          : null,
      onOpenDocument: () => {
        if (documentField) onOpenDocument(entry.row, documentField)
      },
      onCopyDocumentName,
      onOpenJournalRows,
      onOpenPstoHistory,
    }))
  }

  const selectedConclusionField = selectedEntry
    ? getPreFieldKey(selectedEntry.methodCode, 'conclusionName')
    : null
  const selectedRequestField = selectedEntry
    ? getPreFieldKey(selectedEntry.methodCode, 'requestName')
    : null
  const resultDeleteReason = selectedEntry
    ? getPreHeatTreatmentResultRemovalBlockReason(selectedEntry.row, selectedEntry.control)
    : ''
  const requestDeleteReason = selectedEntry
    ? getPreHeatTreatmentRequestRemovalBlockReason(selectedEntry.row, selectedEntry.control)
    : ''
  const hasRequestChanges = Boolean(selectedEntry) && (
    requestDraft.date !== (parseDateLikeToIso(selectedEntry.control.requestDate) ?? '') ||
    requestDraft.name !== text(selectedEntry.control.requestName)
  )
  const hasResultChanges = Boolean(selectedEntry) && (
    resultDraft.result !== text(selectedEntry.control.result) ||
    resultDraft.date !== (parseDateLikeToIso(selectedEntry.control.conclusionDate) ?? '') ||
    resultDraft.name !== text(selectedEntry.control.conclusionName)
  )

  return (
    <LargeDialogShell
      maxWidthClassName={LNK_MANAGER_DIALOG_WIDTH_CLASS}
      maxHeightClassName={LNK_MANAGER_DIALOG_HEIGHT_CLASS}
      overlayClassName="z-[60] bg-slate-950/30"
    >
      <DialogHeader
        title={registryMode === 'request'
          ? 'Редактирование заявок ЛНК до ТО'
          : 'Редактирование результатов ЛНК до ТО'}
        subtitle={registryMode === 'request'
          ? 'Найдите заявку, проверьте ее состав или выполните доступное действие.'
          : 'Найдите внесенный результат, проверьте связанные документы или выполните допустимое изменение.'}
        onClose={onClose}
        actions={onStageChange ? <LnkControlStageSwitch value="beforeHeatTreatment" onChange={(stage) => {
          if (stage === 'primary') onStageChange()
        }} /> : null}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-slate-200 p-4">
            <Button className="w-full" onClick={onOpenWorkflow} disabled={isPending}>
              <Plus className="mr-2 h-4 w-4" />
              {registryMode === 'request' ? 'Новая заявка' : 'Внести результаты'}
            </Button>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={registryMode === 'request'
                  ? 'Название, дата, стык или линия'
                  : 'Стык, линия, заявка или заключение'}
                className="pl-9"
              />
            </label>
            <Select
              aria-label="Вид контроля в реестре"
              value={methodFilter}
              onChange={(event) => setMethodFilter(event.target.value)}
            >
              <option value="">Все виды контроля</option>
              {PRE_HEAT_TREATMENT_LNK_METHODS.map((method) => (
                <option key={method.code} value={method.code}>{method.code}</option>
              ))}
            </Select>
            {registryMode === 'request' ? (
              <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-white p-1 text-xs" role="group" aria-label="Фильтр заявок">
                {([
                  ['all', 'Все'],
                  ['open', 'Открытые'],
                  ['fixed', 'Закрытые'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={requestFilter === value}
                    onClick={() => setRequestFilter(value)}
                    className={`min-h-8 rounded px-2 font-medium transition ${requestFilter === value
                      ? 'bg-sky-50 text-sky-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 rounded-md border border-slate-200 bg-white p-1 text-xs" role="group" aria-label="Фильтр результатов">
                {(['all', 'годен', 'ремонт', 'вырез'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={resultFilter === value}
                    onClick={() => setResultFilter(value)}
                    className={`min-h-8 rounded px-1.5 font-medium transition ${resultFilter === value
                      ? 'bg-sky-50 text-sky-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {value === 'all' ? 'Все' : value}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-between text-xs text-slate-500">
              <span>Найдено: {filteredEntries.length}</span>
              <span>Стыков в области: {rows.length}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {pagination.pageItems.length > 0 ? (
              <div className="space-y-1">
                {pagination.pageItems.map((entry) => {
                  const selected = entry.control.id === selectedEntry?.control.id
                  return (
                    <button
                      key={entry.control.id}
                      type="button"
                      onClick={() => setSelectedRelationId(entry.control.id)}
                      onContextMenu={(event) => openContextMenu(event, entry)}
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${selected
                        ? 'border-sky-300 bg-white shadow-sm ring-1 ring-sky-100'
                        : 'border-transparent hover:border-slate-200 hover:bg-white'}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <strong className="block truncate text-sm text-slate-900">
                            {registryMode === 'request'
                              ? text(entry.control.requestName) || 'Заявка не указана'
                              : `${text(entry.row.line) || '-'} · ${text(entry.row.joint) || '-'}`}
                          </strong>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {registryMode === 'request'
                              ? `${formatDisplayDate(entry.control.requestDate)} · ${entry.methodCode}`
                              : `${entry.methodCode} до ТО`}
                          </span>
                        </span>
                        {registryMode === 'request' ? (
                          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${isFinalResult(entry.control.result)
                            ? 'border-slate-200 bg-slate-100 text-slate-600'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {isFinalResult(entry.control.result) ? 'Закрыта' : 'Открыта'}
                          </span>
                        ) : (
                          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getLnkResultBadgeClass(entry.control.result)}`}>
                            {text(entry.control.result)}
                          </span>
                        )}
                      </span>
                      <span className="mt-2 block truncate text-xs text-slate-600">
                        {registryMode === 'request'
                          ? `${text(entry.row.line) || '-'} · ${text(entry.row.joint) || '-'}`
                          : text(entry.control.conclusionName) || 'Заключение не указано'}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {registryMode === 'request'
                          ? entry.control.requestDate
                            ? formatDisplayDate(entry.control.requestDate)
                            : 'Дата заявки не указана'
                          : entry.control.conclusionDate
                            ? formatDisplayDate(entry.control.conclusionDate)
                            : 'Дата контроля не указана'}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <RequestManagerEmptyState>
                {entries.length === 0
                  ? registryMode === 'request'
                    ? 'В выбранной области нет заявок ЛНК до ТО.'
                    : 'В выбранной области нет внесенных результатов ЛНК до ТО.'
                  : 'Позиции не найдены.'}
              </RequestManagerEmptyState>
            )}
          </div>
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
            itemLabel="позиций"
          />
        </aside>
        <main className="min-h-0 overflow-y-auto bg-white p-5 lg:p-6">
          {!selectedEntry ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <RequestManagerEmptyState>Выберите позицию НК до ТО слева.</RequestManagerEmptyState>
            </div>
          ) : (
            <div className="space-y-5">
              <section className="border-b border-slate-200 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                        {selectedEntry.methodCode} до ТО
                      </span>
                      {registryMode === 'request' ? (
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${isFinalResult(selectedEntry.control.result)
                          ? 'border-slate-200 bg-slate-100 text-slate-600'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                          {isFinalResult(selectedEntry.control.result) ? 'Закрыта' : 'Открыта'}
                        </span>
                      ) : (
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${getLnkResultBadgeClass(selectedEntry.control.result)}`}>
                          {text(selectedEntry.control.result)}
                        </span>
                      )}
                    </div>
                    <h2 className="break-words text-xl font-semibold text-slate-950">
                      {registryMode === 'request'
                        ? text(selectedEntry.control.requestName) || 'Заявка не указана'
                        : `${text(selectedEntry.row.line) || '-'} · ${text(selectedEntry.row.joint) || '-'}`}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {registryMode === 'request'
                        ? `Стык: ${text(selectedEntry.row.line) || '-'} · ${text(selectedEntry.row.joint) || '-'} · Проект: ${text(selectedEntry.row.projectTitle) || '-'}`
                        : `Проект: ${text(selectedEntry.row.projectTitle) || '-'} · Шифр: ${text(selectedEntry.row.subtitleCode) || '-'}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {registryMode === 'request' ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!selectedRequestField || !canOpenDocument(selectedRequestField)}
                        onClick={() => {
                          if (selectedRequestField) onOpenDocument(selectedEntry.row, selectedRequestField)
                        }}
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Открыть документ
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!selectedConclusionField || !canOpenDocument(selectedConclusionField)}
                        onClick={() => {
                          if (selectedConclusionField) onOpenDocument(selectedEntry.row, selectedConclusionField)
                        }}
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Открыть документ
                      </Button>
                    )}
                  </div>
                </div>
              </section>
              {registryMode === 'request' ? (
                <section className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Заявка</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(280px,1fr)]">
                  <label className="space-y-1.5 text-xs font-medium text-slate-600">
                    <span>Дата заявки</span>
                    <Input
                      type="date"
                      value={requestDraft.date}
                      disabled={isPending}
                      onChange={(event) => setRequestDraft((current) => ({ ...current, date: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-slate-600">
                    <span>Наименование заявки</span>
                    <Input
                      value={requestDraft.name}
                      disabled={isPending}
                      onChange={(event) => setRequestDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                  <p className="max-w-2xl text-xs leading-5 text-slate-500">
                    Заявку можно исправить при сохранении хронологии. Для удаления сначала удалите результат этого вида НК.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                      disabled={isPending || Boolean(requestDeleteReason)}
                      title={requestDeleteReason || undefined}
                      onClick={() => onDeleteRequest(selectedEntry.row, selectedEntry.control)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Удалить заявку
                    </Button>
                    <Button
                      type="button"
                      disabled={isPending || !hasRequestChanges || !requestDraft.date || !requestDraft.name}
                      onClick={() => onCorrect({
                        relationId: selectedEntry.control.id,
                        stage: 'request',
                        action: 'update',
                        requestDate: requestDraft.date,
                        requestName: requestDraft.name,
                      })}
                    >
                      Сохранить заявку
                    </Button>
                  </div>
                </div>
                </section>
              ) : null}
              {registryMode === 'result' ? (
                <section className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Результат и заключение</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-[180px_180px_minmax(260px,1fr)]">
                    <label className="space-y-1.5 text-xs font-medium text-slate-600">
                      <span>Результат</span>
                      <Select
                        value={resultDraft.result}
                        disabled={isPending}
                        onChange={(event) => setResultDraft((current) => ({ ...current, result: event.target.value }))}
                      >
                        {PRE_HEAT_TREATMENT_RESULT_OPTIONS.map((result) => <option key={result}>{result}</option>)}
                      </Select>
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-slate-600">
                      <span>Дата контроля</span>
                      <Input
                        type="date"
                        value={resultDraft.date}
                        disabled={isPending}
                        onChange={(event) => setResultDraft((current) => ({ ...current, date: event.target.value }))}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-slate-600">
                      <span>Наименование заключения</span>
                      <Input
                        value={resultDraft.name}
                        disabled={isPending}
                        onChange={(event) => setResultDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                    <p className="max-w-2xl text-xs leading-5 text-slate-500">
                      Дата остается между датой заявки и ПСТО. Для остальных методов ВИК до ТО должен быть уже годен.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                        disabled={isPending || Boolean(resultDeleteReason)}
                        title={resultDeleteReason || undefined}
                        onClick={() => onDeleteResult(selectedEntry.row, selectedEntry.control)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Удалить результат
                      </Button>
                      <Button
                        type="button"
                        disabled={isPending || !hasResultChanges || !resultDraft.date || !resultDraft.name || !resultDraft.result}
                        onClick={() => onCorrect({
                          relationId: selectedEntry.control.id,
                          stage: 'result',
                          action: 'update',
                          result: resultDraft.result,
                          conclusionDate: resultDraft.date,
                          conclusionName: resultDraft.name,
                        })}
                      >
                        Сохранить результат
                      </Button>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </main>
      </div>
      <DialogContextMenuLayer ref={contextMenuRef} />
    </LargeDialogShell>
  )
}

function buildEntries(rows: WeldRow[], registryMode: PreHeatTreatmentRegistryMode): PreResultEntry[] {
  return rows.flatMap((row) => getPreHeatTreatmentControls(row).flatMap((control) => {
    const methodCode = text(control.method).toLocaleUpperCase('ru-RU')
    const belongsToRegistry = registryMode === 'request'
      ? Boolean(text(control.requestName))
      : isFinalResult(control.result)
    return isPreHeatTreatmentLnkMethodCode(methodCode) && belongsToRegistry
      ? [{ row, control, methodCode }]
      : []
  }))
}

function getPreFieldKey(
  methodCode: PreHeatTreatmentLnkMethodCode,
  valueKey: 'requestName' | 'conclusionName',
) {
  return PRE_HEAT_TREATMENT_REPORT_FIELDS.find(
    (field) => field.methodCode === methodCode && field.valueKey === valueKey,
  )?.fieldKey ?? null
}

function createRequestDraft(control?: PreHeatTreatmentControlRecord) {
  return {
    date: parseDateLikeToIso(control?.requestDate) ?? '',
    name: text(control?.requestName),
  }
}

function createResultDraft(control?: PreHeatTreatmentControlRecord) {
  return {
    result: text(control?.result),
    date: parseDateLikeToIso(control?.conclusionDate) ?? '',
    name: text(control?.conclusionName),
  }
}

function isFinalResult(value: unknown) {
  return PRE_HEAT_TREATMENT_RESULT_OPTIONS.includes(
    text(value).toLocaleLowerCase('ru-RU') as (typeof PRE_HEAT_TREATMENT_RESULT_OPTIONS)[number],
  )
}

function text(value: unknown) {
  return String(value ?? '').trim()
}
