import { memo, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PaginationBar } from '@/components/pagination-bar'
import { RequestRowsSearch } from '@/components/request-rows-search'
import { Button } from '@/components/ui/button'
import { ResultBadge } from '@/lib/weld-table-badges'
import { getDuplicateControls } from '@/lib/duplicate-control-utils'
import { isUnofficialJoint } from '@/lib/joint-display'
import {
  DUPLICATE_CONTROL_METHODS,
  DUPLICATE_CONTROL_RESULTS,
  type DuplicateControlDraft,
  type DuplicateControlMethod,
  type DuplicateControlRecord,
  type DuplicateControlRegistryRecord,
  type DuplicateControlResult,
} from '@/lib/duplicate-control-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import { usePagination } from '@/lib/use-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { calculateFinalStatus, formatFinalStatusDisplay } from '@/lib/weld-status'

export type DuplicateControlDialogProps = {
  elevated?: boolean
  draft: DuplicateControlDraft
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  filteredRowCount?: number
  candidateRowsLoading?: boolean
  candidateRowsError?: string | null
  candidatePagination?: DuplicateControlPagination
  selectedRowsLoading?: boolean
  selectingFilteredRows?: boolean
  controls: DuplicateControlRegistryRecord[]
  controlCount?: number
  controlsLoading?: boolean
  controlsError?: string | null
  controlsPagination?: DuplicateControlPagination
  saveBlockReason: string | null
  isSaving: boolean
  onClose: () => void
  onSave: () => void
  onDelete: (control: DuplicateControlRecord) => void
  onEdit: (control: DuplicateControlRecord) => void
  onDraftChange: Dispatch<SetStateAction<DuplicateControlDraft>>
  onToggleRow: (rowId: number) => void
  onSetVisibleRowsSelected: (selected: boolean) => void | Promise<void>
  onToggleMethod: (method: DuplicateControlMethod) => void
  onExistingControlsOpenChange?: (open: boolean) => void
}

type DuplicateControlPagination = {
  totalCount: number
  firstItemNumber: number
  lastItemNumber: number
  pageSize: number
  hasMore: boolean
  onLoadMore: () => void
  onPageSizeChange: (pageSize: number) => void
}

