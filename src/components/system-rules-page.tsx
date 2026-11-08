import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AgGridProvider, AgGridReact } from 'ag-grid-react'
import {
  ClientSideRowModelModule, ClientSideRowModelApiModule, ColumnApiModule, CustomFilterModule, QuickFilterModule,
  RowAutoHeightModule, LocaleModule, CellStyleModule, RowStyleModule, RowApiModule, CellApiModule, ScrollApiModule, EventApiModule, RenderApiModule,
  type ColDef, type GridApi, type ICellRendererParams, type PostProcessPopupParams,
} from 'ag-grid-community'
import { ColumnMenuModule, RowGroupingModule } from 'ag-grid-enterprise'
import { Search, X, RotateCcw } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { GRID_THEMES } from './grid-themes'
import { CONNECTION_RULE_FILTER } from './connection-rule-filter'
import { useProgramPageScroll } from './line-program-page-scroll'
import { positionGridPopup } from './grid-popup-position'
import { CONNECTION_RULES, SUPPORT_CONNECTION_RULES_PENDING, connectionRuleSpan, type ConnectionRule } from '@/lib/connection-rules'
import { CONNECTION_RULE_NOTES } from '@/lib/connection-rule-notes'
import { ASSIGNMENT_WARNINGS_HREF, CHECK_PARAMETERS_HREF, getSystemRulesSection, type SystemRulesSection } from '@/lib/reference-navigation'
import './system-rules-page.css'

const MODULES = [ClientSideRowModelModule, ClientSideRowModelApiModule, ColumnApiModule, CustomFilterModule, QuickFilterModule,
  RowAutoHeightModule, LocaleModule, CellStyleModule, RowStyleModule, RowApiModule, CellApiModule, ScrollApiModule, EventApiModule, RenderApiModule, RowGroupingModule, ColumnMenuModule]
const LOCALE = {
  noRowsToShow: 'Правила не найдены. Измените поиск или сбросьте фильтры.', noMatchingRows: 'Правила не найдены',
  pinColumn: 'Закрепить столбец', pinLeft: 'Слева', pinRight: 'Справа', noPin: 'Не закреплять',
  columnChooser: 'Выбрать столбцы', chooseColumns: 'Выбрать столбцы', resetColumns: 'Сбросить столбцы',
  expandAll: 'Развернуть все группы', collapseAll: 'Свернуть все группы',
  autosizeThisColumn: 'Ширина по содержимому', autosizeAllColumns: 'Подобрать ширину всех',
  columnFilter: 'Фильтр столбца', searchOoo: 'Поиск…',
  ariaLabelColumnMenu: 'Меню столбца', ariaColumnMenu: 'ПКМ — меню столбца',
  ariaColumnSelectAll: 'Показать или скрыть все столбцы', ariaColumnPanelList: 'Список столбцов',
  ariaColumn: 'Столбец', ariaColumnGroup: 'Раздел', ariaVisible: 'виден', ariaHidden: 'скрыт',
  ariaIndeterminate: 'частично выбран', ariaChecked: 'выбран', ariaUnchecked: 'не выбран',
  ariaFilterInput: 'Фильтр столбца', ariaFilterColumnsInput: 'Поиск столбцов',
  ariaClearInput: 'Очистить', ariaFilterMenuOpen: 'Открыть фильтр', ariaLabelColumnFilter: 'Фильтр столбца',
  ariaRowGroupExpanded: 'Развёрнуто', ariaRowGroupCollapsed: 'Свёрнуто',
}
const DEFAULT_COLUMN: ColDef<ConnectionRule> = {
  sortable: false, resizable: true, filter: CONNECTION_RULE_FILTER, suppressHeaderMenuButton: true,
  suppressMovable: true, wrapText: true, autoHeight: true, wrapHeaderText: true, autoHeaderHeight: true,
  minWidth: 220, flex: 1, cellDataType: false, cellClass: 'connection-rule-cell',
}

const RULE_LINK_CLASS = 'text-sky-700 underline decoration-sky-300 underline-offset-2 outline-none hover:text-sky-900 focus-visible:ring-2 focus-visible:ring-sky-400'

function RuleValue({ data, value, colDef }: ICellRendererParams<ConnectionRule>) {
  if (data?.checkParametersLink) return <a href={CHECK_PARAMETERS_HREF} className="connection-rule-text text-sky-700 underline decoration-sky-300 underline-offset-2 outline-none hover:text-sky-900 focus-visible:ring-2 focus-visible:ring-sky-400">Параметры проверки</a>
  const field = colDef?.field
  if (field && data?.assignmentWarningColumns?.some(column => column === field)) {
    const text = String(value ?? ''), label = 'с предупреждением', index = text.indexOf(label)
    if (index >= 0) return <span className="connection-rule-text">{text.slice(0, index)}<a href={ASSIGNMENT_WARNINGS_HREF} className={RULE_LINK_CLASS} title="Открыть настройки предупреждений">{label}</a>{text.slice(index + label.length)}</span>
  }
  return <span className="connection-rule-text">{value}</span>
}

