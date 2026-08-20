import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, FileSpreadsheet, ListFilter, Plus, Search } from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkResultManagerActions } from '@/components/lnk-result-manager-actions'
import {
  type LnkResultChangeHintState,
  type LnkResultManagerEntryData,
  type LnkResultMethod,
} from '@/components/lnk-result-manager-entry'
import { LnkResultManagerFooter } from '@/components/lnk-result-manager-footer'
import { LnkResultManagerSummary } from '@/components/lnk-result-manager-summary'
import { RequestManagerEmptyState } from '@/components/request-manager-panels'
import { ResultManagerDocumentEditor } from '@/components/result-manager-document-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getLnkResultBadgeClass } from '@/lib/report-badges'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import type { WeldFieldKey } from '@/lib/weld-fields'

type ResultFilter = 'all' | 'годен' | 'ремонт' | 'вырез'

export type LnkResultManagerDialogProps = {
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
  onClose: () => void
  onOpenAddResult: () => void
  onOpenRows: (row: WeldRow) => void
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  canOpenDocument: (fieldKey: WeldFieldKey) => boolean
  onMethodChange: (methodKey: WeldFieldKey | '') => void
  onConclusionDraftChange: (changeKey: string, value: string) => void
  onRenameConclusion: (row: WeldRow, methodKey: WeldFieldKey) => void
  onReplaceResult: (row: WeldRow, methodKey: WeldFieldKey, result: string) => void
  onClearResult: (row: WeldRow, methodKey: WeldFieldKey) => void
  onResetPendingChanges: () => void
  onSaveChanges: () => void
}

export function LnkResultManagerDialog({
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
  onClose,
  onOpenAddResult,
  onOpenRows,
  onOpenDocument,
  canOpenDocument,
  onMethodChange,
  onConclusionDraftChange,
  onRenameConclusion,
  onReplaceResult,
  onClearResult,
  onResetPendingChanges,
  onSaveChanges,
}: LnkResultManagerDialogProps) {
  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [selectedEntryKey, setSelectedEntryKey] = useState(
    () => initialEntryKey || entries[0]?.changeKey || '',
  )
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

  const activeSelectedEntryKey = selectedEntryKey && filteredEntries.some((entry) => entry.changeKey === selectedEntryKey)
    ? selectedEntryKey
    : filteredEntries[0]?.changeKey ?? ''
  const selectedEntry = filteredEntries.find((entry) => entry.changeKey === activeSelectedEntryKey)
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

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1320px]"
      maxHeightClassName="h-[92vh]"
      overlayClassName="z-[60] bg-slate-950/30"
    >
      <DialogHeader
        title="Результаты ЛНК"
        subtitle="Найдите внесенный результат, проверьте связанные документы или выполните допустимое изменение."
        onClose={onClose}
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
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Стык, линия, заявка или заключение"
                className="h-10 bg-white pl-9"
              />
            </label>
            <Select
              aria-label="Вид контроля в реестре результатов"
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

          <div className="min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none">
            {!isContextReady ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                Загружаю результаты ЛНК...
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                {entries.length === 0 ? 'В выбранной области нет внесенных результатов.' : 'По заданным условиям результаты не найдены.'}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredEntries.map((entry) => {
                  const { row, method, changeKey } = entry
                  const currentResult = String(row[method.resultKey] ?? '').trim()
                  const pendingResult = pendingResultChanges[changeKey]
                  const conclusion = String(row[method.conclusionKey] ?? '').trim()
                  const conclusionDate = String(row[method.conclusionDateKey] ?? '').trim()
                  const selected = changeKey === activeSelectedEntryKey
                  return (
                    <button
                      key={changeKey}
                      type="button"
                      onClick={() => setSelectedEntryKey(changeKey)}
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${
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
                })}
              </div>
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
                <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
                  <LnkResultManagerSummary
                    row={selectedRow}
                    methodCode={selectedMethod.code}
                    currentResult={selectedResult}
                    pendingResult={pendingResultChanges[selectedEntry.changeKey] ?? ''}
                    activeChangeHint={changeHint?.changeKey === selectedEntry.changeKey ? changeHint : null}
                    conclusionName={selectedConclusion}
                    conclusionDate={selectedConclusionDate}
                  />
                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <ResultManagerDocumentEditor
                      value={conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion}
                      placeholder="Наименование заключения для этого стыка"
                      hint="Дата заключения фиксируется отдельно и не меняется через название."
                      disabled={isConclusionCorrectionPending}
                      canRename={Boolean(
                        !isConclusionCorrectionPending &&
                        formatCustomDocumentName(conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion) &&
                        formatCustomDocumentName(conclusionDrafts[selectedEntry.changeKey] ?? selectedConclusion) !== selectedConclusion
                      )}
                      onChange={(value) => onConclusionDraftChange(selectedEntry.changeKey, value)}
                      onRename={() => onRenameConclusion(selectedRow, selectedMethod.requestKey)}
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
    </LargeDialogShell>
  )
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
