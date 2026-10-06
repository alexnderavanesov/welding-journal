import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import type { ProgramReportNavigation } from './line-program-context-menu'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, ChevronDown, ChevronRight, ListFilter, Plus, Search, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LineProgramEditor } from './line-program-editor'
import { LineCalculation } from './line-program-calculation-view'
import { ProgramControlDetails } from './line-program-control-details'
import { ProgramDraftProvider } from './line-program-drafts'
import { CompactLineMetrics } from './line-program-compact-metrics'
import { useProgramScopeMenu, type ProgramScopeCommand, type ProgramScopeMenuEvent } from './line-program-scope-menu'
import { ProgramError, ProgramPagination, ProgramQuotaSummary, lineProgramQueryPolicy, programMetricLabelClass, programMetricValueClass, programMetricDetailClass, useProgramStickyHeight } from './line-program-primitives'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import type { LineProgramRecord, LineProgramSaveRequest, LineProgramTab } from '@/lib/line-program'
import { isLineProgramFinished, type LineProgramOverview } from '@/lib/line-program-overview'
import { isProgramRowClick, type ProgramSelection } from '@/lib/line-program-workspace'
import type { PercentageLineNavigationRequest, PercentageLineNavigationOutcome } from '@/lib/percentage-line-navigation'
import { findLineProgram, getLineProgramSection } from '@/server/line-program'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import { LineProgramReports } from './line-program-reports'
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
  return <ProgramDraftProvider><LineProgramContent {...props} /></ProgramDraftProvider>
}