export function SystemRulesPage() {
  const router = useRouter({ warn: false })
  const [section, setSection] = useState(() => getSystemRulesSection(window.location.search))
  const [visited, setVisited] = useState<SystemRulesSection[]>([section])
  const show = useCallback((next: SystemRulesSection) => {
    setSection(next)
    setVisited(previous => previous.includes(next) ? previous : [...previous, next])
  }, [])
  useEffect(() => {
    const restore = () => show(getSystemRulesSection(window.location.search))
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [show])
  function select(next: SystemRulesSection) {
    show(next)
    const url = new URL(window.location.href)
    url.pathname = '/account'; url.searchParams.set('tab', 'rules'); url.searchParams.set('section', next)
    if (url.href !== window.location.href) {
      // A tab change keeps the page and our newly focused tab in place.
      // Raw pushState lets route restoration overwrite the strip's scrollLeft.
      if (router) void router.navigate({ href: url.pathname + url.search + url.hash, resetScroll: false })
      else window.history.pushState(window.history.state, '', url)
    }
  }
  const tabs = [{ id: 'connections', label: 'Соединения' }, { id: 'checks', label: 'Параметры проверки' }, { id: 'assignments', label: 'Назначения и расчёты' }] as const
  return <section className="min-w-0 space-y-4" aria-label="Правила системы">
    <div role="tablist" aria-label="Разделы правил системы" className={`flex h-14 overflow-x-auto border-b border-slate-200 bg-slate-50 ${section !== 'connections' ? 'sticky top-0 z-30' : ''}`}>
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" aria-selected={section === tab.id} tabIndex={section === tab.id ? 0 : -1}
        id={`system-rules-tab-${tab.id}`} aria-controls={`system-rules-panel-${tab.id}`} onClick={() => select(tab.id)}
        onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'ArrowRight' ? (index + 1) % tabs.length : undefined
          if (next == null) return
          event.preventDefault(); select(tabs[next].id)
          const selectedTab = document.getElementById(`system-rules-tab-${tabs[next].id}`)
          selectedTab?.focus({ preventScroll: true })
          const strip = selectedTab?.parentElement
          if (selectedTab && strip) {
            const tabBounds = selectedTab.getBoundingClientRect(), stripBounds = strip.getBoundingClientRect()
            // Move only the tab strip; scrolling all ancestors can move the
            // sticky strip again when the newly selected panel changes height.
            strip.scrollLeft += tabBounds.left < stripBounds.left ? tabBounds.left - stripBounds.left
              : tabBounds.right > stripBounds.right ? tabBounds.right - stripBounds.right : 0
          }
        }}
        className={`shrink-0 border-b-2 px-3 py-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 sm:px-4 sm:text-sm ${section === tab.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`system-rules-panel-${tab.id}`} aria-labelledby={`system-rules-tab-${tab.id}`} hidden={section !== tab.id}>
      {visited.includes(tab.id) ? tab.id === 'connections' ? <ConnectionRulesTable active={section === tab.id} />
        : <Suspense fallback={<p className="p-6 text-sm text-slate-500">Загрузка…</p>}>{tab.id === 'checks' ? <CheckParameters /> : <AssignmentCalculationRules />}</Suspense> : null}
    </div>)}
  </section>
}

const AssignmentCalculationRules = lazy(() => import('./assignment-calculation-rules').then(module => ({ default: module.AssignmentCalculationRules })))

const CheckParameters = lazy(() => import('./welder-stamp-check-parameters').then(module => ({ default: module.WelderStampCheckParameters })))

function ConnectionRulesTable({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const api = useRef<GridApi<ConnectionRule> | null>(null)
  const [readyApi, setReadyApi] = useState<GridApi<ConnectionRule> | null>(null)
  const [popupParent] = useState(() => typeof document === 'undefined' ? undefined : document.createElement('div'))
  const popupColumn = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!popupParent) return
    // Filters must use the viewport even when the comparison has only one row.
    popupParent.className = 'connection-rules-popup-layer'
    document.body.append(popupParent)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !popupColumn.current || !api.current || api.current.isDestroyed()) return
      event.preventDefault(); event.stopPropagation()
      api.current.hideColumnFilter(); api.current.hidePopupMenu(); api.current.hideColumnChooser()
      api.current.setFocusedHeader(popupColumn.current)
    }
    popupParent.addEventListener('keydown', escape, true)
    return () => { popupParent.removeEventListener('keydown', escape, true); popupParent.remove() }
  }, [popupParent])
  const positionPopup = useCallback((params: PostProcessPopupParams) => {
    popupColumn.current = params.column?.getColId()
    positionGridPopup(params)
  }, [])
  useEffect(() => {
    if (active || !readyApi || readyApi.isDestroyed()) return
    readyApi.hideColumnFilter(); readyApi.hidePopupMenu(); readyApi.hideColumnChooser()
  }, [active, readyApi])
  useProgramPageScroll(root, readyApi, active, '[data-rules-toolbar]', { stickyFrame: true })
  const [search, setSearch] = useState('')
  const [count, setCount] = useState(CONNECTION_RULES.length)
  const [filtered, setFiltered] = useState(false)
  const columns = useMemo<ColDef<ConnectionRule>[]>(() => [
    { field: 'section', headerName: 'Раздел', rowGroup: true, hide: true, filter: false, getQuickFilterText: ({ value }) => String(value ?? '') },
    { field: 'parameter', headerName: 'Параметр', pinned: 'left', width: 270, minWidth: 230, flex: 0, cellClass: 'connection-rule-cell connection-rule-parameter', cellRenderer: ({ value }: ICellRendererParams<ConnectionRule>) => <span className="connection-rule-text">{value}</span> },
    ...(['c', 'u', 't'] as const).map<ColDef<ConnectionRule>>(field => {
      const span: NonNullable<ColDef<ConnectionRule>['colSpan']> = ({ data, api, column }) => connectionRuleSpan(data, field, SUPPORT_CONNECTION_RULES_PENDING,
        api.getAllDisplayedColumns().filter(candidate => candidate.getPinned() === column.getPinned()).map(candidate => candidate.getColId()))
      return {
        field, headerName: field === 'c' ? 'С — стыковое' : field === 'u' ? 'У — угловое' : `Т — опора${SUPPORT_CONNECTION_RULES_PENDING ? ' · запланировано' : ''}`,
        colSpan: span, cellRenderer: RuleValue,
        cellClassRules: { 'connection-rule-merged': params => span(params) > 1 },
      }
    }),
  ], [])
  const updateCount = useCallback(() => {
    let matched = 0
    api.current?.forEachNodeAfterFilter(node => { if (!node.group) matched++ })
    setCount(matched)
    setFiltered(Object.keys(api.current?.getFilterModel() ?? {}).length > 0)
  }, [])
  function reset() {
    setSearch('')
    api.current?.setFilterModel(null)
  }
  return <div className="min-w-0 space-y-4" data-page-scroll-root>
      {SUPPORT_CONNECTION_RULES_PENDING ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Запланировано: поддержка Т/ОП и общие изменения снятия назначения при одной заявке и отмены только невыполненной работы. Эти возможности проходят реализацию и проверку.</p> : null}
      <div data-rules-toolbar className="sticky top-0 z-30 flex flex-wrap items-center gap-3 bg-slate-50 py-2">
        <label className="relative min-w-60 flex-1"><span className="sr-only">Поиск правил соединений</span><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти правило…" className="pl-9 pr-10" />{search ? <button type="button" aria-label="Очистить поиск правил" onClick={() => setSearch('')} className="absolute right-1 top-1 rounded-md p-2 text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-300"><X className="h-4 w-4" /></button> : null}</label>
        <span role="status" aria-live="polite" className="text-xs text-slate-500">Найдено {count} из {CONNECTION_RULES.length}</span>
        <Button variant="outline" size="sm" onClick={reset} disabled={!search && !filtered}><RotateCcw className="h-4 w-4" />Сбросить фильтры</Button>
      </div>
      <div ref={root} className="connection-rules-grid" role="region" aria-label="Сравнение правил С, У и Т">
        <div className="program-grid-frame rounded-lg bg-white">
        <AgGridProvider modules={MODULES} licenseKey={import.meta.env.VITE_AG_GRID_LICENSE_KEY || undefined}><AgGridReact<ConnectionRule>
          gridId="connection-rules" theme={GRID_THEMES.quartz} rowData={CONNECTION_RULES} columnDefs={columns} defaultColDef={DEFAULT_COLUMN}
          localeText={LOCALE} getRowId={({ data }) => data.id} groupDisplayType="groupRows" groupDefaultExpanded={-1}
          groupRowRendererParams={{ suppressCount: true }} groupMaintainOrder suppressAggFuncInHeader
          quickFilterText={search.trim()} includeHiddenColumnsInQuickFilter animateRows={false}
          suppressCellFocus={false} suppressColumnMoveAnimation ensureDomOrder enableFilterHandlers headerHeight={44}
          suppressGroupRowsSticky suppressScrollOnNewData popupParent={popupParent} postProcessPopup={positionPopup}
          onGridReady={({ api: ready }) => { api.current = ready; setReadyApi(ready); updateCount() }}
          onFilterChanged={updateCount}
          onDisplayedColumnsChanged={({ api }) => api.refreshCells({ columns: ['c', 'u', 't'], force: true })}
          onGridPreDestroyed={() => { api.current = null }}
        /></AgGridProvider>
        </div>
      </div>
      <aside aria-labelledby="connection-rule-notes" className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 id="connection-rule-notes" className="font-semibold text-slate-900">Примечания</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600">{CONNECTION_RULE_NOTES.map(note => <li key={note.title}><strong className="text-slate-800">{note.title}.</strong> {note.text}</li>)}</ol>
      </aside>
  </div>
}
