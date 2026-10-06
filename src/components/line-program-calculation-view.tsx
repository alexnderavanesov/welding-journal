import { PROGRAM_DEMAND_LABELS, PROGRAM_SLICE_LABELS } from '@/lib/line-program-labels'
import type { ProgramReportNavigation } from './line-program-context-menu'
import type { ProgramScopeCommand, ProgramScopeMenuEvent, ProgramScopeMenuOptions } from './line-program-scope-menu'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Calculator, ChevronDown, ChevronRight } from 'lucide-react'
import { ProgramQuickFilters, type ProgramQuickFilter } from './line-program-quick-filters'
import { useQuery } from '@tanstack/react-query'
import { LineProgramCalculationDialog } from './line-program-calculation-dialog'
import { LineJointPage } from './line-program-joint-page'
import { useProgramDraftCount } from './line-program-drafts'
import { ProgramError, lineProgramQueryPolicy, programScopeActionClass, programScopePrimaryActionClass, programDisclosureClass, programLinkClass } from './line-program-primitives'
import { ProgramControlState } from './line-program-control-state'
import type { LineProgramRecord } from '@/lib/line-program'
import type { LineProgramDemandKind } from '@/lib/line-program-calculation'
import { formatProgramAssignmentAccounting } from '@/lib/line-program-accounting'
import type { LineProgramDemandSummary } from '@/lib/line-program-overview'
import { programScopeKey } from '@/lib/line-program-selection'
import { isProgramRowClick, type ProgramSelection } from '@/lib/line-program-workspace'
import { getLineProgramCalculation } from '@/server/line-program'

type Props = { onOpenReportRows?: ProgramReportNavigation; line: LineProgramRecord; targetStamp?: string; targetKind?: LineProgramDemandKind; targetSelection?: ProgramSelection; enabled?: boolean
  command?: ProgramScopeCommand; onCommandHandled?: (command: ProgramScopeCommand) => void
  onOpenScopeMenu?: (event: ProgramScopeMenuEvent, options: ProgramScopeMenuOptions) => void }
const cell = 'border-b border-slate-100 px-2 py-1 text-left align-middle'
const link = programLinkClass

