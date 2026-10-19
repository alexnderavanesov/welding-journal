import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bookmark, Check, ChevronDown, Columns3, Palette, Search, SlidersHorizontal, RotateCcw, Trash2, X } from 'lucide-react'
import { useWeldReportViewState } from '@/lib/use-weld-report-view-state'
import { isModalDialogOpen } from '@/lib/modal-layer'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import type { JournalAppearance } from '@/lib/welding-journal-grid-state'
import { GridAppearanceSwitch, GridDensitySelect, GridThemeChoices } from './grid-view-settings-controls'

type Props = {
  settingsLabel: string
  summary?: ReactNode
  sections: WeldTableSection[]
  extraSections: string[]
  alwaysVisible: ReadonlySet<string>
  view: ReturnType<typeof useWeldReportViewState>
  openColumnsRequest: number
  appearance: JournalAppearance
  onAppearanceChange: (appearance: JournalAppearance) => void
  onResetLayout: () => void
  hasFilters: boolean
  onClearFilters: () => void
}
const TABS = [{ id: 'columns', label: 'Столбцы', icon: Columns3 }, { id: 'appearance', label: 'Оформление', icon: SlidersHorizontal }, { id: 'themes', label: 'Темы', icon: Palette }, { id: 'views', label: 'Мои виды', icon: Bookmark }] as const
export function JournalGridToolbar({ settingsLabel, summary, sections, extraSections, alwaysVisible, view, openColumnsRequest, appearance, onAppearanceChange, onResetLayout, hasFilters, onClearFilters }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<typeof TABS[number]['id']>('columns')
  const [search, setSearch] = useState('')
  const [viewName, setViewName] = useState('')
  const [saved, setSaved] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 600 })
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const fields = useMemo(() => sections.flatMap(section => section.fields), [sections])
  const visibleCount = sections.reduce((count, section) => count + section.fields.filter(field => alwaysVisible.has(field.key) || (!view.collapsedSections.has(section.section) && !view.hiddenFieldKeys.has(field.key))).length, 0)
  const positionPanel = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const anchorBottom = Math.max(8, Math.min(rect.bottom, window.innerHeight - 24))
    const below = window.innerHeight - anchorBottom - 16
    const above = rect.top - 16
    const openAbove = below < 340 && above > below
    const maxHeight = Math.min(650, Math.max(160, openAbove ? above : below))
    setPosition({ left: Math.max(16, Math.min(rect.right - 420, window.innerWidth - 436)), top: openAbove ? Math.max(16, rect.top - maxHeight - 8) : anchorBottom + 8, maxHeight })
  }
  useEffect(() => {
    if (!openColumnsRequest) return
    positionPanel(); setTab('columns'); setOpen(true)
  }, [openColumnsRequest])
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isModalDialogOpen()) return
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true })
    }
    const reposition = (event: Event) => { if (!(event.target instanceof Element) || !event.target.closest('.journal-settings-panel')) positionPanel() }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div data-journal-toolbar className="relative z-20 flex items-center gap-2 rounded-t-xl border border-b-0 border-slate-200 bg-white px-3 py-2.5">
    {hasFilters ? <button type="button" className="journal-button" onClick={onClearFilters} title="Сбросить все фильтры, включая поиск и переходы"><RotateCcw size={14} />Сбросить</button> : null}
    <div className="journal-summary">{summary}</div>
    <div ref={root} className="relative shrink-0">
      <button ref={trigger} type="button" className="journal-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => { positionPanel(); setOpen(!open) }}><SlidersHorizontal size={15} />Настроить вид<ChevronDown size={12} /></button>
      {open ? <div role="dialog" aria-label={settingsLabel} className="journal-settings-panel" style={position}>
        <div className="journal-panel-heading"><div><strong>Мой рабочий вид</strong><p>{visibleCount} из {fields.length} столбцов · сохраняется в этом браузере</p></div><button type="button" className="journal-icon-button" aria-label="Закрыть настройки вида" onClick={close}><X size={16} /></button></div>
        <div role="tablist" aria-label="Настройки таблицы" className="journal-settings-tabs">{TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`journal-settings-${id}`} onClick={() => setTab(id)}><Icon size={14} />{label}</button>)}</div>
        <div id={`journal-settings-${tab}`} role="tabpanel" aria-label={TABS.find(item => item.id === tab)?.label} className="journal-settings-content">
          {tab === 'columns' ? <>
            <div className="journal-settings-tools">
              <div className="journal-search"><Search size={14} /><input className="journal-input" placeholder="Найти столбец или раздел…" aria-label="Найти столбец или раздел" value={search} onChange={event => setSearch(event.target.value)} /></div>
              <div className="flex items-center justify-between text-xs text-slate-500"><span>Раздел целиком или отдельные поля</span><button type="button" className="journal-text-button" onClick={() => { view.showAllFields(); for (const section of view.collapsedSections) view.toggleSection(section) }}>Показать все</button></div>
            </div>
            {sections.map(section => {
              const matchesSection = section.section.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))
              const matchingFields = section.fields.filter(field => matchesSection || field.label.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
              if (!matchingFields.length) return null
              const collapsed = view.collapsedSections.has(section.section)
              const required = section.fields.every(field => alwaysVisible.has(field.key))
              return <details key={section.section} className="journal-column-group" open={search ? true : undefined}>
                <summary><label onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Раздел: ${section.section}`} disabled={required} checked={required || !collapsed} onChange={() => view.toggleSection(section.section)} /><span>{section.section}</span></label><span className="journal-count">{section.fields.length}</span><ChevronDown size={14} /></summary>
                {matchingFields.map(field => <label key={field.key} className="journal-column-option"><input type="checkbox" disabled={alwaysVisible.has(field.key)} checked={alwaysVisible.has(field.key) || (!collapsed && !view.hiddenFieldKeys.has(field.key))} onChange={() => { if (collapsed) view.toggleSection(section.section); if (!collapsed || view.hiddenFieldKeys.has(field.key)) view.toggleField(field.key) }} /><span>{field.label}</span>{alwaysVisible.has(field.key) ? <span className="text-[10px] text-slate-400">всегда виден</span> : null}</label>)}
              </details>
            })}
            {extraSections.filter(section => section.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))).map(section => <label key={section} className="journal-column-option"><input type="checkbox" checked={!view.collapsedSections.has(section)} onChange={() => view.toggleSection(section)} /><span>{section}</span></label>)}
            <p className="journal-panel-note">Порядок и ширина — перетаскиванием заголовков. Закрепление и подбор ширины — ПКМ по заголовку.</p>
          </> : null}
          {tab === 'appearance' ? <div className="p-4 space-y-4">
            <GridDensitySelect value={appearance.density} onChange={density => onAppearanceChange({ ...appearance, density })} />
            {([['wrapText', 'Перенос текста'], ['verticalLines', 'Вертикальная сетка'], ['stripes', 'Чередование строк'], ['taskFill', 'Жёлтая заливка задач и дублей']] as const).map(([key, label]) => <GridAppearanceSwitch key={key} label={label} checked={appearance[key]} onChange={checked => onAppearanceChange({ ...appearance, [key]: checked })} />)}
            <button type="button" className="journal-button w-full" onClick={onResetLayout}><RotateCcw size={14} />Сбросить столбцы</button>
          </div> : null}
          {tab === 'themes' ? <GridThemeChoices value={appearance.theme} onChange={theme => onAppearanceChange({ ...appearance, theme })} /> : null}
          {tab === 'views' ? <>
            <p className="journal-panel-note">Сохраните столбцы, фильтры, сортировку и оформление, чтобы возвращаться к привычному виду одним нажатием.</p>
            <form className="flex gap-2 px-4 pb-3" onSubmit={event => { event.preventDefault(); if (view.saveView(viewName)) { setViewName(''); setSaved(true) } }}><input className="journal-input min-w-0 flex-1" placeholder="Название вида" aria-label="Название вида" value={viewName} onChange={event => { setViewName(event.target.value); setSaved(false) }} /><button type="submit" className="journal-button" disabled={!viewName.trim()}>Сохранить</button></form>
            {saved ? <p role="status" className="px-4 pb-3 text-xs text-sky-700 flex gap-1"><Check size={14} />Вид сохранён</p> : null}
            {view.savedViews.length ? view.savedViews.map(item => <div key={item.id} className="journal-saved-view"><button type="button" onClick={() => { view.applySavedView(item); close() }}><Bookmark size={16} /><span><strong>{item.name}</strong><small>Фильтров: {Object.keys(item.snapshot.columnFilters).length} · скрыто столбцов: {item.snapshot.hiddenFieldKeys.length}</small></span></button><button type="button" className="journal-icon-button" aria-label={`Удалить вид ${item.name}`} onClick={() => view.deleteSavedView(item.id)}><Trash2 size={15} /></button></div>) : <p className="p-6 text-center text-sm text-slate-400">Сохранённых видов пока нет</p>}
          </> : null}
        </div>
      </div> : null}
    </div>
  </div>
}
