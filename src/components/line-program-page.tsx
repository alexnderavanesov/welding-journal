import type { FilterChangedEvent, GridApi } from 'ag-grid-community'
import { ProgramViewSettings } from './line-program-view-settings'
import { useProgramStickyHeaders } from './line-program-sticky-headers'
import { currentProgramTarget, revealProgramLine } from './line-program-reveal'
import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import type { ProgramReportNavigation } from './line-program-context-menu'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calculator, ListFilter, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LineProgramEditor } from './line-program-editor'
import { LineCalculation } from './line-program-calculation-view'
import { ProgramControlDetails } from './line-program-control-details'
import { ProgramDraftProvider } from './line-program-drafts'
import { ProgramOverviewGrid } from './line-program-overview-grid'
import { ProgramGridSessionProvider } from './line-program-grid-session'
import { useProgramScopeMenu, type ProgramScopeCommand, type ProgramScopeMenuEvent } from './line-program-scope-menu'
import { ProgramError, ProgramPagination, ProgramQuotaSummary, lineProgramQueryPolicy, programMetricLabelClass, programMetricValueClass, programMetricDetailClass } from './line-program-primitives'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import type { LineProgramRecord, LineProgramSaveRequest, LineProgramTab } from '@/lib/line-program'
import { type LineProgramOverview } from '@/lib/line-program-overview'
import { type ProgramSelection } from '@/lib/line-program-workspace'
import type { PercentageLineNavigationRequest, PercentageLineNavigationOutcome } from '@/lib/percentage-line-navigation'
import { findLineProgram, getLineProgramPage, getLineProgramSection } from '@/server/line-program'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { LineProgramReports, type LineProgramReportsHandle } from './line-program-reports'
import { LineProgramSectionCalculationDialog } from './line-program-section-calculation-dialog'
import { summarizeProgramSection, programSectionMetricSelection, type ProgramSectionMetric } from '@/lib/line-program-section-summary'

type Props = { onOpenReportRows?: ProgramReportNavigation; navigationRequest?: PercentageLineNavigationRequest | null; onNavigationHandled?: (id: number, outcome: PercentageLineNavigationOutcome) => void }
type Program = LineProgramRecord & { overview?: LineProgramOverview }
type Filter = 'all' | 'common' | 'pvk' | 'missing' | 'reduction' | 'excess' | 'approved' | 'additional' | 'configuration'
const filterNames: Record<Filter, string> = { all: 'Все линии', common: PROGRAM_DEMAND_LABELS.common, pvk: 'ПВК', missing: 'Есть НК к назначению', reduction: 'Есть возможное сокращение', excess: 'Есть лишний контроль', approved: 'Есть согласованное превышение', additional: 'Есть дополнительные стыки', configuration: 'Нужна настройка программы линии' }
const programTab = (line: LineProgramRecord): LineProgramTab => line.configurationIssue || line.weldControlPercent == null ? 'lines' : line.weldControlPercent === 100 ? 'full' : 'percentage'
function matches(line: Program, filter: Filter) {
  const o = line.overview
  if (filter === 'all') return true
  if (filter === 'configuration') return !!line.configurationIssue
  if (!o) return false
  if (filter === 'common' || filter === 'pvk') return !!(o[filter]?.required || o[filter]?.covered)
  if (filter === 'missing') return (o.common?.missing ?? 0) + (o.pvk?.missing ?? 0) > 0
  if (filter === 'reduction') return o.reducible > 0
  if (filter === 'excess') return (o.common?.excess ?? 0) + (o.pvk?.excess ?? 0) > 0
  return o[filter] > 0
}

export function LineProgramPage(props: Props) {
  return <ProgramDraftProvider><ProgramGridSessionProvider><LineProgramContent {...props} /></ProgramGridSessionProvider></ProgramDraftProvider>
}

