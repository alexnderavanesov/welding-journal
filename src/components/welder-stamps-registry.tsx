import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { WelderStampsArchivePanel } from '@/components/welder-stamps-archive-panel'
import { WelderStampsCreatePanel } from '@/components/welder-stamps-create-panel'
import { WelderStampsFiltersPanel } from '@/components/welder-stamps-filters-panel'
import { WelderStampsRecordsTable } from '@/components/welder-stamps-records-table'
import { WelderStampSuspensionsPanel } from '@/components/welder-stamp-suspensions-panel'
import { hasWelderStampRangeFilters } from '@/lib/welder-stamp-filters'
import type { WelderStampFilters, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type WelderStampsRegistryProps = {
  records: WelderStampRecord[]
  archivedRecords: WelderStampRecord[]
  allRecords: WelderStampRecord[]
  suspensionRecords: WelderStampSuspensionRecord[]
  draft: WelderStampRecord
  suspensionDraft: WelderStampSuspensionRecord
  suspensionEditorOpenSignal?: number
  search: string
  filters: WelderStampFilters
  editingId: number | null
  showArchived: boolean
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSuspensionDraftChange: (field: keyof WelderStampSuspensionRecord, value: string) => void
  onSave: () => boolean
  onSaveSuspension: () => boolean
  onReset: () => void
  onResetSuspension: () => void
  onEdit: (record: WelderStampRecord) => void
  onEditSuspension: (record: WelderStampSuspensionRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onToggleArchived: (value: boolean) => void
  onDelete: (id: number) => void
  onDeleteSuspension: (id: number) => void
}

export function WelderStampsRegistry({
  records,
  archivedRecords,
  allRecords,
  suspensionRecords,
  draft,
  suspensionDraft,
  suspensionEditorOpenSignal = 0,
  search,
  filters,
  editingId,
  showArchived,
  onSearchChange,
  onFiltersChange,
  onDraftChange,
  onSuspensionDraftChange,
  onSave,
  onSaveSuspension,
  onReset,
  onResetSuspension,
  onEdit,
  onEditSuspension,
  onArchive,
  onRestore,
  onToggleArchived,
  onDelete,
  onDeleteSuspension,
}: WelderStampsRegistryProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const hasRangeFilters = hasWelderStampRangeFilters(filters)
  const hasSearchOrRangeFilters = Boolean(search.trim()) || hasRangeFilters
  const suspensionStampOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allRecords
            .map((record) => String(record.naksStamp ?? '').trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right, 'ru')),
    [allRecords],
  )

  useEffect(() => {
    if (!isEditorOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeEditorDialog()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isEditorOpen])

  function openCreateDialog() {
    onReset()
    setIsEditorOpen(true)
  }

  function openEditDialog(record: WelderStampRecord) {
    onEdit(record)
    setIsEditorOpen(true)
  }

  function closeEditorDialog() {
    setIsEditorOpen(false)
    onReset()
  }

  function saveAndCloseEditorDialog() {
    const saved = onSave()
    if (saved) setIsEditorOpen(false)
    return saved
  }

  return (
    <section className="w-full min-w-0 max-w-full space-y-4 overflow-hidden rounded-md border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Справочник клейм сварщиков</h2>
          <p className="mt-1 text-sm text-slate-500">
            Здесь хранятся клейма НАКС, внутренние клейма и допуски по типу сварки, диаметрам и сроку действия.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить клеймо
        </Button>
      </div>

      <WelderStampsFiltersPanel search={search} filters={filters} onSearchChange={onSearchChange} onFiltersChange={onFiltersChange} />

      <div className="overflow-hidden rounded-md border border-slate-200">
        <WelderStampsRecordsTable
          records={records}
          emptyMessage={hasSearchOrRangeFilters ? 'По фильтрам клейма не найдены.' : 'Пока нет добавленных клейм.'}
          editingId={editingId}
          onEdit={openEditDialog}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </div>

      <div className="space-y-4 border-t border-slate-200 pt-4">
        <WelderStampSuspensionsPanel
          records={suspensionRecords}
          stampOptions={suspensionStampOptions}
          draft={suspensionDraft}
          openEditorSignal={suspensionEditorOpenSignal}
          onDraftChange={onSuspensionDraftChange}
          onSave={onSaveSuspension}
          onReset={onResetSuspension}
          onEdit={onEditSuspension}
          onDelete={onDeleteSuspension}
        />

        <WelderStampsArchivePanel
          archivedRecords={archivedRecords}
          showArchived={showArchived}
          hasSearchOrRangeFilters={hasSearchOrRangeFilters}
          onRestore={onRestore}
          onToggleArchived={onToggleArchived}
          onDelete={onDelete}
        />
      </div>

      {isEditorOpen ? (
        <LargeDialogShell maxWidthClassName="max-w-[1080px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[80] bg-slate-950/30">
          <DialogHeader
            title={editingId === null ? 'Добавление клейма' : 'Редактирование клейма'}
            subtitle="Клеймо НАКС, внутреннее клеймо и допуски по типу сварки, диаметрам и сроку действия."
            onClose={closeEditorDialog}
          />
          <div className="overflow-y-auto px-5 py-5">
            <WelderStampsCreatePanel
              draft={draft}
              editingId={editingId}
              records={allRecords}
              onDraftChange={onDraftChange}
              onSave={saveAndCloseEditorDialog}
              onReset={onReset}
            />
          </div>
        </LargeDialogShell>
      ) : null}
    </section>
  )
}
