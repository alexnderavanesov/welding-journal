import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bookmark, Check, ChevronDown, Columns3, Palette, Search, SlidersHorizontal, RotateCcw, Trash2, X } from 'lucide-react'
import { useWeldReportViewState } from '@/lib/use-weld-report-view-state'
import { isModalDialogOpen } from '@/lib/modal-layer'
import type { WeldTableSection } from '@/lib/weld-table-sections'
import type { JournalAppearance } from '@/lib/welding-journal-grid-state'

type Props = {
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
const THEMES = [
  { id: 'quartz', name: 'Светлая', detail: 'Quartz · мягкие границы и голубой акцент' },
  { id: 'alpine', name: 'Классическая', detail: 'Alpine · контрастная шапка и зелёный акцент' },
  { id: 'balham', name: 'Нейтральная', detail: 'Balham · строгие линии и серые оттенки' },
] as const
export function JournalGridToolbar({ summary, sections, extraSections, alwaysVisible, view, openColumnsRequest, appearance, onAppearanceChange, onResetLayout, hasFilters, onClearFilters }: Props) {
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
      {open ? <div role="dialog" aria-label="Настройка вида журнала" className="journal-settings-panel" style={position}>
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
            <JournalDensitySelect value={appearance.density} onChange={density => onAppearanceChange({ ...appearance, density })} />
            {([['wrapText', 'Перенос текста'], ['verticalLines', 'Вертикальная сетка'], ['stripes', 'Чередование строк'], ['taskFill', 'Жёлтая заливка задач и дублей']] as const).map(([key, label]) => <div key={key} className="journal-setting-row"><span id={`journal-setting-${key}`}>{label}</span><button type="button" className="journal-switch" role="switch" aria-labelledby={`journal-setting-${key}`} aria-checked={appearance[key]} onClick={() => onAppearanceChange({ ...appearance, [key]: !appearance[key] })}><span /></button></div>)}
            <button type="button" className="journal-button w-full" onClick={onResetLayout}><RotateCcw size={14} />Сбросить столбцы</button>
          </div> : null}
          {tab === 'themes' ? <div className="journal-theme-list" role="radiogroup" aria-label="Тема таблицы">
            <p className="journal-panel-note">Оформление меняется сразу. Тема сохраняется в вашем браузере и в «Моих видах».</p>
            {THEMES.map(item => <button key={item.id} type="button" role="radio" aria-checked={appearance.theme === item.id} className={`journal-theme-choice journal-theme-preview-${item.id}`} onClick={() => onAppearanceChange({ ...appearance, theme: item.id })}>
              <span className="journal-theme-swatch" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
              <span><strong>{item.name}</strong><small>{item.detail}</small></span>
              <span className="journal-theme-check" aria-hidden="true">{appearance.theme === item.id ? <Check size={15} /> : null}</span>
            </button>)}
          </div> : null}
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

const DENSITIES = [
  { value: 'compact', label: 'Компактно', description: 'Больше строк на экране' },
  { value: 'comfortable', label: 'Комфортно', description: 'Для ежедневной работы' },
  { value: 'spacious', label: 'Просторно', description: 'Больше воздуха между строками' },
] as const
function JournalDensitySelect({ value, onChange }: { value: JournalAppearance['density']; onChange: (value: JournalAppearance['density']) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const select = (index: number) => { onChange(DENSITIES[index].value); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  return <div className="journal-setting-row"><span id="journal-density-label">Плотность строк</span><div ref={root} className="journal-density-select" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); setOpen(true)
      setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? 2 : !open ? DENSITIES.findIndex(item => item.value === value) : (index + (event.key === 'ArrowDown' ? 1 : 2)) % 3)
    } else if (open && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(active) }
    else if (event.key === 'Tab') setOpen(false)
  }}>
    <button ref={trigger} type="button" role="combobox" aria-labelledby="journal-density-label" aria-expanded={open} aria-controls="journal-density-options" aria-activedescendant={open ? `journal-density-${active}` : undefined} className="journal-button" onClick={() => { setActive(DENSITIES.findIndex(item => item.value === value)); setOpen(!open) }}>{DENSITIES.find(item => item.value === value)?.label}<ChevronDown size={14} /></button>
    {open ? <div id="journal-density-options" role="listbox" aria-labelledby="journal-density-label" className="journal-density-options">{DENSITIES.map((item, index) => <button key={item.value} id={`journal-density-${index}`} type="button" role="option" tabIndex={-1} aria-selected={value === item.value} data-active={active === index} onMouseEnter={() => setActive(index)} onClick={() => select(index)}><span><strong>{item.label}</strong><small>{item.description}</small></span>{value === item.value ? <Check size={15} /> : null}</button>)}</div> : null}
  </div></div>
}
