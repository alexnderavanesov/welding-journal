import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bookmark, Check, ChevronDown, Columns3, Filter, Palette, RotateCcw, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { DocumentHistoryColumnDefinition, DocumentHistoryColumnKey } from '@/lib/document-history-columns'
import type { DocumentGridAppearance, DocumentGridView } from '@/lib/document-history-grid-state'
import { isContextActionMenuOpen } from '@/lib/context-action-menu-state'
import { isModalDialogOpen } from '@/lib/modal-layer'
import { GridAppearanceSwitch, GridDensitySelect, GridThemeChoices } from './grid-view-settings-controls'
import './welding-journal-grid.css'

export type DocumentsGridToolbarProps = {
  columns: readonly DocumentHistoryColumnDefinition[]
  visibleColumnKeys: ReadonlySet<string>
  filteredColumnKeys?: ReadonlySet<string>
  onColumnVisibilityChange: (key: DocumentHistoryColumnKey, visible: boolean) => void
  onShowAllColumns: () => void
  appearance: DocumentGridAppearance
  onAppearanceChange: (appearance: DocumentGridAppearance) => void
  onResetColumns: () => void
  savedViews: readonly DocumentGridView[]
  onSaveView: (name: string) => boolean | void
  onApplyView: (id: string) => void
  onDeleteView: (id: string) => void
  search: string
  onSearchChange: (value: string) => void
  groupingControls?: ReactNode
  actions?: ReactNode
  actionsDisabled?: boolean
  hasFilters: boolean
  onClearFilters: () => void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  openColumnsRequest?: number
}

const TABS = [
  { id: 'columns', label: 'Столбцы', icon: Columns3 },
  { id: 'appearance', label: 'Оформление', icon: SlidersHorizontal },
  { id: 'themes', label: 'Темы', icon: Palette },
  { id: 'views', label: 'Мои виды', icon: Bookmark },
] as const

