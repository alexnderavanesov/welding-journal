import { useState, type Dispatch, type SetStateAction } from 'react'
import { Check } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkOfficialitySettings } from '@/components/lnk-officiality-settings'
import { LnkOfficialityRow } from '@/components/lnk-officiality-row'
import { ManagerRowJointHeading } from '@/components/manager-row-joint-heading'
import { Button } from '@/components/ui/button'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointStatusBadgeClass, getJointStatusLabel } from '@/lib/lnk-status'

export type LnkOfficialityDialogProps = {
  draft: LnkOfficialityDraftState
  filteredRows: WeldRow[]
  selectedRows: WeldRow[]
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
  saveBlockReason,
  isSaveDisabled,
  onClose,
  onSave,
  onDraftChange,
  onToggleRow,
  onSetVisibleRowsSelected,
}: LnkOfficialityDialogProps) {
  const [showSelectedPreview, setShowSelectedPreview] = useState(false)

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1180px]"
      maxHeightClassName="h-[86vh]"
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <DialogHeader title="Официальность стыков" subtitle={`Выбрано: ${draft.rowIds.size}`} onClose={onClose} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-hidden px-6 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <LnkOfficialitySettings
          status={draft.status}
          selectedRows={selectedRows}
          onStatusChange={(status) => onDraftChange((current) => ({ ...current, status }))}
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

          <div className="mb-3 flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              value={draft.search}
              onChange={(event) => onDraftChange((current) => ({ ...current, search: event.target.value }))}
              placeholder="Проект, шифр, линия, спул или стык"
              className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            <span className="shrink-0 text-xs text-slate-500">
              Найдено: {filteredRows.length} · Выбрано: {draft.rowIds.size}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
            {filteredRows.length === 0 ? (
              <DialogEmptyState minHeightClassName="min-h-60">
                По фильтру ничего не найдено.
              </DialogEmptyState>
            ) : (
              filteredRows.map((row) => (
                <LnkOfficialityRow key={row.id} row={row} selected={draft.rowIds.has(row.id)} onToggle={onToggleRow} />
              ))
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
            Сохранить статус
          </Button>
        </div>
      </div>
      {showSelectedPreview ? (
        <LnkOfficialityPreviewDialog rows={selectedRows} status={draft.status} onClose={() => setShowSelectedPreview(false)} />
      ) : null}
    </LargeDialogShell>
  )
}

function LnkOfficialityPreviewDialog({
  rows,
  status,
  onClose,
}: {
  rows: WeldRow[]
  status: LnkOfficialityDraftState['status']
  onClose: () => void
}) {
  const statusLabel = status === 'official' ? 'официальный' : 'неофициальный'

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[86vh]"
      overlayClassName="z-[65] bg-slate-950/25"
    >
      <DialogHeader
        title="Предпросмотр выбранных стыков"
        subtitle={`Будет установлен статус: ${statusLabel} · Выбрано: ${rows.length}`}
        onClose={onClose}
        closeLabel="Закрыть предпросмотр"
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {rows.length === 0 ? (
          <DialogEmptyState minHeightClassName="min-h-40">Нет выбранных стыков.</DialogEmptyState>
        ) : (
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {rows.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-3 bg-white px-4 py-3">
                <div className="min-w-0">
                  <ManagerRowJointHeading
                    row={row}
                    titleClassName="text-sm font-semibold text-slate-900"
                    metaClassName="mt-1 text-xs text-slate-500"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                    станет: {statusLabel}
                  </span>
                  <span className={`rounded border px-2 py-1 text-xs font-semibold ${getJointStatusBadgeClass(row)}`}>
                    {getJointStatusLabel(row)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <DialogCloseFooter onClose={onClose} />
    </LargeDialogShell>
  )
}