function LineProgramContent({ navigationRequest, onNavigationHandled, onOpenReportRows }: Props) {
  const toolbarRef = useProgramStickyHeight('--program-toolbar-height')
  const reportNavigationHandled = useStableEventCallback(onNavigationHandled)
  const [tab, setTab] = useState<LineProgramTab>('lines')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(new Map<number, Program>())
  const [visited, setVisited] = useState(new Set<number>())
  const [editing, setEditing] = useState<LineProgramSaveRequest | null>(null)
  const [target, setTarget] = useState<{ id: number; selection: ProgramSelection } | null>(null)
  const [command, setCommand] = useState<{ lineId: number; value: ProgramScopeCommand } | null>(null)
  const [sectionMetric, setSectionMetric] = useState<ProgramSectionMetric | null>(null)
  const scopeMenu = useProgramScopeMenu()
  const query = useQuery({ queryKey: ['line-program', 'section'], queryFn: () => getLineProgramSection({ data: {} }), ...lineProgramQueryPolicy })
  // Search and tabs use compact line summaries, not repeated 200k-joint calculations.
  const needle = debouncedSearch.trim().toLocaleLowerCase('ru')
  const lines = (query.data?.rows ?? []).filter(line => (tab === 'lines' || !line.configurationIssue && (tab === 'full' ? line.weldControlPercent === 100 : line.weldControlPercent != null && line.weldControlPercent < 100)) &&
    (!needle || [line.projectTitle, line.subtitleCode, line.line, ...(line.searchStamps ?? [])].some(value => value.toLocaleLowerCase('ru').includes(needle))))
  const filtered = lines.filter(line => matches(line, filter))
  const actualPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 30) - 1))
  const paged = filtered.slice(actualPage * 30, (actualPage + 1) * 30)
  const outside = [...expanded.values()].filter(open => !paged.some(line => line.id === open.id)).map(open => lines.find(line => line.id === open.id) ?? open)
  const visible: Program[] = [...outside, ...paged]
  const choose = (line: Program, selection?: ProgramSelection) => {
    setCommand(null)
    setExpanded(previous => new Map(previous).set(line.id, line)); setVisited(previous => new Set(previous).add(line.id)); setTarget(selection ? { id: line.id, selection } : null)
  }
  const collapseAll = () => { setExpanded(new Map()); setCommand(null) }
  const toggle = (line: Program) => {
    if (!expanded.has(line.id)) { choose(line); return }
    setExpanded(previous => { const next = new Map(previous); next.delete(line.id); return next })
    setCommand(current => current?.lineId === line.id ? null : current)
  }
  const requestCommand = (line: Program, action: ProgramScopeCommand['action'], selection: ProgramSelection = { slice: 'all' }, explain = false) => {
    choose(line)
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
        choose(line, { stamp: navigationRequest.stamp || undefined, kind: navigationRequest.action === 'open-line' ? undefined : navigationRequest.demandKind ?? 'common', slice: 'all' })
        if (navigationRequest.jointId) setCommand({ lineId: line.id, value: { action: 'assignments', selection: { slice: 'all' }, jointId: navigationRequest.jointId } })
      }
      reportNavigationHandled(navigationRequest.id, line ? 'opened' : 'stale')
    }).catch(() => { if (active) reportNavigationHandled(navigationRequest.id, 'stale') })
    return () => { active = false }
  }, [navigationRequest, reportNavigationHandled])
  const totals = summarizeProgramSection(lines)
  const sectionContext = `${tab === 'lines' ? 'Все линии' : tab === 'full' ? '100%-ные линии' : 'Процентные линии'}${debouncedSearch.trim() ? ` · поиск: ${debouncedSearch.trim()}` : ''}`
  const selectFilter = (next: Filter) => { setFilter(next); setPage(0); collapseAll() }
  const openSectionMenu = (event: ProgramScopeMenuEvent) => scopeMenu.openSection(event, {
    description: sectionContext, onSelect: selectFilter, onCalculation: query.data ? setSectionMetric : undefined,
  })
  return <div className="min-w-0 space-y-3 pb-4 lg:pb-6" data-testid="line-program" onContextMenu={openSectionMenu} onKeyDown={openSectionMenu}>
    <LineProgramReports ids={filtered.map(line => line.id)} context={`${tab === 'lines' ? 'Все линии' : tab === 'full' ? '100%-ные линии' : 'Процентные линии'} · ${filterNames[filter]}${debouncedSearch.trim() ? ` · поиск: ${debouncedSearch.trim()}` : ''}`} disabled={!query.data || query.isFetching || search !== debouncedSearch}>{query.data ? <Button variant="ghost" size="sm" className="h-10 gap-2" aria-label="Расчёт итогов раздела" aria-haspopup="dialog" onClick={() => setSectionMetric('common')}><Calculator className="h-4 w-4" />Расчёт итогов</Button> : null}</LineProgramReports>
    <div ref={toolbarRef} data-testid="line-program-toolbar" className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white py-1.5"><div className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-slate-200 bg-white p-1">{([['lines', 'Все линии'], ['full', '100%-ные линии'], ['percentage', 'Процентные линии']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} className={`whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${tab === key ? 'bg-sky-50 text-sky-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} onClick={() => { setTab(key); setPage(0); collapseAll(); setFilter('all') }}>{label}</button>)}</div>
      <div className={`flex min-w-0 flex-1 items-center justify-end gap-2 ${filter === 'all' ? 'basis-[28rem]' : 'basis-[44rem]'}`}>
        {tab === 'lines' ? <Button className="shrink-0 gap-2" onClick={() => setEditing({ projectTitle: '', subtitleCode: '', line: '', category: null, groupName: null, weldControlPercent: null, pvkControlPercent: null })}><Plus className="h-4 w-4" />Новая линия</Button> : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {filter !== 'all' ? <div data-testid="line-program-filter" role="group" aria-label={`${filterNames[filter]} · линий: ${filtered.length}`} title={`${filterNames[filter]} · линий: ${filtered.length}`} className="flex h-10 min-w-0 max-w-[55%] items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 pl-2.5 pr-1 text-xs text-sky-800">
            <ListFilter aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span className="truncate font-medium">{filterNames[filter]}</span><span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 font-semibold tabular-nums" aria-label={`Линий: ${filtered.length}`}>{filtered.length}</span>
            <button type="button" aria-label="Сбросить фильтр" title="Сбросить фильтр" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sky-600 hover:bg-sky-100 hover:text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => selectFilter('all')}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </div> : null}
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="h-10 bg-white pl-9 pr-9" aria-label="Поиск программы линий" placeholder="Линия, проект, шифр или клеймо" value={search} onChange={event => { setSearch(event.target.value); setPage(0); collapseAll() }} />{search ? <button type="button" aria-label="Очистить поиск линий" className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" onClick={() => { setSearch(''); setPage(0) }}><X className="h-4 w-4" /></button> : null}</div>
        </div>
      </div>
    </div>
    {query.data ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-[minmax(15rem,1fr)_minmax(19rem,1.1fr)_minmax(24rem,1.1fr)]" aria-label="Итоги раздела" title={`Итоги всех линий раздела${debouncedSearch ? ' по поиску' : ''}, не только текущей страницы.`}>
      <div data-testid="program-count-metrics" className="grid min-w-0 grid-cols-2 min-[600px]:grid-cols-3 gap-2"><Metric metric="lines" label="Линий" value={lines.length} onClick={() => selectFilter('all')} /><Metric metric="joints" label="Учитываемых соединений" value={totals.joints} onClick={() => selectFilter('all')} /><Metric metric="stamps" label="Клейм в линиях" value={totals.stamps} onClick={() => selectFilter('all')} /></div>
      <ProgramQuotaSummary fluid common={totals.common} pvk={totals.pvk} onCommon={() => selectFilter('common')} onPvk={() => selectFilter('pvk')} />
      <div data-testid="program-action-metrics" className={`grid min-w-0 grid-cols-2 gap-2 md:col-span-2 2xl:col-span-1 ${totals.issues ? 'sm:grid-cols-3' : ''}`}>
        <DeficitMetric fluid common={totals.common} pvk={totals.pvk} onNeeded={() => selectFilter('missing')} /><ExcessMetric fluid reducible={totals.reducible} onReduction={() => selectFilter('reduction')} excess={totals.common.excess + totals.pvk.excess} approved={totals.approved} additional={totals.additional} onExcess={() => selectFilter('excess')} onApproved={() => selectFilter('approved')} onAdditional={() => selectFilter('additional')} onOpenMenu={openSectionMenu} />
        {totals.issues ? <button type="button" data-section-metric="configuration" className="flex min-h-20 min-w-0 flex-col justify-between rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-left text-sm font-medium leading-[18px] text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500" onClick={() => selectFilter('configuration')}>Нужна настройка: {totals.issues}<span className="text-sm font-normal leading-[18px] text-amber-700">СП-02</span></button> : null}
      </div>
    </div> : null}
    {sectionMetric && query.data ? <LineProgramSectionCalculationDialog lines={lines} totals={totals} context={sectionContext} initialMetric={sectionMetric} onClose={() => setSectionMetric(null)} onOpenLine={(line, metric) => { setSectionMetric(null); requestCommand(line, 'calculation', programSectionMetricSelection(metric), true) }} /> : null}
    {query.error ? <ProgramError error={query.error} /> : null}{query.isPending ? <p role="status" className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Загружаем линии и итоги…</p> : null}
    {editing ? <LineProgramEditor key={editing.id ?? 'new'} value={editing} onClose={() => setEditing(null)} onSaved={line => { setEditing(null); setTab(current => current === 'lines' ? current : programTab(line)); setSearch(line.line); setPage(0); setFilter('all'); choose(line) }} /> : null}
    {outside.length > 0 && query.data ? <p className="text-xs text-sky-700">Открытые линии вне текущей страницы показаны первыми.</p> : null}
    <div className="space-y-3">{visible.map(line => <LineCard key={line.id} line={line} expanded={expanded.has(line.id)} onToggle={() => toggle(line)} onEdit={tab === 'lines' ? () => setEditing(line) : undefined} onSelect={selection => choose(line, selection)} onOpenMenu={event => scopeMenu.open(event, {
      line, scope: { slice: 'all' }, expanded: expanded.has(line.id), onToggle: () => toggle(line),
      onAssignments: () => requestCommand(line, 'assignments'), onCalculation: (selection, explain) => requestCommand(line, 'calculation', selection, explain),
      onSelect: selection => choose(line, selection), onEdit: tab === 'lines' ? () => setEditing(line) : undefined,
    })}>
      {visited.has(line.id) ? <div hidden={!expanded.has(line.id)}><LineCalculation onOpenReportRows={onOpenReportRows} line={line} enabled={expanded.has(line.id)} targetSelection={target?.id === line.id ? target.selection : undefined}
        command={command?.lineId === line.id ? command.value : undefined} onCommandHandled={handled => setCommand(current => current?.value === handled ? null : current)} onOpenScopeMenu={scopeMenu.open} /></div> : null}
    </LineCard>)}</div>
    {scopeMenu.menu}
    {query.data && !visible.length ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">Линии не найдены. Попробуйте изменить поиск или фильтр.</p> : null}
    {query.data ? <ProgramPagination page={actualPage} pageSize={30} total={filtered.length} noun="линий" onChange={next => { setPage(next); collapseAll() }} /> : null}
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

function LineCard({ line, expanded, onToggle, onEdit, onSelect, onOpenMenu, children }: { line: Program; expanded: boolean; onToggle: () => void; onEdit?: () => void; onSelect: (selection: ProgramSelection) => void; onOpenMenu: (event: ProgramScopeMenuEvent) => void; children: React.ReactNode }) {
  const headerRef = useProgramStickyHeight('--program-line-height')
  const o = line.overview
  const missing = (o?.common?.missing ?? 0) + (o?.pvk?.missing ?? 0)
  const finished = !line.configurationIssue && isLineProgramFinished(o)
  const border = line.configurationIssue || missing > 0 ? 'border-amber-300' : finished ? 'border-emerald-300' : 'border-slate-200'
  const details = [o && (line.configurationIssue || !o.common || !o.pvk) ? `Клейм: ${o.stamps}` : '', line.weldControlPercent === 100 ? '100% — вся линия' : '', line.pvkControlPercent !== line.weldControlPercent ? `ПВК ${line.pvkControlPercent ?? '—'}%` : ''].filter(Boolean).join(' · ')
  return <section data-testid="line-program-card" data-program-finished={finished} title={finished ? 'Линия завершена: назначения достаточны, все учитываемые стыки годны' : undefined} onContextMenu={onOpenMenu} onKeyDown={onOpenMenu} data-line={line.line} className={`program-line-card min-w-0 rounded-lg border bg-white ${border}`}>
    <div ref={headerRef} data-testid="line-program-header" className={`sticky top-[var(--program-toolbar-height,0px)] z-20 grid min-h-[4.5rem] cursor-pointer grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-2 gap-y-0.5 ${expanded ? 'rounded-t-lg' : 'rounded-lg'} bg-white px-3 py-1 xl:grid-cols-[18rem_minmax(0,1fr)_2rem]`} onContextMenu={onOpenMenu} onKeyDown={onOpenMenu} onClick={event => { if (isProgramRowClick(event.target)) onToggle() }}>
      <button type="button" aria-label={`Расчёт линии ${line.line}`} aria-expanded={expanded} onClick={onToggle} className="flex min-w-0 items-start gap-2 py-1 text-left">
        <span className="mt-0.5 shrink-0 text-sky-700">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span data-testid="line-name" className="truncate whitespace-nowrap text-sm font-semibold text-slate-800" title={line.line}>{line.line}</span><span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">{line.weldControlPercent == null ? '—' : `${line.weldControlPercent}%`}</span>{finished ? <span data-testid="program-finished-label" className="shrink-0 whitespace-nowrap text-xs font-medium text-emerald-700">✓ Линия завершена</span> : null}</span><span className="mt-1 flex min-h-8 min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5 text-xs text-slate-500" title={`${line.projectTitle || 'Без проекта'} · ${line.subtitleCode || 'Без шифра'}${details ? ` · ${details}` : ''}`}><span data-testid="line-description" className="min-w-0 break-words [overflow-wrap:anywhere]">{line.projectTitle || 'Без проекта'} · {line.subtitleCode || 'Без шифра'}{details ? ` · ${details}` : ''}</span></span></span>
      </button>
      <div className="col-span-2 row-start-2 min-w-0 xl:col-span-1 xl:col-start-2 xl:row-start-1">{line.configurationIssue ? <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{line.configurationIssue}</p> : o ? <CompactLineMetrics overview={o} select={onSelect} onOpenMenu={onOpenMenu} /> : null}</div>
      {onEdit ? <Button variant="ghost" size="icon" className="col-start-2 row-start-1 h-8 w-8 shrink-0 text-slate-400 hover:text-sky-700 xl:col-start-3" aria-label="Настроить" title="Настроить линию" onClick={onEdit}><Settings2 className="h-4 w-4" /></Button> : null}
    </div>{o?.integrityIssues ? <p className="px-4 pb-2 text-xs text-amber-800">СП-04 · Нарушена целостность цепочки. Проверьте диспетчер и подробности расчёта; линия не завершена.</p> : null}{children}
  </section>
}