export function DocumentsGridToolbar(props: DocumentsGridToolbarProps) {
  const id = useId(), current = useRef(props); current.current = props
  const [tab, setTab] = useState<typeof TABS[number]['id']>('columns')
  const [columnSearch, setColumnSearch] = useState(''), [viewName, setViewName] = useState(''), [saved, setSaved] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 600 })
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const visibleCount = props.columns.filter(column => column.required || props.visibleColumnKeys.has(column.key)).length
  const matchingColumns = useMemo(() => {
    const query = columnSearch.trim().toLocaleLowerCase('ru')
    return props.columns.filter(column => column.label.toLocaleLowerCase('ru').includes(query))
  }, [props.columns, columnSearch])
  const positionPanel = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const anchorBottom = Math.max(8, Math.min(rect.bottom, window.innerHeight - 24))
    const below = window.innerHeight - anchorBottom - 16, above = rect.top - 16
    const openAbove = below < 340 && above > below
    const maxHeight = Math.min(650, Math.max(160, openAbove ? above : below))
    setPosition({ left: Math.max(16, Math.min(rect.right - 420, window.innerWidth - 436)), top: openAbove ? Math.max(16, rect.top - maxHeight - 8) : anchorBottom + 8, maxHeight })
  }
  const close = () => { current.current.onSettingsOpenChange(false); trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!props.openColumnsRequest) return
    positionPanel(); setTab('columns'); current.current.onSettingsOpenChange(true)
  }, [props.openColumnsRequest])
  useEffect(() => {
    if (!props.settingsOpen) return
    positionPanel()
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) current.current.onSettingsOpenChange(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isModalDialogOpen() || isContextActionMenuOpen()) return
      event.preventDefault(); event.stopPropagation(); close()
    }
    const reposition = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) positionPanel() }
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape)
    }
  }, [props.settingsOpen])
  return <div data-document-grid-toolbar className="document-grid-toolbar">
    {props.hasFilters ? <button type="button" className="journal-button" onClick={props.onClearFilters} title="Сбросить все фильтры, включая поиск"><RotateCcw size={14} />Сбросить</button> : null}
    <div className="document-grid-toolbar-summary">
      <div className="document-grid-toolbar-grouping">{props.groupingControls}</div>
      <label className="journal-search document-grid-registry-search"><Search size={14} /><input className="journal-input" aria-label="Поиск документов" placeholder="Поиск по всему реестру…" value={props.search} onChange={event => props.onSearchChange(event.target.value)} /></label>
    </div>
    <div ref={root} className="document-grid-settings-root">
      <button ref={trigger} type="button" className="journal-button" aria-haspopup="dialog" aria-expanded={props.settingsOpen} onClick={() => { positionPanel(); props.onSettingsOpenChange(!props.settingsOpen) }}><SlidersHorizontal size={15} />Настроить вид<ChevronDown size={12} /></button>
      {props.settingsOpen ? <div ref={panel} role="dialog" aria-label="Настройка вида документов" className="journal-settings-panel document-grid-settings" style={position}>
        <div className="journal-panel-heading"><div><strong>Мой рабочий вид</strong><p>{visibleCount} из {props.columns.length} столбцов · сохраняется в этом браузере</p></div><button type="button" className="journal-icon-button" aria-label="Закрыть настройки вида" onClick={close}><X size={16} /></button></div>
        <div role="tablist" aria-label="Настройки таблицы" className="journal-settings-tabs" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const index = TABS.findIndex(item => item.id === tab)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
          setTab(TABS[next].id)
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>{TABS.map(({ id: key, label, icon: Icon }) => <button key={key} id={`${id}-tab-${key}`} type="button" role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={`${id}-panel-${key}`} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div>
        <div id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="journal-settings-content">
          {tab === 'columns' ? <>
            <div className="journal-settings-tools">
              <div className="journal-search"><Search size={14} /><input className="journal-input" placeholder="Найти столбец…" aria-label="Найти столбец" value={columnSearch} onChange={event => setColumnSearch(event.target.value)} /></div>
              <div className="document-grid-column-tools"><span>Столбцы этого реестра</span><button type="button" className="journal-text-button" onClick={props.onShowAllColumns}>Показать все</button></div>
            </div>
            {matchingColumns.map(column => <label key={column.key} className="journal-column-option"><input type="checkbox" aria-label={column.label} disabled={column.required} checked={Boolean(column.required || props.visibleColumnKeys.has(column.key))} onChange={event => props.onColumnVisibilityChange(column.key, event.target.checked)} /><span>{column.label}</span>{props.filteredColumnKeys?.has(column.key) ? <span className="document-grid-column-filter" aria-label={`Активный фильтр: ${column.label}`} title="Фильтр действует и для скрытого столбца"><Filter size={13} /></span> : null}{column.required ? <span className="document-grid-required-column">всегда виден</span> : null}</label>)}
            {!matchingColumns.length ? <p className="journal-panel-note" role="status">Столбцы не найдены</p> : null}
            <p className="journal-panel-note">Порядок и ширина — перетаскиванием заголовков. Закрепление и подбор ширины — ПКМ по заголовку.</p>
          </> : null}
          {tab === 'appearance' ? <div className="document-grid-appearance-controls">
            <GridDensitySelect label="Плотность строк документов" value={props.appearance.density} onChange={density => props.onAppearanceChange({ ...props.appearance, density })} />
            {([['wrapText', 'Перенос текста'], ['verticalLines', 'Вертикальная сетка'], ['stripes', 'Чередование строк']] as const).map(([key, label]) => <GridAppearanceSwitch key={key} label={label} checked={props.appearance[key]} onChange={checked => props.onAppearanceChange({ ...props.appearance, [key]: checked })} />)}
            <button type="button" className="journal-button document-grid-reset-columns" onClick={props.onResetColumns}><RotateCcw size={14} />Сбросить столбцы</button>
          </div> : null}
          {tab === 'themes' ? <GridThemeChoices label="Тема таблицы документов" value={props.appearance.theme} onChange={theme => props.onAppearanceChange({ ...props.appearance, theme })} /> : null}
          {tab === 'views' ? <>
            <p className="journal-panel-note">Сохраните столбцы, фильтры, поиск, сортировку, группировку и оформление, чтобы возвращаться к привычному виду одним нажатием.</p>
            <form className="document-grid-save-view" onSubmit={event => { event.preventDefault(); const name = viewName.trim(); if (name && props.onSaveView(name) !== false) { setViewName(''); setSaved(true) } }}>
              <input className="journal-input" placeholder="Название вида" aria-label="Название вида документов" value={viewName} onChange={event => { setViewName(event.target.value); setSaved(false) }} /><button type="submit" className="journal-button" disabled={!viewName.trim()}>Сохранить</button>
            </form>
            {saved ? <p role="status" className="document-grid-view-saved"><Check size={14} />Вид сохранён</p> : null}
            {props.savedViews.length ? props.savedViews.map(view => <div key={view.id} className="journal-saved-view"><button type="button" onClick={() => { props.onApplyView(view.id); close() }}><Bookmark size={16} /><span><strong>{view.name}</strong>{' '}<small>Фильтров: {Object.values(view.filters).filter(Boolean).length} · скрыто столбцов: {view.columns.filter(column => column.hide).length}{view.search ? ' · с поиском' : ''}</small></span></button><button type="button" className="journal-icon-button" aria-label={`Удалить вид ${view.name}`} onClick={() => props.onDeleteView(view.id)}><Trash2 size={15} /></button></div>) : <p className="document-grid-empty-views">Сохранённых видов пока нет</p>}
          </> : null}
        </div>
      </div> : null}
    </div>
    {props.actions ? <fieldset className="document-grid-toolbar-actions" disabled={props.actionsDisabled} aria-busy={props.actionsDisabled}>{props.actions}</fieldset> : null}
  </div>
}