export function LineCalculation({ line, targetStamp, targetKind, targetSelection, enabled = true, onOpenReportRows, command, onCommandHandled, onOpenScopeMenu }: Props) {
  const draftCount = useProgramDraftCount(line.id)
  const initial = targetSelection ?? { stamp: targetStamp || undefined, kind: targetKind, slice: 'all' as const }
  const [selection, setSelection] = useState<ProgramSelection>(initial)
  const [blocks, setBlocks] = useState(() => new Map<string, { selection: ProgramSelection; open: boolean }>(targetSelection || targetStamp ? [[programScopeKey(initial), { selection: initial, open: true }]] : []))
  const [view, setView] = useState<'all' | 'groups'>(targetSelection && !targetSelection.stamp && !targetSelection.unassigned ? 'all' : 'groups')
  const [quickFilter, setQuickFilter] = useState<ProgramQuickFilter>('all')
  const [containers, setContainers] = useState(new Map<string, HTMLDivElement>())
  const registerContainer = useCallback((key: string, element: HTMLDivElement | null) => setContainers(previous => {
    if (previous.get(key) === element || !element && !previous.has(key)) return previous
    const next = new Map(previous); if (element) next.set(key, element); else next.delete(key); return next
  }), [])
  const stampButtons = useRef(new Map<string, HTMLButtonElement>())
  const allButton = useRef<HTMLButtonElement>(null)
  const unassignedButton = useRef<HTMLButtonElement>(null)
  const [showCalculation, setShowCalculation] = useState(false)
  const [explainSelection, setExplainSelection] = useState<ProgramSelection>()
  const [assignmentRequest, setAssignmentRequest] = useState<ProgramScopeCommand>()
  const handledCommand = useRef<ProgramScopeCommand | undefined>(undefined)
  const choose = (value: ProgramSelection) => {
    setView(value.stamp || value.unassigned ? 'groups' : 'all')
    setQuickFilter(value.status ?? (value.slice === 'missing' ? 'missing' : 'all'))
    setAssignmentRequest(undefined)
    setSelection(value)
    setBlocks(previous => new Map(previous).set(programScopeKey(value), { selection: value, open: true }))
  }
  const filteredScope = (scope: ProgramSelection): ProgramSelection => ({ ...scope, slice: quickFilter === 'missing' ? 'missing' : 'all', kind: undefined,
    status: quickFilter !== 'all' && quickFilter !== 'missing' ? quickFilter : undefined })
  const changeFilter = (value: ProgramQuickFilter) => {
    setQuickFilter(value)
    const filter = { kind: undefined, slice: value === 'missing' ? 'missing' as const : 'all' as const,
      status: value !== 'all' && value !== 'missing' ? value : undefined }
    const openAll = ![...blocks].some(([key, block]) => block.open && (view === 'all' ? key === 'all:' : key !== 'all:'))
    if (openAll) setView('all')
    setBlocks(previous => {
      const next = new Map([...previous].map(([key, block]) => [key, { ...block, selection: { ...block.selection, ...filter } }]))
      if (openAll) next.set('all:', { open: true, selection: filter })
      return next
    })
  }
  const execute = (request: ProgramScopeCommand) => {
    if (request.action === 'calculation') { setAssignmentRequest(undefined); setSelection(request.selection); setExplainSelection(request.explain ? request.selection : undefined); setShowCalculation(true) }
    else { choose(request.selection); setAssignmentRequest(request) }
  }
  const collapse = (scope: ProgramSelection) => {
    setAssignmentRequest(current => current && programScopeKey(current.selection) === programScopeKey(scope) ? undefined : current)
    setBlocks(previous => new Map(previous).set(programScopeKey(scope), { selection: scope, open: false }))
    const trigger = scope.unassigned ? unassignedButton.current ?? allButton.current : [...stampButtons.current].find(([stamp]) => stamp.toLocaleLowerCase('ru') === scope.stamp?.toLocaleLowerCase('ru'))?.[1] ?? allButton.current
    trigger?.focus({ preventScroll: true })
  }
  useEffect(() => { if (targetSelection) choose(targetSelection); else if (targetStamp) choose({ stamp: targetStamp, kind: targetKind, slice: 'all' }) }, [targetSelection, targetStamp, targetKind])
  const query = useQuery({ queryKey: ['line-program', 'calculation', line.id], queryFn: () => getLineProgramCalculation({ data: { id: line.id } }), enabled, ...lineProgramQueryPolicy })
  const configured = !!query.data && !query.data.issue
  useEffect(() => {
    if (enabled) return
    setAssignmentRequest(undefined)
    if (command) onCommandHandled?.(command)
  }, [enabled, command, onCommandHandled])
  useEffect(() => {
    if (!enabled || !command || handledCommand.current === command || !query.data) return
    handledCommand.current = command
    if (configured) execute(command)
    onCommandHandled?.(command)
  }, [command, enabled, configured, query.data, onCommandHandled])
  const stamps = query.data?.stampRows ?? query.data?.stamps.filter(stamp => stamp.scope !== 'line').map(stamp => ({ ...stamp, journalRows: stamp.count, errors: 0, waitingWeld: 0, reducible: 0 })) ?? []
  const allGroups = query.data?.summary ? [query.data.summary, ...stamps] : query.data?.stamps ?? []
  const selectedStamp = stamps.find(stamp => stamp.stamp.toLocaleLowerCase('ru') === selection.stamp?.toLocaleLowerCase('ru'))?.stamp
  // A removed/renamed stamp must not orphan the single workspace (or its draft).
  useEffect(() => {
    if (!configured) return
    const missingScope = (block: { selection: ProgramSelection }) => !!(block.selection.stamp && !stamps.some(stamp => stamp.stamp.toLocaleLowerCase('ru') === block.selection.stamp!.toLocaleLowerCase('ru')) || block.selection.unassigned && !query.data?.unassigned)
    if ([...blocks.values()].some(missingScope)) setView('all')
    setBlocks(previous => {
      const next = new Map(previous)
      let changed = false
      for (const [key, block] of previous) {
        if (missingScope(block)) {
          next.delete(key); next.set('all:', { ...block, selection: { ...block.selection, stamp: undefined, unassigned: false } }); changed = true
        }
      }
      return changed ? next : previous
    })
  }, [query.data])
  const workspaces = [...blocks].map(([key, block]) => ({ key, ...block, open: block.open && (view === 'all' ? key === 'all:' : key !== 'all:'), container: containers.get(key) ?? null, selection: {
    ...block.selection, stamp: stamps.find(stamp => stamp.stamp.toLocaleLowerCase('ru') === block.selection.stamp?.toLocaleLowerCase('ru'))?.stamp,
  } }))
  const displayRows = [...stamps, ...(query.data?.unassigned ? [{ ...query.data.unassigned, welderName: '' }] : [])]
  const openGroups = workspaces.filter(block => block.open && block.key !== 'all:')
  const activeScope = view === 'all' ? blocks.get('all:')?.selection : openGroups.find(block => block.key === programScopeKey(selection))?.selection ?? (openGroups.length === 1 ? openGroups[0].selection : undefined)
  const actionScope = activeScope ?? filteredScope({ slice: 'all' })
  const actionLabel = actionScope.unassigned ? 'без клейма' : actionScope.stamp ? `клейма ${actionScope.stamp}` : 'линии'
  const openBackgroundMenu = (event: ProgramScopeMenuEvent) => {
    const block = workspaces.find(workspace => event.target instanceof Node && workspace.container?.contains(event.target))
    const scope: ProgramSelection = block?.selection ?? { slice: 'all' }
    const active = !!blocks.get(programScopeKey(scope))?.open
    onOpenScopeMenu?.(event, { line: query.data?.line ?? line, scope, expanded: active,
      onToggle: () => active ? collapse(scope) : choose(scope), onSelect: value => choose(value),
      onAssignments: () => execute({ action: 'assignments', selection: scope }), onCalculation: (selection, explain) => execute({ action: 'calculation', selection, explain }) })
  }
  return <div className="min-w-0 border-t border-slate-200" data-testid="line-calculation" onContextMenu={openBackgroundMenu} onKeyDown={openBackgroundMenu}>
    {query.error ? <div className="p-4"><ProgramError error={query.error} /></div> : null}
    {query.isPending ? <p role="status" className="p-4 text-sm text-slate-500">Рассчитываем потребность…</p> : null}
    {query.data?.issue ? <p className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{query.data.issue} Сначала настройте линию.</p> : null}
    {configured && selection.stamp && !selectedStamp ? <p role="status" className="px-4 py-2 text-xs text-slate-500">Клеймо {selection.stamp} больше не входит в расчёт. Показана вся линия.</p> : null}
    {configured ? <div data-testid="program-line-filters" className="sticky top-[calc(var(--program-toolbar-height,0px)+var(--program-line-height,0px))] z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-200 bg-white px-3 py-1.5">
      <div role="group" aria-label="Вид стыков линии" className="flex shrink-0 gap-3">{(['groups', 'all'] as const).map(mode => <button key={mode} ref={mode === 'all' ? allButton : undefined} type="button" aria-pressed={view === mode} className={`min-h-7 border-b-2 text-xs ${view === mode ? 'border-sky-600 font-semibold text-sky-800' : 'border-transparent text-slate-600'}`} onClick={() => mode === 'all' ? choose(filteredScope({ slice: 'all' })) : setView('groups')}>{mode === 'groups' ? 'По клеймам' : 'Все стыки линии'}</button>)}</div>
      <ProgramQuickFilters value={quickFilter} counts={'recordCounts' in query.data! ? query.data.recordCounts : undefined} missing={query.data?.summary ? query.data.summary.common.missing + query.data.summary.pvk.missing : undefined} onChange={changeFilter} />
      {view === 'all' ? <ScopeCaption scope={actionScope} /> : null}
      <div data-testid="program-scope-actions" className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        {view === 'groups' && openGroups.length > 1 ? <select aria-label="Область действий" className="h-8 max-w-full shrink-0 rounded-lg border border-slate-200 bg-white pl-3 pr-9 text-xs text-slate-700" value={programScopeKey(actionScope)} onChange={event => setSelection(openGroups.find(block => block.key === event.target.value)?.selection ?? { slice: 'all' })}><option value="all:">Вся линия</option>{openGroups.map(block => <option key={block.key} value={block.key}>{block.selection.unassigned ? 'Без клейма' : `Клеймо ${block.selection.stamp}`}</option>)}</select> : null}
        <button type="button" disabled={!!actionScope.unassigned} title={actionScope.unassigned ? 'Отдельный расчёт без клейма недоступен. Выберите «Все стыки линии» для общего расчёта.' : undefined} className={`${programScopeActionClass} disabled:cursor-not-allowed disabled:opacity-40`} onClick={() => execute({ action: 'calculation', selection: actionScope })}>Расчёт {actionLabel}</button>
        <button type="button" className={programScopePrimaryActionClass} onClick={() => execute({ action: 'assignments', selection: actionScope })}>Назначения {actionLabel}{draftCount ? <span className="rounded bg-white/80 px-1.5 text-xs">черновик: {draftCount}</span> : null}</button>
      </div>
    </div> : null}
    {configured ? <div hidden={view !== 'groups'} className="overflow-x-auto"><table className="w-full min-w-[1200px] table-fixed text-sm" aria-label="Расчёт по клеймам"><colgroup>{['w-[14%]', 'w-[8%]', 'w-[10%]', 'w-[13%]', 'w-[15%]', 'w-[13%]', 'w-[18%]', 'w-[9%]'].map((width, index) => <col key={index} className={width} />)}</colgroup><thead className="bg-slate-50 text-[11px] text-slate-700 xl:text-xs"><tr>{['Клеймо', 'Соединений', 'Состояние', 'Зачтено / нужно', 'Назначения', 'К назначению', 'Расчёт', 'Результаты'].map(title => <th key={title} className="border-b border-slate-100 px-2 py-1 text-left align-middle break-words" title={title === 'Соединений' ? 'Учитываемые физические соединения, не число записей журнала и не процентная база' : undefined}>{title}</th>)}</tr></thead><tbody>{displayRows.map(stamp => {
      const unassigned = stamp.scope === 'unassigned', code = unassigned ? undefined : stamp.stamp
      const scope = { stamp: code, unassigned, slice: 'all' as const }, scopeKey = programScopeKey(scope)
      const scopeLabel = unassigned ? 'Клеймо не назначено' : `Клеймо ${code}`
      const block = blocks.get(scopeKey), active = !!block?.open
      const planning = stamp.waitingWeld > 0 && !stamp.common.required && !stamp.pvk.required
      const kinds = ['common', 'pvk'] as const
      const excess = kinds.reduce((sum, kind) => sum + stamp[kind].excess + stamp[kind].duplicateAssignments, 0)
      const needed = kinds.reduce((sum, kind) => sum + stamp[kind].missing, 0)
      const closed = !needed
      const calculationStatus = planning ? 'Планирование НК' : unassigned && !stamp.common.required && !stamp.pvk.required ? 'Без расчётной группы' : closed ? 'Закрыт' : ''
      const fullControlByRejection = !!stamp.fullControlRequired
      const selectStamp = () => active ? collapse(block!.selection) : choose(filteredScope({ stamp: code, unassigned, slice: 'all' }))
      const select = (value: ProgramSelection) => choose({ ...value, stamp: code, unassigned })
      const openMenu = (event: ProgramScopeMenuEvent) => onOpenScopeMenu?.(event, { line: query.data!.line, scope, expanded: active, onToggle: selectStamp,
        onAssignments: () => execute({ action: 'assignments', selection: scope }), onCalculation: (selection, explain) => execute({ action: 'calculation', selection, explain }), onSelect: select })
      return <Fragment key={scopeKey}><tr data-testid={unassigned ? 'line-program-unassigned' : 'line-program-stamp'} data-stamp={code} data-full-control-by-rejection={fullControlByRejection || undefined} className={`h-14 cursor-pointer ${fullControlByRejection ? "bg-rose-50/30 hover:bg-rose-50/60 shadow-[inset_1px_0_0_#fecdd3]" : unassigned ? 'bg-amber-50/60 hover:bg-amber-50' : active ? 'bg-slate-100 shadow-[inset_1px_0_0_#cbd5e1] hover:bg-slate-100' : 'bg-white hover:bg-slate-50/60'}`} onContextMenu={openMenu} onKeyDown={openMenu} onClick={event => { if (isProgramRowClick(event.target)) selectStamp() }}>
        <td className={cell}><div className="flex min-w-0 items-center gap-1"><button ref={element => { if (unassigned) unassignedButton.current = element; else if (element) stampButtons.current.set(code!, element); else stampButtons.current.delete(code!) }} type="button" title={unassigned ? 'Стыки без назначенного сварщика' : stamp.welderName || 'ФИО не указано'} className={`${programDisclosureClass} min-w-0 text-sky-800 hover:bg-slate-50`} aria-label={scopeLabel} aria-expanded={active} onClick={selectStamp}>{active ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}<span className="truncate" title={unassigned ? 'Клеймо не назначено' : code}>{unassigned ? 'Клеймо не назначено' : code}</span></button><button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-sky-50 hover:text-sky-800" title="Расчёт" aria-label={`Расчёт · ${scopeLabel}`} aria-haspopup="dialog" disabled={unassigned} onClick={() => execute({ action: 'calculation', selection: scope })}><Calculator aria-hidden className="h-3.5 w-3.5" /></button></div>{!unassigned ? <span data-testid="line-program-welder-name" className="block truncate pl-[1.625rem] text-xs leading-4 text-slate-500" title={stamp.welderName || 'ФИО не указано'}>{stamp.welderName || 'ФИО не указано'}</span> : null}{active ? <ScopeCaption scope={block!.selection} /> : null}</td>
        <td className={`${cell} tabular-nums`}><button type="button" className={link} title="Учитываемые физические соединения, включая ещё не сваренные. Это не число записей журнала и не процентная база." data-program-slice="all" onClick={() => select({ slice: 'all' })}>{stamp.count}</button></td>
        <td className={cell}><ProgramControlState state={stamp} compact /></td>
        {/* Keep quota and assignment counts aligned when either label wraps. */}
        <td colSpan={2} className="border-b border-slate-100 py-1 text-left align-middle"><div>{kinds.map(kind => <div key={kind} data-testid={'program-demand-row-' + kind} className="grid grid-cols-[13fr_15fr] items-center text-xs">
          <div className="min-w-0 px-2">{kind === 'common' || stamp[kind].required || stamp[kind].covered ? unassigned && stamp[kind].percent < 100 ? <p className="text-slate-500">{PROGRAM_DEMAND_LABELS[kind]}: расчёт после сварки и назначения клейма</p> : <Quota kind={kind} demand={stamp[kind]} choose={slice => select({ kind, slice })} /> : null}</div>
          <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 px-2">
            <button type="button" className={link + ' w-40 max-w-full flex-wrap text-left leading-5 tabular-nums'} title={stamp[kind].accounting ? formatProgramAssignmentAccounting(stamp[kind].accounting.assignments) : undefined} data-program-slice="assigned" data-program-kind={kind} onClick={() => select({ kind, slice: 'assigned' })}>{PROGRAM_DEMAND_LABELS[kind]}: <span className="whitespace-nowrap">назначено {stamp[kind].assigned}</span></button>
          </div>
        </div>)}</div></td>
        <td data-testid="program-assignment-demand" className={cell}>
          {planning || unassigned && !stamp.common.required && !stamp.pvk.required ? <span className="text-slate-400">—</span> : <button type="button" aria-label={`К назначению: ${needed}`} title="Сумма достижимой потребности РК/УЗК и ПВК, не число разных стыков." data-program-slice="missing" onClick={() => select({ slice: 'missing' })} className={`min-h-6 min-w-6 rounded text-left text-sm font-semibold tabular-nums underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${needed ? 'text-amber-900 hover:text-amber-950' : 'text-slate-600 hover:text-slate-800'}`}>{needed}</button>}
          {needed > 0 ? <div data-testid="program-demand-breakdown" aria-label="К назначению по методам" title="Сумма мест потребности по методам и клеймам, не число разных стыков." className="flex flex-wrap gap-x-2 text-xs font-normal">{kinds.map(kind => <div key={kind}>{stamp[kind].missing ? <button type="button" className={programLinkClass} data-program-slice="missing" data-program-kind={kind} onClick={() => select({ kind, slice: 'missing' })}>{PROGRAM_DEMAND_LABELS[kind]}: {stamp[kind].missing}</button> : <span className="inline-flex min-h-6 items-center text-slate-600">{PROGRAM_DEMAND_LABELS[kind]}: 0</span>}</div>)}</div> : null}
        </td>
        <td data-testid="program-stamp-calculation" className={cell}>
          <div className="grid min-h-12 grid-rows-[minmax(1.5rem,auto)_minmax(1.5rem,auto)] text-xs">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
              {calculationStatus ? <button type="button" aria-label={calculationStatus === 'Закрыт' ? 'Расчёт закрыт' : calculationStatus} title={calculationStatus === 'Закрыт' ? 'Закрыт расчёт назначений, а не контроль: ожидания и негодные результаты остаются видны отдельно.' : undefined} className={`min-h-6 min-w-6 rounded text-left font-semibold underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${calculationStatus === 'Закрыт' ? 'text-emerald-800 hover:text-emerald-950' : 'text-slate-600 hover:text-slate-800'}`} data-program-slice={planning || unassigned ? 'all' : 'covered'} onClick={() => select({ slice: planning || unassigned ? 'all' : 'covered' })}>{calculationStatus}</button> : null}
              {calculationStatus && excess ? <span aria-hidden="true" className="text-slate-400">·</span> : null}
              {excess ? <button type="button" className="min-h-6 min-w-6 rounded whitespace-nowrap font-semibold text-rose-700 underline decoration-dotted underline-offset-4 hover:text-rose-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" data-program-slice="excess" onClick={() => select({ slice: 'excess' })}>Лишнее: {excess}</button> : null}
              {!calculationStatus && !excess && !stamp.reducible ? <span className="text-slate-400">—</span> : null}
            </div>
            <div className="flex items-center">
              {stamp.reducible > 0 ? <button type="button" className="min-h-6 min-w-6 rounded text-left text-amber-900 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" title="Назначения «да» с жёлтой рамкой: можно снять вместе без нарушения нормы" data-program-slice="reduction" onClick={() => select({ slice: 'reduction' })}>Возможное сокращение: {stamp.reducible}</button> : null}
            </div>
          </div>
        </td>
        <td data-testid="program-stamp-results" className={cell}><div className="flex flex-col items-start text-xs">
          <button type="button" className="min-h-6 min-w-6 rounded text-[13px] text-slate-600 underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500" data-program-slice="results" onClick={() => select({ slice: 'results' })}>Результаты</button>
          {fullControlByRejection ? <span title={`Для этого сварщика требуется 100% контроля ${PROGRAM_DEMAND_LABELS.common} по браку`} className="whitespace-nowrap rounded bg-rose-50 px-1 py-0.5 text-[11px] font-medium text-rose-700">100% по браку</span> : null}
        </div></td>
      </tr>{block ? <tr hidden={!active} data-testid="stamp-joints-container" data-scope={scopeKey} data-stamp={code}><td colSpan={8} className="border-b border-slate-300 bg-white p-0"><div data-testid="program-stamp-branch" className="relative min-w-0 pl-6"><span data-testid="program-stamp-guide" aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-5 w-px bg-slate-300" /><ScopeHost scopeKey={scopeKey} register={registerContainer} /></div></td></tr> : null}</Fragment>
    })}</tbody></table>{query.data && !stamps.length && !query.data.unassigned ? <p className="p-4 text-sm text-slate-500">Нет сваренных актуальных официальных С/У-стыков с клеймами для расчёта процента.</p> : null}</div> : null}
    {configured && blocks.has('all:') ? <div hidden={view !== 'all' || !blocks.get('all:')?.open} data-testid="line-program-all-joints" data-scope="all:"><ScopeHost scopeKey="all:" register={registerContainer} /></div> : null}
    {blocks.size > 0 && configured ? <LineJointPage workspaces={workspaces} onOpenReportRows={onOpenReportRows} line={query.data!.line} enabled={enabled && workspaces.some(block => block.open)} assignmentRequest={assignmentRequest} onAssignmentRequestHandled={handled => setAssignmentRequest(current => current === handled ? undefined : current)} /> : null}
    {enabled && showCalculation && configured ? <LineProgramCalculationDialog onOpenRow={onOpenReportRows ? id => onOpenReportRows([id], 'weldingJournal') : undefined} line={query.data!.line} groups={allGroups} initialSelection={explainSelection} stampOptions={stamps} stamp={selectedStamp} onClose={() => setShowCalculation(false)} onChoose={value => { choose(value); setShowCalculation(false) }} /> : null}
  </div>
}

function ScopeCaption({ scope }: { scope: ProgramSelection }) {
  const label = [scope.kind ? PROGRAM_DEMAND_LABELS[scope.kind] : '', scope.slice === 'all' ? '' : PROGRAM_SLICE_LABELS[scope.slice]].filter(Boolean).join(' · ')
  return label ? <span data-testid="program-scope-caption" className="text-xs text-slate-500">{label}</span> : null
}

function ScopeHost({ scopeKey, register }: { scopeKey: string; register: (key: string, element: HTMLDivElement | null) => void }) {
  const ref = useCallback((element: HTMLDivElement | null) => register(scopeKey, element), [scopeKey, register])
  return <div ref={ref} />
}

function Quota({ kind, demand: d, choose }: { kind: LineProgramDemandKind; demand: LineProgramDemandSummary; choose: (slice: ProgramSelection['slice']) => void }) {
  return <div className="text-[13px] leading-5"><button type="button" className={`${link} font-medium tabular-nums`} data-program-slice="covered" data-program-kind={kind} onClick={() => choose('covered')}>{PROGRAM_DEMAND_LABELS[kind]}: {Math.min(d.covered, d.actionableRequired)} / {d.actionableRequired}</button></div>
}
