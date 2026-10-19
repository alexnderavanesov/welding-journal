import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GridApi } from 'ag-grid-community'
import { Check, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { useProgramAppearance } from './line-program-appearance'
import { DEFAULT_PROGRAM_APPEARANCE } from '@/lib/line-program-appearance'

type ColumnChoice = { id: string; label: string; visible: boolean; locked: boolean }
const TABS = [{ id: 'columns', label: 'Столбцы' }, { id: 'appearance', label: 'Оформление' }, { id: 'themes', label: 'Темы' }] as const
const DENSITIES = [{ id: 'compact', label: 'Компактно' }, { id: 'comfortable', label: 'Обычно' }, { id: 'spacious', label: 'Свободно' }] as const
const THEMES = [{ id: 'quartz', label: 'Quartz', description: 'Мягкий голубой' }, { id: 'alpine', label: 'Alpine', description: 'Чёткие заголовки' }, { id: 'balham', label: 'Balham', description: 'Нейтральный светлый' }] as const

export function ProgramViewSettings({ api }: { api: GridApi | null }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<typeof TABS[number]['id']>('columns')
  const [search, setSearch] = useState('')
  const [columns, setColumns] = useState<ColumnChoice[]>([])
  const { appearance, setAppearance } = useProgramAppearance()
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open || !api || api.isDestroyed()) return
    const refresh = () => {
      if (api.isDestroyed()) return
      setColumns((api.getColumns() ?? []).filter(column => !column.getColId().startsWith('ag-')).map(column => ({ id: column.getColId(), label: column.getColDef().headerName ?? column.getColId(), visible: column.isVisible(), locked: !!column.getColDef().lockVisible })))
    }
    refresh()
    api.addEventListener('columnVisible', refresh); api.addEventListener('columnMoved', refresh); api.addEventListener('newColumnsLoaded', refresh)
    return () => { if (!api.isDestroyed()) { api.removeEventListener('columnVisible', refresh); api.removeEventListener('columnMoved', refresh); api.removeEventListener('newColumnsLoaded', refresh) } }
  }, [api, open])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current || !panel.current) return
      const anchor = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect()
      const left = Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12))
      const top = Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - box.height - 12))
      Object.assign(panel.current.style, { left: `${left}px`, top: `${top}px` })
    }
    place()
    panel.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
    const observer = new ResizeObserver(place)
    if (panel.current) observer.observe(panel.current)
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('pointerdown', outside, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside, true) }
  }, [open])
  const found = columns.filter(column => column.label.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
  const usable = api && !api.isDestroyed()
  const visibility = (ids: string[], visible: boolean) => {
    if (!usable) return
    // AG dispatches columnVisible asynchronously; update the controlled
    // checkboxes in the same click before the native event confirms the state.
    setColumns(current => current.map(column => ids.includes(column.id) && !column.locked ? { ...column, visible } : column))
    api.setColumnsVisible(ids, visible)
  }
  return <>
    <button ref={trigger} type="button" className="program-view-trigger" title="Настроить вид программы линий" aria-label="Настроить вид программы линий" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(value => !value); setSearch('') }}><Settings2 size={17} aria-hidden="true" /></button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Вид программы линий" className="program-view-panel" onContextMenu={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
      if (event.key === 'Tab' && panel.current) {
        const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled)'))
        if ((event.shiftKey && event.target === controls[0]) || (!event.shiftKey && event.target === controls.at(-1))) { event.preventDefault(); close(true) }
      }
    }}>
      <div className="program-view-title"><strong>Вид программы линий</strong><button type="button" aria-label="Закрыть настройки вида" onClick={() => close(true)}><X size={16} /></button></div>
      <div className="program-view-tabs" role="tablist" aria-label="Настройки вида">{TABS.map((item, index) => <button type="button" key={item.id} id={`${id}-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`${id}-content`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
        if (next >= 0) { event.preventDefault(); setTab(TABS[next].id); panel.current?.querySelector<HTMLButtonElement>(`[id="${id}-${TABS[next].id}"]`)?.focus() }
      }}>{item.label}</button>)}</div>
      <div role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} className="program-view-content">
        {tab === 'columns' ? <>
          <label className="program-view-search"><Search size={15} aria-hidden="true" /><input aria-label="Найти столбец списка линий" placeholder="Найти столбец…" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Очистить поиск столбцов" onClick={() => setSearch('')}><X size={14} /></button> : null}</label>
          <div className="program-view-list-heading"><span>Список линий · {columns.filter(column => column.visible).length} из {columns.length}</span><button type="button" disabled={!usable} onClick={() => visibility(columns.filter(column => !column.locked).map(column => column.id), true)}>Показать все</button></div>
          <div className="program-view-columns">{found.map(column => <label key={column.id} className="program-view-column"><input type="checkbox" checked={column.visible} disabled={column.locked || !usable} onChange={event => visibility([column.id], event.target.checked)} /><span>{column.label}</span>{column.locked ? <small>Всегда</small> : null}</label>)}{!found.length ? <p className="program-view-empty">Столбцы не найдены</p> : null}</div>
          <p className="program-view-note">Перетаскивайте заголовки, чтобы изменить порядок. Столбцы клейм, стыков и назначений — через ПКМ по их заголовку.</p>
          <button type="button" className="program-view-reset" disabled={!usable} onClick={() => usable && api.resetColumnState()}><RotateCcw size={13} />Сбросить столбцы</button>
        </> : tab === 'appearance' ? <>
          <div className="program-view-label">Плотность таблиц</div><div className="program-view-density" role="group" aria-label="Плотность таблиц">{DENSITIES.map(item => <button type="button" key={item.id} aria-pressed={appearance.density === item.id} onClick={() => setAppearance(current => ({ ...current, density: item.id }))}>{item.label}</button>)}</div>
          <label className="program-view-switch"><span>Вертикальные границы</span><input type="checkbox" role="switch" checked={appearance.verticalBorders} onChange={event => setAppearance(current => ({ ...current, verticalBorders: event.target.checked }))} /></label>
          <p className="program-view-note">Применяется к линиям, клеймам, стыкам и назначениям. Текст переносится по ширине столбца.</p>
          <button type="button" className="program-view-reset" onClick={() => setAppearance(DEFAULT_PROGRAM_APPEARANCE)}><RotateCcw size={13} />Вернуть исходное оформление</button>
        </> : <div className="program-view-themes">{THEMES.map(item => <button type="button" key={item.id} className="program-view-theme" data-theme={item.id} aria-pressed={appearance.theme === item.id} onClick={() => setAppearance(current => ({ ...current, theme: item.id }))}><span className="program-view-preview" aria-hidden="true"><i /><i /><i /></span><span><strong>{item.label}</strong><small>{item.description}</small></span>{appearance.theme === item.id ? <Check size={16} /> : null}</button>)}<p className="program-view-note">Тема и плотность сохраняются в этом браузере. Цвета результатов контроля сохраняют своё значение.</p></div>}
      </div>
    </div>, document.body)}
  </>
}
