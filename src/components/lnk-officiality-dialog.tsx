import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkOfficialitySettings } from '@/components/lnk-officiality-settings'
import { LnkOfficialityRow } from '@/components/lnk-officiality-row'
import { ManagerRowJointHeading } from '@/components/manager-row-joint-heading'
import { PaginationBar } from '@/components/pagination-bar'
import { RequestRowsSearch } from '@/components/request-rows-search'
import { Button } from '@/components/ui/button'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'
import type { LnkOfficialityCounters } from '@/lib/lnk-officiality-derived-utils'
import { usePagination } from '@/lib/use-pagination'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'

export type LnkOfficialityDialogProps = {
  draft: LnkOfficialityDraftState
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
  counters: LnkOfficialityCounters
  saveBlockReason: string | null
  isSaveDisabled: boolean
  onClose: () => void
  onSave: () => void
  onDraftChange: Dispatch<SetStateAction<LnkOfficialityDraftState>>
  onToggleRow: (rowId: number) => void
  onSetVisibleRowsSelected: (selected: boolean) => void
}

export function LnkOfficialityDialog({
  draft,
  filteredRows,
  selectedRows,
  counters,
  saveBlockReason,
  isSaveDisabled,
  onClose,
  onSave,
  onDraftChange,
  onToggleRow,
  onSetVisibleRowsSelected,
}: LnkOfficialityDialogProps) {
  const [showSelectedPreview, setShowSelectedPreview] = useState(false)
  const stableOnToggleRow = useStableEventCallback(onToggleRow)
  const paginationResetKeys = useMemo(() => [draft.search, filteredRows], [draft.search, filteredRows])
  const rowsPagination = usePagination({
    items: filteredRows,
    defaultPageSize: 100,
    resetKeys: paginationResetKeys,
  })

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1180px]"
      maxHeightClassName="h-[86vh]"
      overlayClassName="z-[90] bg-slate-950/25"
      panelShadowClassName="shadow-slate-950/10"
    >
      <DialogHeader title="Официальность стыков" subtitle={`Выбрано: ${draft.rowIds.size}`} onClose={onClose} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <LnkOfficialitySettings
          officiality={draft.officiality}
          selectedRows={selectedRows}
          counters={counters}
          onOfficialityChange={(officiality) => onDraftChange((current) => ({ ...current, officiality }))}
        />

        <section className="flex min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Стыки</h3>
              <p className="text-xs text-muted-foreground">Поиск по проекту, шифру, линии, спулу или номеру стыка.</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(true)} disabled={filteredRows.length === 0}>
                Выбрать найденные
              </Button>
              <Button type="button" variant="outline" onClick={() => onSetVisibleRowsSelected(false)} disabled={draft.rowIds.size === 0}>
                Снять выбор
              </Button>
            </div>
          </div>

          <div className="mb-3">
            <RequestRowsSearch
              value={draft.search}
              placeholder="Проект, шифр, линия, спул или стык"
              filteredCount={filteredRows.length}
              availableCount={filteredRows.length}
              statsLabel={<>Найдено: {filteredRows.length} · Выбрано: {draft.rowIds.size}</>}
              onChange={(search) => onDraftChange((current) => ({ ...current, search }))}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-slate-200">
            {filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">
                По фильтру ничего не найдено.
              </DialogEmptyState>
            ) : (
              <DialogVirtualizedRows
                items={rowsPagination.pageItems}
                estimateRowHeight={62}
                getItemKey={(row) => row.id}
                renderItem={(row) => (
                  <LnkOfficialityRow row={row} selected={draft.rowIds.has(row.id)} onToggle={stableOnToggleRow} />
                )}
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
            )}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 px-6 py-4">
        <div className="text-sm text-slate-500">
          {saveBlockReason ? saveBlockReason : `Будет обновлено стыков: ${selectedRows.length}`}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowSelectedPreview(true)}
            disabled={selectedRows.length === 0}
          >
            {`Предпросмотр (${selectedRows.length})`}
          </Button>
          <Button onClick={onSave} disabled={isSaveDisabled}>
            <Check className="mr-2 h-4 w-4" />
            Сохранить официальность
          </Button>
        </div>
      </div>
      {showSelectedPreview ? (
        <LnkOfficialityPreviewDialog rows={selectedRows} officiality={draft.officiality} onClose={() => setShowSelectedPreview(false)} />
      ) : null}
    </LargeDialogShell>
  )
}

function LnkOfficialityPreviewDialog({
  rows,
  officiality,
  onClose,
}: {
  rows: WeldRow[]
  officiality: LnkOfficialityDraftState['officiality']
  onClose: () => void
}) {
  const officialityLabel = officiality === 'official' ? 'официальный' : 'неофициальный'
  const rowsPagination = usePagination({ items: rows, defaultPageSize: 100, resetKeys: [rows] })

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[86vh]"
      overlayClassName="z-[110] bg-slate-950/30"
    >
      <DialogHeader
        title="Предпросмотр выбранных стыков"
        subtitle={`Будет установлена официальность: ${officialityLabel} · Выбрано: ${rows.length}`}
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
              estimateRowHeight={64}
              getItemKey={(row) => row.id}
              renderItem={(row) => (
                <div className="flex items-start justify-between gap-3 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <ManagerRowJointHeading
                      row={row}
                      titleClassName="text-sm font-semibold text-slate-900"
                      metaClassName="mt-1 text-xs text-slate-500"
                    />
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                      станет: {officialityLabel}
                    </span>
                    <span className={`rounded border px-2 py-1 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                      {getJointStatusLabel(row)}
                    </span>
                  </div>
                </div>
              )}
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
