import { Check, ChevronDown, Columns3, LayoutTemplate, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { WeldFieldKey } from '@/lib/weld-fields'
import {
  WELD_REPORT_COLUMN_PRESETS,
  type SavedWeldReportView,
  type WeldReportColumnPreset,
} from '@/lib/weld-report-view'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import type { WeldSort } from '@/server/weld-contracts'

type Panel = 'presets' | 'columns' | 'views'

type WeldReportViewControlsProps = {
  sections: readonly WeldTableSection[]
  alwaysVisibleFieldKeys: ReadonlySet<string>
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  activePreset: WeldReportColumnPreset
  savedViews: readonly SavedWeldReportView[]
  sort: WeldSort | null
  onApplyPreset: (preset: WeldReportColumnPreset) => void
  onToggleField: (fieldKey: WeldFieldKey) => void
  onShowAllFields: () => void
  onSortChange: (sort: WeldSort | null) => void
  onSaveView: (name: string) => boolean
  onApplySavedView: (view: SavedWeldReportView) => void
  onDeleteSavedView: (id: string) => void
}

export function WeldReportViewControls({
  sections,
  alwaysVisibleFieldKeys,
  hiddenFieldKeys,
  activePreset,
  savedViews,
  sort,
  onApplyPreset,
  onToggleField,
  onShowAllFields,
  onSortChange,
  onSaveView,
  onApplySavedView,
  onDeleteSavedView,
}: WeldReportViewControlsProps) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [panelPosition, setPanelPosition] = useState({ left: 0, top: 0, maxHeight: 620 })
  const [viewName, setViewName] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const isPointerInsidePanelRef = useRef(false)
  const fields = useMemo(() => sections.flatMap((section) => section.fields), [sections])
  const sortableFields = useMemo(() => fields.filter((field) => !('virtual' in field && field.virtual)), [fields])
  const visibleCount = fields.filter((field) => !hiddenFieldKeys.has(field.key)).length

  useEffect(() => {
    if (!panel) return undefined
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setPanel(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    const closeOnScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      if (isPointerInsidePanelRef.current) return
      setPanel(null)
    }
    const closeOnResize = () => setPanel(null)
    document.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      isPointerInsidePanelRef.current = false
      document.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [panel])

  const togglePanel = (nextPanel: Panel, element: HTMLElement) => {
    if (panel === nextPanel) {
      setPanel(null)
      return
    }
    const rect = element.getBoundingClientRect()
    const width = nextPanel === 'columns' ? 390 : 360
    const preferredHeight = nextPanel === 'columns' ? 680 : 620
    const availableBelow = Math.max(0, window.innerHeight - rect.bottom - 12)
    const availableAbove = Math.max(0, rect.top - 12)
    const openAbove = availableBelow < Math.min(320, preferredHeight) && availableAbove > availableBelow
    const maxHeight = Math.max(140, Math.min(preferredHeight, openAbove ? availableAbove - 6 : availableBelow))
    setPanelPosition({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: openAbove
        ? Math.max(12, rect.top - maxHeight - 6)
        : Math.min(rect.bottom + 6, window.innerHeight - 152),
      maxHeight,
    })
    setPanel(nextPanel)
  }

  const saveCurrentView = () => {
    if (!onSaveView(viewName)) return
    setViewName('')
  }

  return (
    <div
      ref={rootRef}
      data-report-view-controls
      className="relative sticky right-0 ml-auto flex shrink-0 items-center gap-1.5 bg-slate-50 pl-2 pr-8 before:pointer-events-none before:absolute before:-bottom-1.5 before:right-full before:-top-1.5 before:w-8 before:border-r before:border-slate-200 before:bg-gradient-to-r before:from-transparent before:to-slate-50 before:content-['']"
    >
      <ViewButton
        active={panel === 'presets'}
        label="Наборы"
        icon={LayoutTemplate}
        onClick={(element) => togglePanel('presets', element)}
      />
      <ViewButton
        active={panel === 'columns'}
        label="Столбцы"
        count={`${visibleCount}/${fields.length}`}
        icon={Columns3}
        onClick={(element) => togglePanel('columns', element)}
      />
      <ViewButton
        active={panel === 'views'}
        label="Виды"
        count={savedViews.length ? String(savedViews.length) : undefined}
        icon={Save}
        onClick={(element) => togglePanel('views', element)}
      />

      {panel && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={getPanelLabel(panel)}
              onPointerEnter={() => {
                isPointerInsidePanelRef.current = true
              }}
              onPointerLeave={() => {
                isPointerInsidePanelRef.current = false
              }}
              onWheelCapture={() => {
                isPointerInsidePanelRef.current = true
              }}
              className="fixed z-[90] w-[min(390px,calc(100vw-24px))] overflow-x-hidden overflow-y-auto rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-900/20"
              style={{ left: panelPosition.left, top: panelPosition.top, maxHeight: panelPosition.maxHeight }}
            >
              {panel === 'presets' ? (
                <PresetsPanel
                  activePreset={activePreset}
                  sort={sort}
                  sortableFields={sortableFields}
                  onApplyPreset={(preset) => {
                    onApplyPreset(preset)
                    setPanel(null)
                  }}
                  onSortChange={onSortChange}
                />
              ) : null}
              {panel === 'columns' ? (
                <ColumnsPanel
                  sections={sections}
                  hiddenFieldKeys={hiddenFieldKeys}
                  alwaysVisibleFieldKeys={alwaysVisibleFieldKeys}
                  onToggleField={onToggleField}
                  onShowAllFields={onShowAllFields}
                />
              ) : null}
              {panel === 'views' ? (
                <SavedViewsPanel
                  viewName={viewName}
                  savedViews={savedViews}
                  onViewNameChange={setViewName}
                  onSave={saveCurrentView}
                  onApply={(view) => {
                    onApplySavedView(view)
                    setPanel(null)
                  }}
                  onDelete={onDeleteSavedView}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function ViewButton({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean
  label: string
  count?: string
  icon: typeof Columns3
  onClick: (element: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={(event) => onClick(event.currentTarget)}
      className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-sky-300 bg-sky-100 text-sky-900'
          : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {count ? <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] tabular-nums text-slate-600">{count}</span> : null}
      <ChevronDown className="h-3 w-3" />
    </button>
  )
}

function PresetsPanel({
  activePreset,
  sort,
  sortableFields,
  onApplyPreset,
  onSortChange,
}: {
  activePreset: WeldReportColumnPreset
  sort: WeldSort | null
  sortableFields: WeldTableSection['fields']
  onApplyPreset: (preset: WeldReportColumnPreset) => void
  onSortChange: (sort: WeldSort | null) => void
}) {
  return (
    <div className="min-h-0">
      <PanelHeader icon={LayoutTemplate} title="Наборы столбцов" />
      <div className="space-y-1 p-2">
        {WELD_REPORT_COLUMN_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onApplyPreset(preset.id)}
            className={`flex w-full items-start gap-2.5 rounded px-3 py-2 text-left transition-colors ${
              activePreset === preset.id ? 'bg-sky-50 text-sky-950' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
              activePreset === preset.id ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300'
            }`}>
              {activePreset === preset.id ? <Check className="h-3 w-3" /> : null}
            </span>
            <span>
              <span className="block text-sm font-semibold">{preset.label}</span>
              <span className="mt-0.5 block text-xs leading-4 text-slate-500">{preset.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-slate-100 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Сортировка
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
          <select
            value={sort?.fieldKey ?? ''}
            onChange={(event) => {
              const fieldKey = event.target.value as WeldFieldKey
              onSortChange(fieldKey ? { fieldKey, direction: sort?.direction ?? 'asc' } : null)
            }}
            className="h-9 min-w-0 rounded border border-slate-200 bg-white px-2 text-sm text-slate-700"
          >
            <option value="">По умолчанию</option>
            {sortableFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
          <select
            value={sort?.direction ?? 'asc'}
            disabled={!sort}
            onChange={(event) => sort && onSortChange({ ...sort, direction: event.target.value as WeldSort['direction'] })}
            className="h-9 rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="asc">По возр.</option>
            <option value="desc">По убыв.</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function ColumnsPanel({
  sections,
  hiddenFieldKeys,
  alwaysVisibleFieldKeys,
  onToggleField,
  onShowAllFields,
}: {
  sections: readonly WeldTableSection[]
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  alwaysVisibleFieldKeys: ReadonlySet<string>
  onToggleField: (fieldKey: WeldFieldKey) => void
  onShowAllFields: () => void
}) {
  return (
    <div className="min-h-0">
      <PanelHeader icon={Columns3} title="Столбцы отчета" actionLabel="Показать все" onAction={onShowAllFields} />
      {sections.map((section) => (
        <section key={section.section} className="border-b border-slate-100 py-1 last:border-b-0">
          <h3 className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-400">{section.section}</h3>
          {section.fields.map((field) => {
            const required = alwaysVisibleFieldKeys.has(field.key)
            const checked = required || !hiddenFieldKeys.has(field.key)
            return (
              <button
                key={field.key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={required}
                onClick={() => onToggleField(field.key)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-50/50"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                }`}>
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">{field.label}</span>
                {required ? <span className="text-[10px] text-slate-400">обязательный</span> : null}
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function SavedViewsPanel({
  viewName,
  savedViews,
  onViewNameChange,
  onSave,
  onApply,
  onDelete,
}: {
  viewName: string
  savedViews: readonly SavedWeldReportView[]
  onViewNameChange: (name: string) => void
  onSave: () => void
  onApply: (view: SavedWeldReportView) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="min-h-0">
      <PanelHeader icon={Save} title="Сохраненные виды" />
      <div className="flex gap-2 border-b border-slate-100 p-3">
        <input
          value={viewName}
          onChange={(event) => onViewNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave()
          }}
          placeholder="Название вида"
          className="h-9 min-w-0 flex-1 rounded border border-slate-200 px-3 text-sm outline-none focus:border-sky-400"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!viewName.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          <Save className="h-3.5 w-3.5" />
          Сохранить
        </button>
      </div>
      {savedViews.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">Сохраненных видов пока нет.</p>
      ) : (
        <div className="p-2">
          {savedViews.map((view) => (
            <div key={view.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
              <button type="button" onClick={() => onApply(view)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold text-slate-800">{view.name}</span>
                <span className="block text-xs text-slate-500">
                  Фильтров: {Object.keys(view.snapshot.columnFilters).length} · скрыто: {view.snapshot.hiddenFieldKeys.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(view.id)}
                aria-label={`Удалить вид ${view.name}`}
                className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PanelHeader({
  icon: Icon,
  title,
  actionLabel,
  onAction,
}: {
  icon: typeof Columns3
  title: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Icon className="h-4 w-4 text-sky-700" />
        {title}
      </span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="text-xs font-semibold text-sky-700 hover:text-sky-900">
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function getPanelLabel(panel: Panel) {
  if (panel === 'columns') return 'Настройка столбцов отчета'
  if (panel === 'views') return 'Сохраненные представления отчета'
  return 'Наборы столбцов и сортировка'
}
