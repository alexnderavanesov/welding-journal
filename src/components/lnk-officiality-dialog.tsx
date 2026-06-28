import type { Dispatch, SetStateAction } from 'react'
import { Check } from 'lucide-react'

import { DialogEmptyState } from '@/components/dialog-empty-state'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkOfficialitySettings } from '@/components/lnk-officiality-settings'
import { LnkOfficialityRow } from '@/components/lnk-officiality-row'
import { Button } from '@/components/ui/button'
import type { LnkOfficialityDraftState } from '@/lib/report-draft-state'
import type { WeldRow } from '@/lib/dispatcher-types'

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
          <Button onClick={onSave} disabled={isSaveDisabled}>
            <Check className="mr-2 h-4 w-4" />
            Сохранить статус
          </Button>
        </div>
      </div>
    </LargeDialogShell>
  )
}