function LineProgramContent({ navigationRequest, onNavigationHandled, onOpenReportRows }: Props) {
  const [overviewApi, setOverviewApi] = useState<GridApi | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useProgramStickyHeaders(rootRef)
  const reportNavigationHandled = useStableEventCallback(onNavigationHandled)
  const [tab, setTab] = useState<LineProgramTab>('lines')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(new Map<number, Program>())
  const [editing, setEditing] = useState<LineProgramSaveRequest | null>(null)
  const editingFilters = useRef<ReturnType<GridApi['getFilterModel']>>({})
  const edit = (value: LineProgramSaveRequest) => {
    editingFilters.current = structuredClone(overviewApi?.getFilterModel() ?? {})
    setEditing(value)
  }
  const [target, setTarget] = useState<{ id: number; selection: ProgramSelection } | null>(null)
  const [revealTarget, setRevealTarget] = useState<{ line: LineProgramRecord; filters: ReturnType<GridApi['getFilterModel']> } | null>(null)
  const cancelledReveal = useRef<typeof revealTarget>(null)
  const [command, setCommand] = useState<{ lineId: number; value: ProgramScopeCommand } | null>(null)
  const [sectionMetric, setSectionMetric] = useState<ProgramSectionMetric | null>(null)
  const reports = useRef<LineProgramReportsHandle>(null)
  const scopeMenu = useProgramScopeMenu(request => reports.current?.open(request))
  const client = useQueryClient()
  const needle = debouncedSearch.trim().slice(0, 200).toLocaleLowerCase('ru')
  const searchReady = search.trim().slice(0, 200).toLocaleLowerCase('ru') === needle
  const sectionKey = tab === 'lines' && !needle ? ['line-program', 'section'] : ['line-program', 'section', tab, needle]
  const pageKey = ['line-program', 'page', tab, needle, page]
  const cachedSection = client.getQueryState<Awaited<ReturnType<typeof getLineProgramSection>>>(sectionKey)
  const cachedPage = client.getQueryState<Awaited<ReturnType<typeof getLineProgramPage>>>(pageKey)
  const cachedPages = client.getQueriesData<Awaited<ReturnType<typeof getLineProgramPage>>>({ queryKey: ['line-program', 'page', tab, needle] })
  const latestPageRevision = Math.max(0, ...cachedPages.map(([, data]) => data?.revision ?? 0))
  const sectionBehindPage = !!cachedSection?.data && (cachedSection.data.revision ?? 0) < latestPageRevision
  const hasCachedSection = !!cachedSection?.data && !cachedSection.isInvalidated && !sectionBehindPage
  const pageQuery = useQuery({ queryKey: pageKey,
    queryFn: () => getLineProgramPage({ data: { tab, search: needle, page } }),
    enabled: searchReady && !hasCachedSection && cachedPage?.status !== 'error', ...lineProgramQueryPolicy, retry: false, retryOnMount: false })
  const query = useQuery({ queryKey: sectionKey, queryFn: () => getLineProgramSection({ data: { tab, search: needle } }),
    enabled: searchReady && cachedSection?.status !== 'error' && (hasCachedSection || pageQuery.isSuccess && !pageQuery.isFetching), ...lineProgramQueryPolicy, retry: false, retryOnMount: false })
  // Never let a late response or debounce placeholder become a different search.
  // The full snapshot alone feeds derived filters, section totals and exports.
  const summaryReady = searchReady && hasCachedSection && !query.error
  const pageBehind = !!pageQuery.data && (pageQuery.data.revision ?? 0) < latestPageRevision
  const pageReady = searchReady && !!pageQuery.data && !pageBehind && !pageQuery.error
  const lines = summaryReady ? query.data!.rows : []
  const filtered = useMemo(() => lines.filter(line => matches(line, filter)), [lines, filter])
  const actualPage = summaryReady ? Math.min(page, Math.max(0, Math.ceil(filtered.length / 30) - 1)) : pageQuery.data?.page ?? 0
  const paged = useMemo(() => summaryReady ? filtered.slice(actualPage * 30, (actualPage + 1) * 30) : pageReady && filter === 'all' ? pageQuery.data!.rows : [], [summaryReady, filtered, actualPage, pageReady, filter, pageQuery.data])
  useEffect(() => {
    // A newer page is evidence of a concurrent edit. Refresh only this active
    // summary; a failed refresh remains an explicit retry, never a polling loop.
    if (searchReady && sectionBehindPage && !query.isFetching && !query.error) void query.refetch()
  }, [searchReady, sectionBehindPage, query.isFetching, query.error, query.refetch])
  useEffect(() => {
    if (searchReady && !summaryReady && pageBehind && !pageQuery.isFetching && !pageQuery.error) void pageQuery.refetch()
  }, [searchReady, summaryReady, pageBehind, pageQuery.isFetching, pageQuery.error, pageQuery.refetch])
  const outside = useMemo(() => searchReady ? [...expanded.values()].filter(open => !paged.some(line => line.id === open.id)).map(open => lines.find(line => line.id === open.id) ?? open) : [], [searchReady, expanded, paged, lines])
  const visible: Program[] = useMemo(() => outside.length ? [...outside, ...paged] : paged, [outside, paged])
  useEffect(() => {
    if (!revealTarget || !overviewApi || overviewApi.isDestroyed()) return
    // SetFilter also emits filterChanged while validating refreshed values.
    // Only a UI edit should cancel the explicit navigation.
    const cancelForUserFilter = () => {
      cancelledReveal.current = revealTarget
      setRevealTarget(current => current === revealTarget ? null : current)
    }
    // AG 36's Apply/Reset buttons carry fromAction, but Reset does not emit
    // filterUiChanged. Handler validation carries neither UI event nor action.
    const cancelForFilterAction = (event: FilterChangedEvent & { fromAction?: string }) => {
      if (event.source === 'columnFilter' && (event.fromAction === 'reset' || event.fromAction === 'apply')) cancelForUserFilter()
    }
    overviewApi.addEventListener('filterChanged', cancelForFilterAction)
    overviewApi.addEventListener('filterUiChanged', cancelForUserFilter)
    overviewApi.addEventListener('filterModified', cancelForUserFilter)
    return () => {
      if (!overviewApi.isDestroyed()) {
        overviewApi.removeEventListener('filterChanged', cancelForFilterAction)
        overviewApi.removeEventListener('filterUiChanged', cancelForUserFilter)
        overviewApi.removeEventListener('filterModified', cancelForUserFilter)
      }
    }
  }, [revealTarget, overviewApi])
  useEffect(() => {
    if (!revealTarget || !overviewApi || overviewApi.isDestroyed() || !searchReady ||
      !(summaryReady || pageReady && !pageQuery.isFetching)) return
    let phase: 'ready' | 'restoring' | 'filtering' | 'done' = 'ready'
    let active = true
    const clearTarget = () => setRevealTarget(current => current === revealTarget ? null : current)
    const reveal = () => {
      if (!active || cancelledReveal.current === revealTarget || overviewApi.isDestroyed()) return
      if (phase === 'filtering') {
        // onFilterChanged applies the filter asynchronously. Inspect membership
        // only after its model update, before expanding any collapsed ancestors.
        phase = 'done'
        if (revealProgramLine(overviewApi, revealTarget.line)) clearTarget()
        else phase = 'ready'
        return
      }
      if (phase !== 'ready' || !currentProgramTarget(overviewApi, revealTarget.line)) return
      // Empty debounce/loading rows can make SetFilter forget selected values.
      // Restore the pre-navigation snapshot once against the ready rows.
      phase = 'restoring'
      const columns = new Set([...Object.keys(overviewApi.getFilterModel()), ...Object.keys(revealTarget.filters)])
      void Promise.all([...columns].map(column => overviewApi.setColumnFilterModel(column, revealTarget.filters[column] ?? null))).then(() => {
        if (!active || cancelledReveal.current === revealTarget || overviewApi.isDestroyed()) return
        phase = 'filtering'
        overviewApi.onFilterChanged()
      }).catch(error => {
        if (!active || cancelledReveal.current === revealTarget || overviewApi.isDestroyed()) return
        phase = 'done'
        clearTarget()
        console.error('Unable to restore line program filters', error)
      })
    }
    overviewApi.addEventListener('modelUpdated', reveal)
    reveal()
    return () => {
      active = false
      if (!overviewApi.isDestroyed()) {
        overviewApi.removeEventListener('modelUpdated', reveal)
      }
    }
  }, [revealTarget, overviewApi, searchReady, summaryReady, pageReady, pageQuery.isFetching, visible])
  const choose = (line: Program, selection?: ProgramSelection, reveal = false, filters?: ReturnType<GridApi['getFilterModel']>) => {
    setCommand(null)
    setRevealTarget(reveal ? { line, filters: structuredClone(filters ?? overviewApi?.getFilterModel() ?? {}) } : null)
    setExpanded(previous => new Map(previous).set(line.id, line)); setTarget(selection ? { id: line.id, selection } : null)
  }
  const collapseAll = () => { setExpanded(new Map()); setCommand(null); setRevealTarget(null) }
  const toggle = (line: Program) => {
    if (!expanded.has(line.id)) { choose(line); return }
    setExpanded(previous => { const next = new Map(previous); next.delete(line.id); return next })
    setRevealTarget(current => current?.line.id === line.id ? null : current)
    setCommand(current => current?.lineId === line.id ? null : current)
  }
  const requestCommand = (line: Program, action: ProgramScopeCommand['action'], selection: ProgramSelection = { slice: 'all' }, explain = false) => {
    choose(line, undefined, true)
    setCommand({ lineId: line.id, value: { action, selection, explain } })
  }
  useEffect(() => {
    if (!navigationRequest) return
    let active = true
    void findLineProgram({ data: navigationRequest }).then(line => {
      if (!active) return
      if (line) {
        setCommand(null)
        setTab(programTab(line))
        setSearch(line.line); setPage(0); setFilter('all')
        choose(line, { stamp: navigationRequest.stamp || undefined, kind: navigationRequest.action === 'open-line' ? undefined : navigationRequest.demandKind ?? 'common', slice: 'all' }, true)
        if (navigationRequest.jointId) setCommand({ lineId: line.id, value: { action: 'assignments', selection: { slice: 'all' }, jointId: navigationRequest.jointId } })
      }
      reportNavigationHandled(navigationRequest.id, line ? 'opened' : 'stale')
    }).catch(() => { if (active) reportNavigationHandled(navigationRequest.id, 'stale') })
    return () => { active = false }
  }, [navigationRequest, reportNavigationHandled])
  const totals = summarizeProgramSection(lines)
  const sectionContext = `${tab === 'lines' ? 'Все линии' : tab === 'full' ? '100%-ные линии' : 'Процентные линии'}${debouncedSearch.trim() ? ` · поиск: ${debouncedSearch.trim()}` : ''}`
  const reportContext = `${sectionContext} · ${filterNames[filter]}`
  const reportDisabled = !summaryReady || query.isFetching
  const filteredCount = summaryReady ? filtered.length : '…'
  const filteredCountLabel = summaryReady ? `Линий: ${filtered.length}` : 'Идёт подсчёт линий'
  const filteredDescription = `${filterNames[filter]} · ${summaryReady ? `линий: ${filtered.length}` : 'идёт подсчёт'}`
  const reportIds = filtered.map(line => line.id)
  const selectFilter = (next: Filter) => { setFilter(next); setPage(0); collapseAll() }
  const openSectionMenu = (event: ProgramScopeMenuEvent) => scopeMenu.openSection(event, {
    description: sectionContext, onSelect: selectFilter, onCalculation: summaryReady ? setSectionMetric : undefined,
    report: reportDisabled ? undefined : { ids: reportIds, context: reportContext },
  })
  return <div ref={rootRef} className="min-w-0 space-y-3 pb-4 lg:pb-6" data-testid="line-program" onContextMenu={openSectionMenu} onKeyDown={openSectionMenu}>
    <LineProgramReports ref={reports} ids={reportIds} context={reportContext} disabled={reportDisabled}>{summaryReady ? <Button variant="ghost" size="sm" className="h-10 gap-2" aria-label="Расчёт итогов раздела" aria-haspopup="dialog" disabled={query.isFetching} onClick={() => setSectionMetric('common')}><Calculator className="h-4 w-4" />Расчёт итогов</Button> : null}</LineProgramReports>
    <div data-testid="line-program-toolbar" className="relative flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white py-1.5"><div className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-slate-200 bg-white p-1">{([['lines', 'Все линии'], ['full', '100%-ные линии'], ['percentage', 'Процентные линии']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} className={`whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${tab === key ? 'bg-sky-50 text-sky-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} onClick={() => { setTab(key); setPage(0); collapseAll(); setFilter('all') }}>{label}</button>)}</div>
      <div className={`flex min-w-0 flex-1 items-center justify-end gap-2 ${filter === 'all' ? 'basis-[28rem]' : 'basis-[44rem]'}`}>
        {tab === 'lines' ? <Button className="shrink-0 gap-2" onClick={() => edit({ projectTitle: '', subtitleCode: '', line: '', category: null, groupName: null, weldControlPercent: null, pvkControlPercent: null })}><Plus className="h-4 w-4" />Новая линия</Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {filter !== 'all' ? <div data-testid="line-program-filter" role="group" aria-label={filteredDescription} title={filteredDescription} className="flex h-10 min-w-0 max-w-[55%] items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 pl-2.5 pr-1 text-xs text-sky-800">
            <ListFilter aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="truncate font-medium">{filterNames[filter]}</span><span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 font-semibold tabular-nums" aria-label={filteredCountLabel}>{filteredCount}</span>
            <button type="button" aria-label="Сбросить фильтр" title="Сбросить фильтр" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sky-600 hover:bg-sky-100 hover:text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => selectFilter('all')}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </div> : null}
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="h-10 bg-white pl-9 pr-9" aria-label="Поиск программы линий" placeholder="Линия, проект, шифр или клеймо" value={search} onChange={event => { setSearch(event.target.value); setPage(0); collapseAll() }} />{search ? <button type="button" aria-label="Очистить поиск линий" className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => { setSearch(''); setPage(0); setRevealTarget(null) }}><X className="h-4 w-4" /></button> : null}</div><ProgramViewSettings api={overviewApi} />
        </div>
      </div>
    </div>
    {summaryReady ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-[minmax(15rem,1fr)_minmax(19rem,1.1fr)_minmax(24rem,1.1fr)]" aria-label="Итоги раздела" title={`Итоги всех линий раздела${debouncedSearch ? ' по поиску' : ''}, не только текущей страницы.`}>
      <div data-testid="program-count-metrics" className="grid min-w-0 grid-cols-2 min-[600px]:grid-cols-3 gap-2"><Metric metric="lines" label="Линий" value={lines.length} onClick={() => selectFilter('all')} /><Metric metric="joints" label="Учитываемых соединений" value={totals.joints} onClick={() => selectFilter('all')} /><Metric metric="stamps" label="Клейм в линиях" value={totals.stamps} onClick={() => selectFilter('all')} /></div>
      <ProgramQuotaSummary fluid common={totals.common} pvk={totals.pvk} onCommon={() => selectFilter('common')} onPvk={() => selectFilter('pvk')} />
      <div data-testid="program-action-metrics" className={`grid min-w-0 grid-cols-2 gap-2 md:col-span-2 2xl:col-span-1 ${totals.issues ? 'sm:grid-cols-3' : ''}`}>
        <DeficitMetric fluid common={totals.common} pvk={totals.pvk} onNeeded={() => selectFilter('missing')} /><ExcessMetric fluid reducible={totals.reducible} onReduction={() => selectFilter('reduction')} excess={totals.common.excess + totals.pvk.excess} approved={totals.approved} additional={totals.additional} onExcess={() => selectFilter('excess')} onApproved={() => selectFilter('approved')} onAdditional={() => selectFilter('additional')} onOpenMenu={openSectionMenu} />
        {totals.issues ? <button type="button" data-section-metric="configuration" className="flex min-h-20 min-w-0 flex-col justify-between rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-left text-sm font-medium leading-[18px] text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500" onClick={() => selectFilter('configuration')}>Нужна настройка: {totals.issues}<span className="text-sm font-normal leading-[18px] text-amber-700">СП-01</span></button> : null}
      </div>
    </div> : null}
    {sectionMetric && summaryReady ? <LineProgramSectionCalculationDialog lines={lines} totals={totals} context={sectionContext} initialMetric={sectionMetric} onClose={() => setSectionMetric(null)} onOpenLine={(line, metric) => { setSectionMetric(null); requestCommand(line, 'calculation', programSectionMetricSelection(metric), true) }} /> : null}
    {searchReady && !summaryReady && (query.error || pageQuery.error) ? <div className="flex items-center gap-3 rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2"><ProgramError error={(query.error || pageQuery.error)!} /><Button variant="ghost" size="sm" onClick={() => { if (pageQuery.error) void pageQuery.refetch(); else void query.refetch() }}>Повторить загрузку</Button></div> : null}
    {(!summaryReady || query.isFetching) && !query.error && !pageQuery.error ? <p role="status" className="rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-2 text-sm text-slate-500">{pageReady && filter === 'all' ? 'Линии доступны. Рассчитываем итоги всего отбора…' : pageReady ? 'Рассчитываем все подходящие линии для выбранного фильтра…' : 'Загружаем найденные линии…'}</p> : null}
    {editing ? <LineProgramEditor key={editing.id ?? 'new'} value={editing} onClose={() => setEditing(null)} onSaved={line => { setEditing(null); setTab(current => current === 'lines' ? current : programTab(line)); setSearch(line.line); setPage(0); setFilter('all'); choose(line, undefined, true, editingFilters.current) }} /> : null}
    {outside.length > 0 ? <p className="text-xs text-sky-700">Открытые линии вне текущей страницы показаны первыми.</p> : null}
    <ProgramOverviewGrid onReady={setOverviewApi} rows={visible} expanded={expanded} onToggle={toggle} onAssignments={line => requestCommand(line, 'assignments')} onEdit={tab === 'lines' ? line => edit(line) : undefined} onSelect={choose}
      onMenu={(event, line) => scopeMenu.open(event, {
      line, scope: { slice: 'all' }, expanded: expanded.has(line.id), onToggle: () => toggle(line),
      onAssignments: () => requestCommand(line, 'assignments'), onCalculation: (selection, explain) => requestCommand(line, 'calculation', selection, explain),
      onSelect: selection => choose(line, selection), onEdit: tab === 'lines' ? () => edit(line) : undefined,
    })}
      renderDetail={line => <LineCalculation onOpenReportRows={onOpenReportRows} line={line} overview={line.overview} onEdit={tab === 'lines' ? () => edit(line) : undefined} enabled={expanded.has(line.id)} targetSelection={target?.id === line.id ? target.selection : undefined}
        command={command?.lineId === line.id ? command.value : undefined} onCommandHandled={handled => setCommand(current => current?.value === handled ? null : current)} onOpenScopeMenu={scopeMenu.open} />} />
    {scopeMenu.menu}
    {(summaryReady || pageReady && filter === 'all') && !visible.length ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">Линии не найдены. Попробуйте изменить поиск или фильтр.</p> : null}
    {summaryReady || pageReady && filter === 'all' ? <ProgramPagination page={actualPage} pageSize={30} total={summaryReady ? filtered.length : pageQuery.data!.total} noun="линий" onChange={next => { setPage(next); collapseAll() }} /> : null}
  </div>
}

