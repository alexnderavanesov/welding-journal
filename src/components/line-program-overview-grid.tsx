import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { ColDef, GridApi, ICellRendererParams } from 'ag-grid-community'
import { Check, ChevronRight, Settings2 } from 'lucide-react'
import { Button } from './ui/button'
import { ProgramGrid } from './line-program-grid'
import { CompactLineMetrics } from './line-program-compact-metrics'
import { isLineProgramFinished, type LineProgramOverview } from '@/lib/line-program-overview'
import type { LineProgramRecord } from '@/lib/line-program'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import type { ProgramScopeMenuEvent } from './line-program-scope-menu'

type Program = LineProgramRecord & { overview?: LineProgramOverview }
type Props = { rows: Program[]; expanded: Map<number, Program>; onToggle: (line: Program) => void; onAssignments: (line: Program) => void; onEdit?: (line: Program) => void
  onSelect: (line: Program, selection: ProgramSelection) => void; onMenu: (event: ProgramScopeMenuEvent, line: Program) => void
  renderDetail: (line: Program) => ReactNode; onReady?: (api: GridApi) => void }
const Context = createContext<Props>(null!)
const Actions = createContext<Pick<Props, 'onSelect' | 'onAssignments' | 'onEdit'>>(null!)
function LineIdentity({ data: line }: ICellRendererParams<Program>) {
  const state = useContext(Context)
  if (!line) return null
  const o = line.overview, expanded = state.expanded.has(line.id), onToggle = () => state.onToggle(line)
  const details = [o && (line.configurationIssue || !o.common || !o.pvk) ? `Клейм: ${o.stamps}` : '', line.weldControlPercent === 100 ? '100% — вся линия' : '', line.pvkControlPercent !== line.weldControlPercent ? `ПВК ${line.pvkControlPercent ?? '—'}%` : ''].filter(Boolean).join(' · ')
  return <div className="program-line-identity w-full">      <button type="button" aria-label={`Расчёт линии ${line.line}`} aria-expanded={expanded} onClick={onToggle} className="flex w-full min-w-0 items-start gap-2 py-1 text-left">
        <span className="program-line-disclosure"><ChevronRight className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span data-testid="line-name" className="truncate whitespace-nowrap text-sm font-semibold text-[#317aa8]" title={line.line}>{line.line}</span><span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">{line.weldControlPercent == null ? '—' : `${line.weldControlPercent}%`}</span></span><span className="program-line-caption mt-1 flex min-h-8 min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5 text-xs text-slate-500" title={`${line.projectTitle || 'Без проекта'} · ${line.subtitleCode || 'Без шифра'}${details ? ` · ${details}` : ''}`}><span data-testid="line-description" className="min-w-0 break-words [overflow-wrap:anywhere]">{line.projectTitle || 'Без проекта'} · {line.subtitleCode || 'Без шифра'}{details ? ` · ${details}` : ''}</span></span></span>
      </button>
    {line.configurationIssue ? <p className="text-xs text-amber-800">{line.configurationIssue}</p> : null}
    {o?.integrityIssues ? <p className="text-xs text-amber-800">СП-09 · Нарушена целостность цепочки. Проверьте диспетчер и подробности расчёта; линия не завершена.</p> : null}
  </div>
}
function LineActions({ data: line }: ICellRendererParams<Program>) {
  const state = useContext(Actions)
  if (!line) return null
  const finished = !line.configurationIssue && isLineProgramFinished(line.overview), onEdit = state.onEdit ? () => state.onEdit!(line) : undefined
  return <div className="program-line-actions flex items-center justify-end gap-2">
    <button type="button" className="program-grid-button" disabled={!!line.configurationIssue} aria-label={`Открыть назначения линии ${line.line}`} onClick={() => state.onAssignments(line)}>Назначения</button>
    {finished || onEdit ? <div className={`col-start-2 row-start-1 flex flex-col items-center gap-1 self-stretch py-1 xl:col-start-3 ${finished ? 'justify-between' : 'justify-center'}`}>
        {finished ? <span data-testid="program-finished-label" role="img" aria-label="Линия завершена" title="Линия завершена" className="flex h-5 w-8 shrink-0 items-center justify-center text-emerald-700"><Check aria-hidden="true" className="h-4 w-4" /></span> : null}
        {onEdit ? <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-400 hover:text-sky-700" aria-label="Настроить" title="Настроить линию" onClick={onEdit}><Settings2 className="h-4 w-4" /></Button> : null}
      </div> : null}</div>
}
function LineMetric({ data: line, colDef }: ICellRendererParams<Program>) {
  const { onSelect } = useContext(Actions)
  return line?.overview && !line.configurationIssue ? <CompactLineMetrics overview={line.overview} only={colDef!.colId as 'stamps'} select={selection => onSelect(line, selection)} /> : null
}
const lineTone = (line: Program) => line.configurationIssue || (line.overview?.common?.missing ?? 0) + (line.overview?.pvk?.missing ?? 0) > 0 ? 'program-line-needs-work' : isLineProgramFinished(line.overview) ? 'program-line-finished' : 'program-line-neutral'
function LineDetail({ data }: ICellRendererParams<Program>) { const state = useContext(Context); return data ? <div className="program-line-detail-space"><section data-line={data.line} data-testid="line-program-detail" className={`program-grid-detail program-line-workspace ${lineTone(data)}`}>{state.renderDetail(data)}</section></div> : null }
const columns: ColDef<Program>[] = [
  { colId: 'line', field: 'line', lockVisible: true, headerName: 'Линия', width: 280, minWidth: 240, flex: 2, cellRenderer: LineIdentity, autoHeight: true },
  ...(['stamps', 'joints', 'common', 'pvk', 'missing', 'excess', 'reduction', 'control'] as const).map<ColDef<Program>>(key => ({
    colId: key, headerName: { stamps: 'Клейм', joints: 'Соединений', common: 'РК/УЗК · зачтено / нужно', pvk: 'ПВК · зачтено / нужно', missing: 'К назначению', excess: 'Лишнее', reduction: 'Можно снять', control: 'Контроль' }[key],
    width: key === 'control' || key === 'missing' ? 140 : key === 'common' || key === 'pvk' ? 135 : 100, minWidth: key === 'control' || key === 'missing' ? 130 : key === 'common' || key === 'pvk' ? 125 : key === 'joints' ? 122 : 90, flex: 1, cellRenderer: LineMetric, autoHeight: key === 'missing' || key === 'control',
    valueGetter: ({ data }) => { const o = data?.overview; if (!o) return ''; if (key === 'common' || key === 'pvk') return `${o[key]?.covered ?? 0} / ${o[key]?.actionableRequired ?? 0}`; if (key === 'control') return `Согласовано: ${o.approved}; дополнительных стыков: ${o.additional}`; if (key === 'missing' || key === 'excess') return (o.common?.[key] ?? 0) + (o.pvk?.[key] ?? 0); return key === 'reduction' ? o.reducible : o[key] },
  })),
  { colId: 'actions', headerName: 'Действия', width: 174, minWidth: 164, cellRenderer: LineActions, sortable: false, filter: false, enableRowGroup: false, lockVisible: true },
]
export function ProgramOverviewGrid(props: Props) {
  const current = useRef(props); current.current = props
  const canEdit = !!props.onEdit
  // Disclosure changes only identities/details. Stable action context keeps
  // every metric cell from rendering again when another line is opened.
  const actions = useMemo(() => ({
    onSelect: (line: Program, selection: ProgramSelection) => current.current.onSelect(line, selection),
    onAssignments: (line: Program) => current.current.onAssignments(line),
    onEdit: canEdit ? (line: Program) => current.current.onEdit?.(line) : undefined,
  }), [canEdit])
  return <Context.Provider value={props}><Actions.Provider value={actions}><ProgramGrid onReady={props.onReady} kind="lines" sessionKey="lines" label="Программа линий" contextLabel="Программа линий" rows={props.rows} columns={columns} getId={line => String(line.id)}
    detailRenderer={LineDetail} isExpanded={line => props.expanded.has(line.id)} onRowClick={props.onToggle} onRowMenu={props.onMenu}
    getRowClass={({ data }) => data ? `${lineTone(data)} ${props.expanded.has(data.id) ? 'program-line-open' : ''}` : ''}
    rowAttributes={line => ({ 'data-testid': 'line-program-card', title: !line.configurationIssue && isLineProgramFinished(line.overview) ? 'Линия завершена: назначения достаточны, все учитываемые стыки годны' : undefined, 'data-line': line.line, 'data-program-finished': String(!line.configurationIssue && isLineProgramFinished(line.overview)) })} />
  </Actions.Provider></Context.Provider>
}
