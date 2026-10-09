import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, FileText, Plus, Stamp } from 'lucide-react'
import { WelderStampCheckParameters } from '@/components/welder-stamp-check-parameters'
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
  onTasksVisibilityChange?: (visible: boolean) => void
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

const REGISTRY_TABS = [
  { id: 'registry', label: 'Клейма', Icon: Stamp },
  { id: 'technologyCards', label: 'Технологические карты', Icon: FileText },
  { id: 'checks', label: 'Параметры проверки', Icon: BookOpen },
] as const

const TechnologyCardsRegistry = lazy(() => import('@/components/technology-cards-registry').then(module => ({ default: module.TechnologyCardsRegistry })))

export function WelderStampsRegistry({ header, taskPanels, onTasksVisibilityChange, ...props }: WelderStampsRegistryProps & { header?: ReactNode; taskPanels?: ReactNode }) {
  const [activeTab, setActiveTab] = useState<typeof REGISTRY_TABS[number]['id']>('registry')
  const [cardsOpened, setCardsOpened] = useState(false)
  useEffect(() => { onTasksVisibilityChange?.(activeTab === 'registry') }, [activeTab, onTasksVisibilityChange])
  useEffect(() => { if (activeTab === 'technologyCards') setCardsOpened(true) }, [activeTab])
  useEffect(() => {
    if ((props.suspensionEditorOpenSignal ?? 0) > 0) setActiveTab('registry')
  }, [props.suspensionEditorOpenSignal])

  return (
    <div className="min-w-0 space-y-4">
      <div role="tablist" aria-label="Разделы клейм" className="sticky top-0 z-40 flex h-14 gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm shadow-slate-100">
        {REGISTRY_TABS.map(({ id, label, Icon }, index) => (
          <button key={id} id={`stamp-tab-${id}`} type="button" role="tab" aria-label={label} aria-selected={activeTab === id}
            aria-controls={`stamp-panel-${id}`} tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % REGISTRY_TABS.length
                : event.key === 'ArrowLeft' ? (index + REGISTRY_TABS.length - 1) % REGISTRY_TABS.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? REGISTRY_TABS.length - 1 : undefined
              if (next === undefined) return
              event.preventDefault()
              setActiveTab(REGISTRY_TABS[next].id)
              document.getElementById(`stamp-tab-${REGISTRY_TABS[next].id}`)?.focus({ preventScroll: true })
            }}
            className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:flex-none sm:gap-2 sm:px-3 sm:text-sm ${activeTab === id ? 'bg-sky-50 text-sky-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
            <Icon aria-hidden="true" className="hidden h-4 w-4 shrink-0 sm:block" /><span className="min-w-0 break-words leading-4">{id === 'technologyCards' ? <><span className="sm:hidden">Техкарты</span><span className="hidden sm:inline">{label}</span></> : label}</span>
          </button>
        ))}
      </div>
      {/* Keep the registry mounted: switching to the reference must not reset
          filters, expanded cards or suspension editor state, or refetch data. */}
      <div id="stamp-panel-registry" role="tabpanel" aria-labelledby="stamp-tab-registry" hidden={activeTab !== 'registry'}>
        <div className="space-y-4">
          {header ?? <h1 className="text-2xl font-semibold text-slate-950">Клейма</h1>}
          {taskPanels}
          <MemoizedWelderStampsRegistryContent {...props} />
        </div>
      </div>
      <div id="stamp-panel-technologyCards" role="tabpanel" aria-labelledby="stamp-tab-technologyCards" hidden={activeTab !== 'technologyCards'}>
        {cardsOpened && <Suspense fallback={<p className="text-sm text-slate-500">Загрузка ТК…</p>}><TechnologyCardsRegistry active={activeTab === 'technologyCards'} /></Suspense>}
      </div>
      <div id="stamp-panel-checks" role="tabpanel" aria-labelledby="stamp-tab-checks" hidden={activeTab !== 'checks'}>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-slate-950">Параметры проверки</h1>
          <WelderStampCheckParameters />
        </div>
      </div>
    </div>
  )
}

const MemoizedWelderStampsRegistryContent = memo(WelderStampsRegistryContent)

function WelderStampsRegistryContent({
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
  const [isEditorSaving, setIsEditorSaving] = useState(false)
  const editorSavingRef = useRef(false)
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
    if (editorSavingRef.current) return
    setIsEditorOpen(false)
    setEditorFocusPermitId(null)
    onReset()
  }

  async function saveAndCloseEditorDialog() {
    if (editorSavingRef.current) return false
    editorSavingRef.current = true
    setIsEditorSaving(true)
    try {
      const saved = await onSave()
      if (saved) setIsEditorOpen(false)
      return saved
    } finally {
      editorSavingRef.current = false
      setIsEditorSaving(false)
    }
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

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7" aria-label="Сводка по состоянию клейм">
        {WELDER_STAMP_STATUS_OPTIONS.map((option) => {
          const active = statusFilter === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatusFilter(option.id)}
              title={option.description}
              aria-pressed={active}
              className={`flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? option.activeClassName
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <span className="min-w-0 break-words text-xs font-semibold leading-4">{option.label}</span>
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
            closeDisabled={isEditorSaving}
          />
          <div className="overflow-y-auto px-5 py-5">
            {isEditorSaving ? <p role="status" className="mb-3 text-sm text-sky-800">Сохраняем клеймо…</p> : null}
            <fieldset disabled={isEditorSaving}>
            <WelderStampsCreatePanel
              draft={draft}
              editingId={editingId}
              initialFocusPermitId={editorFocusPermitId}
              records={allRecords}
              onDraftChange={onDraftChange}
              onSave={saveAndCloseEditorDialog}
              onReset={onReset}
            />
            </fieldset>
          </div>
        </LargeDialogShell>
      ) : null}
    </section>
  )
}