function Metric({ metric, label, value, onClick }: { metric: ProgramSectionMetric; label: string; value: number | string; onClick: () => void }) {
  return <button type="button" data-section-metric={metric} onClick={onClick} aria-label={`${label} ${value}`} className="flex min-h-20 min-w-0 w-full flex-col justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-sky-200 hover:bg-sky-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"><span data-metric-label className={`${programMetricLabelClass} text-slate-500`}>{label}</span><strong data-metric-value className={`whitespace-nowrap ${programMetricValueClass} text-slate-700`}>{value}</strong></button>
}

function DeficitMetric({ common, pvk, onNeeded, fluid = false }: {
  common: { missing: number }; pvk: { missing: number }
  onNeeded: () => void; fluid?: boolean
}) {
  const needed = common.missing + pvk.missing
  return <button type="button" data-testid="deficit-metric" data-section-metric="missing" aria-label={`К назначению ${needed}`} onClick={onNeeded} className={`flex min-h-20 ${fluid ? 'min-w-0 w-full' : 'w-64 shrink-0'} flex-col rounded-lg border px-3 py-2 text-left text-xs hover:border-amber-300 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${needed ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
    <span className="flex min-h-6 w-full shrink-0 items-baseline justify-between gap-2 font-medium text-slate-500"><span data-metric-label className={programMetricLabelClass}>К назначению</span><strong data-metric-value className={`${programMetricValueClass} text-slate-700`}>{needed}</strong></span>
    <span data-metric-detail className={`mt-0.5 shrink-0 ${programMetricDetailClass} text-slate-500`}><span className="whitespace-nowrap">{PROGRAM_DEMAND_LABELS.common}: {common.missing}</span>{' · '}<span className="whitespace-nowrap">ПВК: {pvk.missing}</span></span>
  </button>
}

function ExcessMetric({ excess, reducible, approved, additional, onExcess, onReduction, onApproved, onAdditional, onOpenMenu, fluid = false }: {
  excess: number; reducible: number; approved: number; additional: number
  onExcess: () => void; onReduction: () => void; onApproved: () => void; onAdditional: () => void; onOpenMenu: (event: ProgramScopeMenuEvent) => void; fluid?: boolean
}) {
  return <div data-testid="excess-metric" role="group" aria-label="Лишний и дополнительный контроль" className={`flex min-h-20 ${fluid ? 'min-w-0 w-full' : 'w-64 shrink-0'} flex-col rounded-lg border p-1 ${excess ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200 bg-white'}`}>
    <div className="flex items-center gap-1">
      <button type="button" data-section-metric="excess" aria-label={`Лишнее ${excess}`} className={`flex min-h-7 min-w-0 flex-1 items-baseline justify-between gap-2 rounded-md px-2 text-left hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 ${excess ? 'text-rose-700' : 'text-slate-600'}`} onClick={onExcess}><span data-metric-label className={programMetricLabelClass}>Лишнее</span><strong data-metric-value className={programMetricValueClass}>{excess}</strong></button>
      <ProgramControlDetails approved={approved} additional={additional} onApproved={onApproved} onAdditional={onAdditional} onOpenMenu={onOpenMenu} />
    </div>
    {reducible > 0 ? <button type="button" data-section-metric="reduction" aria-label={`Возможное сокращение ${reducible}`} title="Число жёлтых рамок: назначения «да», которые можно снять вместе без нарушения норм. Заявок, результатов и заключений по этим методам нет." onClick={onReduction} className={`mt-0.5 flex min-h-7 items-center justify-between gap-2 rounded px-2 text-left text-xs text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${approved || additional ? 'pr-10' : ''}`}><span>Возможное сокращение</span><span className="shrink-0 tabular-nums">{reducible}</span></button> : null}
  </div>
}
