import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { WelderStampsCreatePanel } from '@/components/welder-stamps-create-panel'
import { WelderStampsFiltersPanel } from '@/components/welder-stamps-filters-panel'
import { WelderStampsRecordsTable } from '@/components/welder-stamps-records-table'
import { WelderStampSuspensionsPanel } from '@/components/welder-stamp-suspensions-panel'
import { hasWelderStampRangeFilters } from '@/lib/welder-stamp-filters'
import {
  buildWelderStampRegistrySummary,
  matchesWelderStampRegistryStatus,
  type WelderStampRegistryStatus,
} from '@/lib/welder-stamp-registry-summary'
import type { WelderStampFilters, WelderStampRecord, WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

export type WelderStampsRegistryProps = {
  records: WelderStampRecord[]
  allRecords: WelderStampRecord[]
  suspensionRecords: WelderStampSuspensionRecord[]
  draft: WelderStampRecord
  suspensionDraft: WelderStampSuspensionRecord
  suspensionEditorOpenSignal?: number
  search: string
  filters: WelderStampFilters
  editingId: number | null
  onSearchChange: (value: string) => void
  onFiltersChange: (value: WelderStampFilters) => void
  onDraftChange: <K extends keyof WelderStampRecord>(field: K, value: WelderStampRecord[K]) => void
  onSuspensionDraftChange: (field: keyof WelderStampSuspensionRecord, value: string) => void
  onSave: () => boolean | Promise<boolean | undefined>
  onSaveSuspension: () => boolean | Promise<boolean | undefined>
  onReset: () => void
  onResetSuspension: () => void
  onEdit: (record: WelderStampRecord) => void
  onEditSuspension: (record: WelderStampSuspensionRecord) => void
  onArchive: (id: number) => void
  onRestore: (id: number) => void
  onArchivePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onRestorePermit: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onDelete: (id: number) => void
  onDeleteSuspension: (id: number) => void
}

const WELDER_STAMP_STATUS_OPTIONS: Array<{
  id: WelderStampRegistryStatus
  label: string
  description: string
  activeClassName: string
}> = [
  { id: 'all', label: 'Все клейма', description: 'Все записи справочника без дополнительного ограничения по состоянию.', activeClassName: 'border-sky-300 bg-sky-50 text-sky-900' },
  { id: 'active', label: 'Действующие', description: 'Активные заполненные клейма без приостановки; до окончания допуска больше 30 дней.', activeClassName: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { id: 'soon', label: 'Скоро истекают', description: 'До ближайшего действующего допуска НАКС осталось не более 30 дней.', activeClassName: 'border-amber-300 bg-amber-50 text-amber-900' },
  { id: 'expired', label: 'Истекли', description: 'Ближайший допуск НАКС уже истек.', activeClassName: 'border-rose-300 bg-rose-50 text-rose-900' },
  { id: 'archived', label: 'В архиве', description: 'Клейма, перенесенные в архив.', activeClassName: 'border-slate-400 bg-slate-100 text-slate-900' },
  { id: 'suspended', label: 'Приостановлены', description: 'Клейма с действующим периодом приостановки на текущую дату.', activeClassName: 'border-orange-300 bg-orange-50 text-orange-900' },
  { id: 'incomplete', label: 'Нужно заполнить', description: 'Активные записи, которые не проходят текущую проверку заполнения справочника.', activeClassName: 'border-violet-300 bg-violet-50 text-violet-900' },
]

export function WelderStampsRegistry({
  records,
  allRecords,
  suspensionRecords,
  draft,
  suspensionDraft,
  suspensionEditorOpenSignal = 0,
  search,
  filters,
  editingId,
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
  onArchivePermit,
  onRestorePermit,
  onDelete,
  onDeleteSuspension,
}: WelderStampsRegistryProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<WelderStampRegistryStatus>('all')
  const [editorFocusPermitId, setEditorFocusPermitId] = useState<string | null>(null)
  const hasRangeFilters = hasWelderStampRangeFilters(filters)
  const hasSearchOrRangeFilters = Boolean(search.trim()) || hasRangeFilters
  const registrySummary = useMemo(
    () => buildWelderStampRegistrySummary(records, { suspensions: suspensionRecords }),
    [records, suspensionRecords],
  )
  const visibleRecords = useMemo(
    () => records.filter((record) => matchesWelderStampRegistryStatus(record, statusFilter, { suspensions: suspensionRecords })),
    [records, statusFilter, suspensionRecords],
  )
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

  useEffect(() => {
    if (selectedRecordId !== null && !visibleRecords.some((record) => record.id === selectedRecordId)) setSelectedRecordId(null)
  }, [selectedRecordId, visibleRecords])

  function openCreateDialog() {
    onReset()
    setEditorFocusPermitId(null)
    setIsEditorOpen(true)
  }

  function openEditDialog(record: WelderStampRecord, focusPermitId?: string) {
    onEdit(record)
    setEditorFocusPermitId(focusPermitId ?? null)
    setIsEditorOpen(true)
  }

  function closeEditorDialog() {
    setIsEditorOpen(false)
    setEditorFocusPermitId(null)
    onReset()
  }

  async function saveAndCloseEditorDialog() {
    const saved = await onSave()
    if (saved) setIsEditorOpen(false)
    return saved
  }

  function archiveRecord(id: number) {
    onArchive(id)
  }

  function deleteRecord(id: number) {
    onDelete(id)
    if (selectedRecordId === id) setSelectedRecordId(null)
  }

  return (
    <section className="w-full min-w-0 max-w-full space-y-4 overflow-hidden rounded-md border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Справочник клейм сварщиков</h2>
          <p className="mt-1 text-sm text-slate-500">
            Здесь хранятся клейма НАКС, внутренние клейма и допуски по способу сварки, группе материалов, диаметрам и сроку действия.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить клеймо
        </Button>
      </div>

      <WelderStampsFiltersPanel search={search} filters={filters} onSearchChange={onSearchChange} onFiltersChange={onFiltersChange} />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7" aria-label="Сводка по состоянию клейм">
        {WELDER_STAMP_STATUS_OPTIONS.map((option) => {
          const active = statusFilter === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatusFilter(option.id)}
              title={option.description}
              aria-pressed={active}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? option.activeClassName
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <span className="text-xs font-semibold leading-4">{option.label}</span>
              <span className="text-lg font-semibold tabular-nums">{registrySummary[option.id]}</span>
            </button>
          )
        })}
      </div>

      <div className="min-w-0 overflow-hidden rounded-md border border-slate-200">
        <WelderStampsRecordsTable
          records={visibleRecords}
          emptyMessage={hasSearchOrRangeFilters || statusFilter !== 'all' ? 'По выбранным фильтрам клейма не найдены.' : 'Пока нет добавленных клейм.'}
          editingId={editingId}
          selectedId={selectedRecordId}
          onSelect={(record) => setSelectedRecordId((current) => (current === record.id ? null : record.id))}
          onEdit={openEditDialog}
          onArchive={archiveRecord}
          onRestore={onRestore}
          onArchivePermit={onArchivePermit}
          onRestorePermit={onRestorePermit}
          onDelete={deleteRecord}
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
      </div>

      {isEditorOpen ? (
        <LargeDialogShell maxWidthClassName="max-w-[1080px]" maxHeightClassName="max-h-[90vh]" overlayClassName="z-[80] bg-slate-950/30">
          <DialogHeader
            title={editingId === null ? 'Добавление клейма' : 'Редактирование клейма'}
            subtitle="Клеймо НАКС, внутреннее клеймо и допуски по способу сварки, группе материалов, диаметрам и сроку действия."
            onClose={closeEditorDialog}
          />
          <div className="overflow-y-auto px-5 py-5">
            <WelderStampsCreatePanel
              draft={draft}
              editingId={editingId}
              initialFocusPermitId={editorFocusPermitId}
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