export function DuplicateControlDialog({
  elevated = false,
  draft,
  filteredRows,
  selectedRows,
  filteredRowCount,
  candidateRowsLoading = false,
  candidateRowsError = null,
  candidatePagination,
  selectedRowsLoading = false,
  selectingFilteredRows = false,
  controls,
  controlCount,
  controlsLoading = false,
  controlsError = null,
  controlsPagination,
  saveBlockReason,
  isSaving,
  onClose,
  onSave,
  onDelete,
  onEdit,
  onDraftChange,
  onToggleRow,
  onSetVisibleRowsSelected,
  onToggleMethod,
  onExistingControlsOpenChange,
}: DuplicateControlDialogProps) {
  const isEditing = typeof draft.id === 'number'
  const [showExistingControls, setShowExistingControls] = useState(false)
  const [showSelectedPreview, setShowSelectedPreview] = useState(false)
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const paginationResetKeys = useMemo(() => [draft.search, filteredRows], [draft.search, filteredRows])
  const rowsPagination = usePagination({
    items: filteredRows,
    defaultPageSize: 100,
    resetKeys: paginationResetKeys,
  })
  const handleEditControl = (control: DuplicateControlRecord) => {
    setShowExistingControls(false)
    setShowSelectedPreview(false)
    onExistingControlsOpenChange?.(false)
    onEdit(control)
  }
  const candidateCount = filteredRowCount ?? filteredRows.length
  const visibleRows = candidatePagination ? filteredRows : rowsPagination.pageItems
  const activeCandidatePagination = candidatePagination ?? {
    totalCount: rowsPagination.totalCount,
    firstItemNumber: rowsPagination.firstItemNumber,
    lastItemNumber: rowsPagination.lastItemNumber,
    pageSize: rowsPagination.pageSize,
    hasMore: rowsPagination.hasMore,
    onLoadMore: rowsPagination.loadMore,
    onPageSizeChange: rowsPagination.setPageSize,
  }

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1240px]"
      maxHeightClassName="h-[88vh]"
      overlayClassName={elevated ? 'z-[110] bg-slate-950/30' : 'z-[75] bg-slate-950/25'}
      panelShadowClassName="shadow-slate-950/10"
    >
      <DialogHeader
        title={isEditing ? 'Редактирование дубль-контроля' : 'Дубль контроль'}
        subtitle="Контроль заказчика без заявки. Негодный дубль влияет на итоговый статус и цепочку как обычный негодный результат."
        onClose={onClose}
      />

      {showExistingControls ? (
        <section className="min-h-0 flex-1 overflow-hidden px-6 py-5">
          <DuplicateControlList
            controls={controls}
            loading={controlsLoading}
            error={controlsError}
            pagination={controlsPagination}
            onEdit={handleEditControl}
            onDelete={onDelete}
            fill
          />
        </section>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4 overflow-y-auto">
          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">1. Метод и результат</h3>
            <p className="mt-1 text-xs text-slate-500">
              Можно выбрать один или несколько методов. При редактировании меняется одна запись.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {DUPLICATE_CONTROL_METHODS.map((method) => {
                const selected = draft.methods.has(method)
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => onToggleMethod(method)}
                    disabled={isEditing && !selected}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                      selected
                        ? 'border-sky-300 bg-sky-50 text-sky-900 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200'
                    } ${isEditing && !selected ? 'cursor-not-allowed opacity-50 hover:border-slate-200' : ''}`}
                  >
                    {method}
                  </button>
                )
              })}
            </div>

            <label className="mt-4 block text-xs font-semibold text-slate-600">
              Результат
              <select
                value={draft.result}
                onChange={(event) =>
                  onDraftChange((current) => ({
                    ...current,
                    result: event.target.value as DuplicateControlResult | '',
                  }))
                }
                className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              >
                <option value="" className="font-normal">
                  Выберите результат
                </option>
                {DUPLICATE_CONTROL_RESULTS.map((result) => (
                  <option key={result} value={result} className="font-normal">
                    {result}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">2. Дата и заключение</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-semibold text-slate-600">
                Дата контроля
                <input
                  value={draft.controlDate}
                  onChange={(event) => onDraftChange((current) => ({ ...current, controlDate: event.target.value }))}
                  placeholder="08.07.2026"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Заключение
                <input
                  value={draft.conclusion}
                  onChange={(event) => onDraftChange((current) => ({ ...current, conclusion: event.target.value }))}
                  placeholder="Номер заключения заказчика"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Дата заключения
                <input
                  value={draft.conclusionDate}
                  onChange={(event) => onDraftChange((current) => ({ ...current, conclusionDate: event.target.value }))}
                  placeholder="08.07.2026"
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
            </div>
          </section>

          <section className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800">
            Дубль-контроль не создает заявку ЛНК. Если результат дубля «ремонт» или «вырез», стык становится негодным по дублю,
            а диспетчер предложит следующий стык с индексом R или W соответственно.
          </section>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Стыки</h3>
              <p className="text-xs text-muted-foreground">Выберите стык для дубль-контроля. При создании можно выбрать несколько стыков.</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onSetVisibleRowsSelected(true)}
                disabled={isEditing || candidateCount === 0 || candidateRowsLoading || selectingFilteredRows}
              >
                {selectingFilteredRows ? 'Загрузка выбора…' : 'Выбрать найденные'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSetVisibleRowsSelected(false)}
                disabled={isEditing || draft.rowIds.size === 0 || selectingFilteredRows}
              >
                Снять выбор
              </Button>
            </div>
          </div>

          <div className="mb-3">
            <RequestRowsSearch
              value={draft.search}
              placeholder="Проект, шифр, линия, спул или стык"
              filteredCount={candidateCount}
              availableCount={candidateCount}
              statsLabel={<>Найдено: {candidateCount} · Выбрано: {draft.rowIds.size}</>}
              onChange={(search) => onDraftChange((current) => ({ ...current, search }))}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200">
            {candidateRowsLoading && filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">Загрузка стыков…</DialogEmptyState>
            ) : candidateRowsError && filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">{candidateRowsError}</DialogEmptyState>
            ) : filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">По фильтру ничего не найдено.</DialogEmptyState>
            ) : (
              <DialogVirtualizedRows
                items={visibleRows}
                estimateRowHeight={74}
                getItemKey={(row) => row.id}
                renderItem={(row) => (
                  <DuplicateControlRow
                    row={row}
                    selected={draft.rowIds.has(row.id)}
                    disabled={isEditing && !draft.rowIds.has(row.id)}
                    onToggleRow={stableOnToggleRow}
                  />
                )}
                footer={(
                  <div className="p-3">
                    <PaginationBar
                      totalCount={activeCandidatePagination.totalCount}
                      firstItemNumber={activeCandidatePagination.firstItemNumber}
                      lastItemNumber={activeCandidatePagination.lastItemNumber}
                      pageSize={activeCandidatePagination.pageSize}
                      hasMore={activeCandidatePagination.hasMore}
                      onLoadMore={activeCandidatePagination.onLoadMore}
                      onPageSizeChange={activeCandidatePagination.onPageSizeChange}
                    />
                  </div>
                )}
              />
            )}
          </div>
        </section>
      </div>
      )}

      <div className="border-t border-slate-200/80 px-6 py-4">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              const next = !showExistingControls
              setShowExistingControls(next)
              onExistingControlsOpenChange?.(next)
              setShowSelectedPreview(false)
            }}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
          >
            <span>
              <span className="block text-sm font-semibold text-slate-900">Внесенные дубли</span>
              <span className="text-xs text-slate-500">
                {controlCount === undefined
                  ? 'открыть реестр'
                  : controlCount > 0
                    ? `${controlCount} записей`
                    : 'пока нет записей'}
              </span>
            </span>
            {showExistingControls ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-500">
            {selectedRowsLoading
              ? 'Загружаются выбранные стыки…'
              : saveBlockReason
                ? saveBlockReason
                : `Будет сохранено: ${selectedRows.length * draft.methods.size}`}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowSelectedPreview(true)}
              disabled={selectedRows.length === 0 || selectedRowsLoading || showExistingControls}
            >
              {`Предпросмотр (${selectedRows.length})`}
            </Button>
            <Button onClick={onSave} disabled={Boolean(saveBlockReason) || selectedRowsLoading || isSaving}>
              <Check className="mr-2 h-4 w-4" />
              {isEditing ? 'Сохранить дубль' : 'Добавить дубль'}
            </Button>
          </div>
        </div>
      </div>
      {showSelectedPreview ? (
        <DuplicateControlPreviewDialog
          rows={selectedRows}
          draft={draft}
          elevated={elevated}
          onClose={() => setShowSelectedPreview(false)}
        />
      ) : null}
    </LargeDialogShell>
  )
}

type DuplicateControlRowProps = {
  row: WeldRow
  selected: boolean
  disabled: boolean
  onToggleRow: (rowId: number) => void
}

const DuplicateControlRow = memo(function DuplicateControlRow({
  row,
  selected,
  disabled,
  onToggleRow,
}: DuplicateControlRowProps) {
  const rowControls = getDuplicateControls(row)
  const finalStatus = String(row.finalStatus ?? '').trim() || calculateFinalStatus(row)
  const finalStatusDisplay = formatFinalStatusDisplay(row, finalStatus)
  const isUnofficial = isUnofficialJoint(row)

  return (
    <button
      type="button"
      onClick={() => !disabled && onToggleRow(row.id)}
      disabled={disabled}
      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${
        selected ? 'bg-sky-50' : 'bg-white hover:bg-slate-50'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
              isUnofficial
                ? 'border-slate-300 bg-slate-100 text-slate-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {isUnofficial ? 'неофициальный' : 'официальный'}
          </span>
          <ResultBadge value={finalStatusDisplay} />
        </span>
        <span className="block text-xs text-slate-500">
          {String(row.projectTitle ?? '-')} · {String(row.subtitleCode ?? '-')} · {String(row.line ?? '-')} · D:{' '}
          {String(row.d1 ?? '-') || '-'} · WDI: {String(row.wdi ?? '-') || '-'} · дата сварки:{' '}
          {String(row.weldDate ?? '-') || '-'}
        </span>
        {rowControls.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {rowControls.map((control) => (
              <span
                key={control.id}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
              >
                <span className="font-semibold">{control.method}</span>
                <span className="text-slate-400">дубль</span>
                <ResultBadge value={control.result} />
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs text-slate-500">{selected ? 'выбран' : ''}</span>
    </button>
  )
}, (previous, next) => (
  previous.row === next.row &&
  previous.selected === next.selected &&
  previous.disabled === next.disabled
))

function DuplicateControlPreviewDialog({
  rows,
  draft,
  elevated,
  onClose,
}: {
  rows: WeldRow[]
  draft: DuplicateControlDraft
  elevated: boolean
  onClose: () => void
}) {
  const methods = Array.from(draft.methods)
  const resultLabel = draft.result || 'результат не выбран'
  const rowsPagination = usePagination({ items: rows, defaultPageSize: 100, resetKeys: [rows] })

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[86vh]"
      overlayClassName={elevated ? 'z-[120] bg-slate-950/30' : 'z-[85] bg-slate-950/25'}
    >
      <DialogHeader
        title="Предпросмотр выбранных стыков"
        subtitle={`Методы: ${methods.length > 0 ? methods.join(', ') : '-'} · Результат: ${resultLabel} · Выбрано: ${rows.length}`}
        onClose={onClose}
        closeLabel="Закрыть предпросмотр"
      />
      <div className="flex min-h-0 flex-1 flex-col p-5">
        {rows.length === 0 ? (
          <DialogEmptyState minHeightClassName="min-h-40">Нет выбранных стыков.</DialogEmptyState>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200">
            <DialogVirtualizedRows
              items={rowsPagination.pageItems}
              estimateRowHeight={76}
              getItemKey={(row) => row.id}
              renderItem={(row) => {
                const finalStatus = String(row.finalStatus ?? '').trim() || calculateFinalStatus(row)
                const finalStatusDisplay = formatFinalStatusDisplay(row, finalStatus)
                const isUnofficial = isUnofficialJoint(row)
                return (
                  <div className="flex items-start justify-between gap-3 bg-white px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{String(row.joint ?? '-')}</span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                            isUnofficial
                              ? 'border-slate-300 bg-slate-100 text-slate-700'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {isUnofficial ? 'неофициальный' : 'официальный'}
                        </span>
                        <ResultBadge value={finalStatusDisplay} />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {String(row.projectTitle ?? '-')} · {String(row.subtitleCode ?? '-')} · {String(row.line ?? '-')} · D:{' '}
                        {String(row.d1 ?? '-') || '-'} · WDI: {String(row.wdi ?? '-') || '-'} · дата сварки:{' '}
                        {String(row.weldDate ?? '-') || '-'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {methods.length > 0 ? (
                        methods.map((method) => (
                          <span
                            key={method}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800"
                          >
                            <span className="font-semibold">{method}</span>
                            <span>дубль</span>
                            {draft.result ? <ResultBadge value={draft.result} /> : null}
                          </span>
                        ))
                      ) : (
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">метод не выбран</span>
                      )}
                    </div>
                  </div>
                )
              }}
              footer={(
                <div className="p-3">
                  <PaginationBar
                    totalCount={rowsPagination.totalCount}
                    firstItemNumber={rowsPagination.firstItemNumber}
                    lastItemNumber={rowsPagination.lastItemNumber}
                    pageSize={rowsPagination.pageSize}
                    hasMore={rowsPagination.hasMore}
                    onLoadMore={rowsPagination.loadMore}
                    onPageSizeChange={rowsPagination.setPageSize}
                  />
                </div>
              )}
            />
          </div>
        )}
      </div>
      <DialogCloseFooter onClose={onClose} />
    </LargeDialogShell>
  )
}

function DuplicateControlList({
  controls,
  fill = false,
  loading,
  error,
  pagination,
  onDelete,
  onEdit,
}: {
  controls: DuplicateControlRegistryRecord[]
  fill?: boolean
  loading: boolean
  error: string | null
  pagination?: DuplicateControlPagination
  onDelete: (control: DuplicateControlRecord) => void
  onEdit: (control: DuplicateControlRecord) => void
}) {
  const controlsPagination = usePagination({ items: controls, defaultPageSize: 100, resetKeys: [controls] })
  const visibleControls = pagination ? controls : controlsPagination.pageItems
  const activePagination = pagination ?? {
    totalCount: controlsPagination.totalCount,
    firstItemNumber: controlsPagination.firstItemNumber,
    lastItemNumber: controlsPagination.lastItemNumber,
    pageSize: controlsPagination.pageSize,
    hasMore: controlsPagination.hasMore,
    onLoadMore: controlsPagination.loadMore,
    onPageSizeChange: controlsPagination.setPageSize,
  }

  return (
    <div className={`overflow-y-auto rounded-md border border-slate-200 ${fill ? 'h-full' : 'max-h-36'}`}>
      {loading && controls.length === 0 ? (
        <div className="px-3 py-3 text-sm text-slate-500">Загрузка реестра дубль-контроля…</div>
      ) : error && controls.length === 0 ? (
        <div className="px-3 py-3 text-sm text-rose-700">{error}</div>
      ) : controls.length === 0 ? (
        <div className="px-3 py-3 text-sm text-slate-500">Пока нет дубль-контроля.</div>
      ) : (
        <>
          {visibleControls.map((control) => (
              <div
                key={control.id}
                className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 text-sm">
                  <span className="mr-2 font-semibold text-slate-900">
                    {control.joint || `#${control.weldJointId}`}
                  </span>
                  <span className="font-medium text-slate-900">{control.method}</span>{' '}
                  <ResultBadge value={control.result} />{' '}
                  <span className="text-slate-500">
                    дата: {control.controlDate || '-'} · заключение: {control.conclusion || '-'}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {[control.projectTitle, control.subtitleCode, control.line, control.spool].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit(control)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Изменить
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() => onDelete(control)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Удалить
                  </Button>
                </div>
              </div>
          ))}
          <div className="p-3">
            <PaginationBar
              totalCount={activePagination.totalCount}
              firstItemNumber={activePagination.firstItemNumber}
              lastItemNumber={activePagination.lastItemNumber}
              pageSize={activePagination.pageSize}
              hasMore={activePagination.hasMore}
              onLoadMore={activePagination.onLoadMore}
              onPageSizeChange={activePagination.onPageSizeChange}
            />
          </div>
        </>
      )}
    </div>
  )
}
