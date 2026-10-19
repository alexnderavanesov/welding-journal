import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GridApi } from 'ag-grid-community'
import { ChevronDown, Columns3, Palette, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { useProgramAppearance } from './line-program-appearance'
import { DEFAULT_PROGRAM_APPEARANCE } from '@/lib/line-program-appearance'
import { GridAppearanceSwitch, GridDensitySelect, GridThemeChoices } from './grid-view-settings-controls'
import './welding-journal-grid.css'
import './welding-journal-ui.css'

type ColumnChoice = { id: string; label: string; visible: boolean; locked: boolean }
const TABS = [{ id: 'columns', label: 'Столбцы', icon: Columns3 }, { id: 'appearance', label: 'Оформление', icon: SlidersHorizontal }, { id: 'themes', label: 'Темы', icon: Palette }] as const

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
    <button ref={trigger} type="button" className="journal-button program-view-trigger" title="Настроить вид программы линий" aria-label="Настроить вид программы линий" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(value => !value); setSearch('') }}><SlidersHorizontal size={15} aria-hidden="true" /><span className="hidden lg:inline">Настроить вид</span><ChevronDown className="hidden lg:block" size={12} /></button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Вид программы линий" className="journal-settings-panel program-view-panel" onContextMenu={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(true) }
      if (event.key === 'Tab' && panel.current) {
        const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled)'))
        if ((event.shiftKey && event.target === controls[0]) || (!event.shiftKey && event.target === controls.at(-1))) { event.preventDefault(); close(true) }
      }
    }}>
      <div className="journal-panel-heading"><div><strong>Мой рабочий вид</strong><p>{columns.filter(column => column.visible).length} из {columns.length} столбцов · сохраняется в этом браузере</p></div><button type="button" className="journal-icon-button" aria-label="Закрыть настройки вида" onClick={() => close(true)}><X size={16} /></button></div>
      <div className="journal-settings-tabs" role="tablist" aria-label="Настройки вида">{TABS.map((item, index) => <button type="button" key={item.id} id={`${id}-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`${id}-content`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
        if (next >= 0) { event.preventDefault(); setTab(TABS[next].id); panel.current?.querySelector<HTMLButtonElement>(`[id="${id}-${TABS[next].id}"]`)?.focus() }
      }}><item.icon size={14} />{item.label}</button>)}</div>
      <div role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} className="journal-settings-content">
        {tab === 'columns' ? <>
          <div className="journal-settings-tools">
            <label className="journal-search"><Search size={14} aria-hidden="true" /><input className="journal-input" aria-label="Найти столбец списка линий" placeholder="Найти столбец…" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <div className="flex items-center justify-between text-xs text-slate-500"><span>Список линий</span><button type="button" className="journal-text-button" disabled={!usable} onClick={() => visibility(columns.filter(column => !column.locked).map(column => column.id), !columns.every(column => column.visible))}>{columns.every(column => column.visible) ? 'Скрыть все' : 'Показать все'}</button></div>
          </div>
          {found.map(column => <label key={column.id} className="journal-column-option"><input type="checkbox" checked={column.visible} disabled={column.locked || !usable} onChange={event => visibility([column.id], event.target.checked)} /><span>{column.label}</span>{column.locked ? <small className="text-[10px] text-slate-400">всегда виден</small> : null}</label>)}
          {!found.length ? <p className="journal-panel-note">Столбцы не найдены</p> : null}
          <p className="journal-panel-note">Перетаскивайте заголовки, чтобы изменить порядок. Столбцы клейм, стыков и назначений — через ПКМ по их заголовку.</p>
          <div className="px-4 pb-4"><button type="button" className="journal-button w-full" disabled={!usable} onClick={() => usable && api.resetColumnState()}><RotateCcw size={14} />Сбросить столбцы</button></div>
        </> : tab === 'appearance' ? <div className="p-4 space-y-4">
          <GridDensitySelect label="Плотность таблиц" value={appearance.density} onChange={density => setAppearance(current => ({ ...current, density }))} />
          <GridAppearanceSwitch label="Вертикальные границы" checked={appearance.verticalBorders} onChange={verticalBorders => setAppearance(current => ({ ...current, verticalBorders }))} />
          <p className="journal-panel-note">Применяется к линиям, клеймам, стыкам и назначениям. Текст переносится по ширине столбца.</p>
          <button type="button" className="journal-button w-full" onClick={() => setAppearance(DEFAULT_PROGRAM_APPEARANCE)}><RotateCcw size={14} />Вернуть исходное оформление</button>
        </div> : <GridThemeChoices label="Тема таблиц программы линий" value={appearance.theme} onChange={theme => setAppearance(current => ({ ...current, theme }))} note="Оформление меняется сразу и сохраняется в этом браузере для линий, клейм, стыков и назначений. Цвета результатов контроля сохраняют своё значение." />}

      </div>
    </div>, document.body)}
  </>
}
