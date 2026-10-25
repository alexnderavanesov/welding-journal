import { Select } from '@/components/ui/select'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, memo, type MouseEvent, type KeyboardEvent } from 'react'
import type { ColDef, GridApi, ICellRendererParams, ValueGetterParams, SetFilterHandler } from 'ag-grid-community'
import type { ProgramRemovalHints } from '@/lib/line-program-excess'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PROGRAM_METHODS, PROGRAM_EDITOR_METHODS, programAssignment, isProgramEditableRow, type ProgramMethod, type ProgramAssignment, PROGRAM_ASSIGNMENT_OPTIONS } from '@/lib/line-program-workspace'
import { isAngularConnectionType } from '@/lib/connection-type'
import { formatDisplayDate } from '@/lib/date-format'
import { calculateFinalStatus } from '@/lib/weld-status'
import { getLineProgramOfficialStamps } from '@/lib/line-program-calculation'
import { ProgramGrid } from './line-program-grid'
import { useProgramSessionState } from './line-program-grid-session'
import { ProgramResultSummary } from './line-program-result-summary'
import { JointDetails } from './line-program-joint-details'
import { assignmentLabel, assignmentColor, removalLabel, ProgramJointMetadata, ProgramJointExclusions, ProgramJointIdentity, HistoryBadge, ProgramResult, programResultDisplay } from './line-program-joint-cells'

type RowContextMenu = (event: MouseEvent | KeyboardEvent, row: WeldRow) => void
export type ProgramAssignmentTableProps = {
  sessionKey?: string; approvedRowIds?: ReadonlySet<number>; removalHints?: ProgramRemovalHints
  rows: WeldRow[]; selected: Set<number>; draft: Map<number, WeldRow>; busy: boolean
  canSelect: (row: WeldRow) => boolean; onSelect: (id: number, checked: boolean) => void
  onSelectAll: (checked: boolean, visible: WeldRow[]) => void
  onFilterRows?: (rows: WeldRow[]) => void
  onChange: (row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => void
  getError: (row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => string
  onContextMenu?: RowContextMenu; focusedMethod?: ProgramMethod; focusedJoint?: number | null
}
const AssignmentContext = createContext<ProgramAssignmentTableProps>(null!)
function AssignmentIdentity({ data: row }: ICellRendererParams<WeldRow>) {
  const { approvedRowIds } = useContext(AssignmentContext)
  return row ? <div><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-semibold text-sky-800">{String(row.joint)}</span><span className="text-xs text-slate-500">{String(row.connectionType ?? '')}</span><ProgramJointExclusions row={row} />{approvedRowIds?.has(row.id) ? <span className="text-[11px] text-emerald-700" title="Есть сохранённое согласование контроля. Выберите стык, чтобы снять согласование без изменения назначений.">✓ Согласовано</span> : null}</div><ProgramJointMetadata row={row} stacked /></div> : null
}
function AssignmentCheckbox({ data: row }: ICellRendererParams<WeldRow>) {
  const { selected, busy, canSelect, onSelect } = useContext(AssignmentContext)
  return row ? <input type="checkbox" className="program-assignment-checkbox h-4 w-4 accent-sky-600" aria-label={`Выбрать ${row.joint}`} checked={selected.has(row.id)} disabled={busy || !canSelect(row)} onChange={event => onSelect(row.id, event.target.checked)} /> : null
}
function AssignmentEditor({ data: row, colDef }: ICellRendererParams<WeldRow>) {
  const { draft, busy, onChange, getError, focusedJoint, focusedMethod, removalHints } = useContext(AssignmentContext)
  if (!row) return null
  const method = colDef!.colId as ProgramMethod
  const hasRepairHints = row.programRepairRequirements?.some(item => item.method !== 'ВИК')
        const old = programAssignment(row, method), value = programAssignment(draft.get(row.id) ?? row, method), dirty = old !== value
        const options = PROGRAM_ASSIGNMENT_OPTIONS.map(([option, label]) => ({ value: option, label, error: option === value ? '' : getError(row, method, option) }))
        const unavailable = method === 'Послойный ПВК' && !isAngularConnectionType(row.connectionType)
        const removalReason = options.find(option => option.value === '')?.error ?? ''
        const requirement = row.programRepairRequirements?.find(item => item.method === method)
        return <div className="flex flex-col gap-0.5">
          {unavailable ? <span className="flex h-8 items-center text-slate-300">—</span> : <Select aria-label={`${row.joint} · ${method}`} disabled={busy || !isProgramEditableRow(row)} value={value} onChange={event => onChange(row, method, event.target.value as ProgramAssignment)} data-removal-candidate={removalHints?.get(row.id)?.has(method) || undefined} data-program-dirty={dirty || undefined} data-program-required={!!requirement || undefined} title={requirement?.reason || removalHints?.get(row.id)?.get(method) || removalReason || 'Изменить назначение'} className={`program-assignment-select h-8 w-full min-w-0 rounded-md border px-2 text-left text-xs ${removalHints?.get(row.id)?.has(method) ? 'border-dashed border-amber-400 ring-1 ring-inset ring-amber-200' : dirty ? 'border-dashed border-sky-500 bg-sky-50' : requirement ? 'border-amber-400 ring-1 ring-inset ring-amber-200' : 'border-slate-200'} ${assignmentColor(value)} ${focusedJoint === row.id && focusedMethod === method ? 'ring-2 ring-sky-300' : ''}`}>
            {options.map(option => <option key={option.value} value={option.value} disabled={!!option.error} title={option.error}>{option.value === '' ? 'Пусто' : option.label}</option>)}
          </Select>}
          <div data-program-previous-assignment className="flex h-4">{dirty ? <span className="h-4 rounded bg-sky-100 px-1.5 text-[11px] font-semibold leading-4 text-sky-900">было: {assignmentLabel(old)}</span> : null}</div>
          {hasRepairHints ? <div data-program-repair-hint className="h-4">{requirement ? <span className="block truncate rounded px-1 text-[11px] leading-4 text-amber-800 ring-1 ring-amber-300" title={requirement.reason}>Обязательный метод</span> : null}</div> : null}
          {!requirement && !unavailable && removalReason ? <span className="sr-only">{removalLabel(row, method)}</span> : null}
        </div>

}
function AssignmentResult({ data }: ICellRendererParams<WeldRow>) { return data ? <ProgramResultSummary row={data} compact /> : null }
const resultValues = (row: WeldRow) => [calculateFinalStatus(row), ...PROGRAM_METHODS.map(method => programResultDisplay(row, method).text)].filter(Boolean)
const resultValue = (row: WeldRow) => resultValues(row).join(' · ')
const rowClass = (row: WeldRow, highlighted = false) => [calculateFinalStatus(row) === 'годен' ? 'program-joint-good' : calculateFinalStatus(row).startsWith('не годен') ? 'program-joint-rejected' : '', highlighted ? 'program-joint-highlighted' : ''].join(' ')

/** Selection only marks records; all editing still uses the existing atomic draft validation. */
export function ProgramAssignmentTable(props: ProgramAssignmentTableProps) {
  const current = useRef(props); current.current = props
  const [api, setApi] = useState<GridApi<WeldRow> | null>(null)
  const [visible, setVisible] = useState(props.rows)
  const columns = useMemo<ColDef<WeldRow>[]>(() => [
    { colId: 'selection', headerName: 'Выбор', width: 76, minWidth: 64, sortable: false, filter: false, enableRowGroup: false, lockVisible: true, cellRenderer: AssignmentCheckbox },
    { colId: 'joint', field: 'joint', headerName: 'Стык', width: 220, minWidth: 165, flex: 1.3, autoHeight: true, cellRenderer: AssignmentIdentity },
    ...PROGRAM_EDITOR_METHODS.map(method => ({ colId: method, headerName: method, width: 150, minWidth: 120, flex: 1, autoHeight: true,
      valueGetter: ({ data }: ValueGetterParams<WeldRow>) => data ? programAssignment(current.current.draft.get(data.id) ?? data, method) : '', filterParams: { valueFormatter: ({ value }: { value: string }) => PROGRAM_ASSIGNMENT_OPTIONS.find(([key]) => key === value)?.[1] || 'Пусто' }, cellRenderer: AssignmentEditor })),
    { colId: 'results', headerName: 'Результат', width: 300, minWidth: 240, flex: 1, autoHeight: true, valueGetter: ({ data }) => data ? resultValue(data) : '', cellRenderer: AssignmentResult },
  ], [])
  useEffect(() => {
    if (!api || api.isDestroyed()) return
    api.refreshCells({ force: true })
    for (const method of PROGRAM_EDITOR_METHODS) api.getColumnFilterHandler<SetFilterHandler>(method)?.refreshFilterValues()
    api.onFilterChanged()
  }, [api, props.draft])
  useEffect(() => {
    if (!api || api.isDestroyed() || props.focusedJoint == null) return
    const node = api.getRowNode(String(props.focusedJoint))
    if (node) {
      if (node.rowIndex == null) api.setFilterModel(null)
      api.ensureNodeVisible(node, 'middle')
    }
  }, [api, props.focusedJoint, props.rows])
  const eligible = visible.filter(props.canSelect), all = !!eligible.length && eligible.every(row => props.selected.has(row.id)), partly = !all && eligible.some(row => props.selected.has(row.id))
  return <AssignmentContext.Provider value={props}><div className="program-assignment-grid" data-testid="assignment-grid">
    <ProgramGrid kind="assignments" sessionKey={props.sessionKey ?? 'assignments'} label="Стыки и назначения всех методов" rows={props.rows} columns={columns} getId={row => String(row.id)} virtual onReady={setApi}
      toolbar={<label className="flex items-center gap-2 text-xs"><input type="checkbox" className="program-assignment-checkbox h-4 w-4 accent-sky-600" aria-label="Выбрать все доступные стыки" ref={element => { if (element) element.indeterminate = partly }} checked={all} disabled={props.busy || !eligible.length} onChange={event => props.onSelectAll(event.target.checked, visible)} />Выбрать доступные в отборе</label>}
      onFilterRows={rows => { setVisible(previous => previous.length === rows.length && previous.every((row, i) => row === rows[i]) ? previous : rows); props.onFilterRows?.(rows) }}
      onRowClick={row => { if (!props.busy && props.canSelect(row)) props.onSelect(row.id, !props.selected.has(row.id)) }} onRowMenu={props.onContextMenu}
      getRowClass={({ data }) => data ? rowClass(data, props.focusedJoint === data.id || props.selected.has(data.id)) : ''}
      rowAttributes={row => ({ 'data-testid': 'line-program-joint', 'data-row-id': String(row.id), 'data-highlighted': props.focusedJoint === row.id || props.selected.has(row.id) ? 'true' : undefined, 'data-final-status': calculateFinalStatus(row), title: `Итоговое состояние: ${calculateFinalStatus(row)}` })} />
  </div></AssignmentContext.Provider>
}

type ReadProps = { sessionKey?: string; contextLabel?: string; removalHints?: ProgramRemovalHints; rows: WeldRow[]; onAssignment: (id: number, method?: ProgramMethod) => void; onContextMenu?: RowContextMenu }
const ReadContext = createContext<ReadProps & { toggle: (row: WeldRow) => void }>(null!)
const ReadExpansionContext = createContext<Set<number>>(new Set())
const ReadIdentityContent = memo(function ReadIdentityContent({ row, expanded, toggle }: { row: WeldRow; expanded: boolean; toggle: (row: WeldRow) => void }) {
  return <ProgramJointIdentity row={row} expanded={expanded} onDetails={() => toggle(row)} />
})
function ReadIdentity({ data }: ICellRendererParams<WeldRow>) {
  const { toggle } = useContext(ReadContext), details = useContext(ReadExpansionContext)
  return data ? <ReadIdentityContent row={data} expanded={details.has(data.id)} toggle={toggle} /> : null
}
// Expanding one history must not recalculate/decorate every saved row or redraw
// all result and assignment cells. These callbacks depend only on saved data.
const readRowClass = ({ data }: { data?: WeldRow }) => data ? rowClass(data) : ''
const readRowAttributes = (row: WeldRow) => ({ 'data-testid': 'line-program-readonly-joint', 'data-joint': String(row.joint ?? ''), 'data-final-status': calculateFinalStatus(row), title: `Итоговое состояние: ${calculateFinalStatus(row)}` })
function ReadMetadata({ data }: ICellRendererParams<WeldRow>) { return data ? <ProgramJointMetadata row={data} /> : null }
function ReadAssignments({ data: row }: ICellRendererParams<WeldRow>) {
  const { removalHints, onAssignment } = useContext(ReadContext)
  if (!row) return null
  const assignments = PROGRAM_METHODS.filter(method => method !== 'ВИК' && programAssignment(row, method))
  return <div className="flex flex-wrap items-center gap-1" data-testid="assignment-badges">{assignments.length ? [(['РК', 'УЗК'] as const), (['ПВК'] as const), (['Послойный ПВК'] as const)].map((group, index) => <div key={index} className="contents">{group.filter(method => assignments.includes(method)).map(method => {
          const value = programAssignment(row, method)
          return <button type="button" key={method} data-removal-candidate={removalHints?.get(row.id)?.has(method) || undefined} title={removalHints?.get(row.id)?.get(method)} onClick={() => onAssignment(row.id, method)} aria-label={`Назначение ${row.joint} · ${method}: ${assignmentLabel(value)}`} className={`min-h-6 min-w-6 rounded border ${removalHints?.get(row.id)?.has(method) ? 'border-dashed border-amber-400' : 'border-transparent'} px-1 py-0.5 text-xs hover:ring-1 hover:ring-sky-300 focus-visible:ring-2 focus-visible:ring-sky-600 ${assignmentColor(value)}`}>{method}: {assignmentLabel(value)}</button>
        })}</div>) : <button type="button" onClick={() => onAssignment(row.id)} aria-label={`Назначение ${row.joint}: нет назначений`} className="min-h-7 min-w-7 justify-self-start rounded px-2 py-1 text-[13px] text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 hover:bg-sky-50 hover:text-sky-800">—</button>}</div>
}
function ReadResults({ data: row }: ICellRendererParams<WeldRow>) {
  const { toggle: toggleRow } = useContext(ReadContext)
  if (!row) return null
  const toggle = () => toggleRow(row)
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><HistoryBadge row={row} stage="pre" onClick={toggle} />{PROGRAM_METHODS.map(method => <ProgramResult key={method} row={row} method={method} onDetails={toggle} />)}<HistoryBadge row={row} stage="duplicates" onClick={toggle} /></div>
}
function ReadDetails({ data }: ICellRendererParams<WeldRow>) { return data ? <div className="program-grid-detail"><JointDetails row={data} /></div> : null }
const readColumns: ColDef<WeldRow>[] = [
  { colId: 'joint', field: 'joint', headerName: 'Стык', width: 350, minWidth: 350, flex: 1.2, autoHeight: true, cellRenderer: ReadIdentity },
  { colId: 'welding', headerName: 'Сварка / клейма', width: 200, minWidth: 140, flex: 1, autoHeight: true, valueGetter: ({ data }) => data ? `${data.weldDate ? formatDisplayDate(data.weldDate) : 'ожидает сварку'} · ${getLineProgramOfficialStamps(data).join(', ')}` : '', cellRenderer: ReadMetadata },
  { colId: 'assignments', headerName: 'Назначения', filterValueGetter: ({ data }) => data ? PROGRAM_EDITOR_METHODS.map(method => `${method}: ${assignmentLabel(programAssignment(data, method))}`) : [], width: 220, minWidth: 150, flex: 1.1, autoHeight: true, valueGetter: ({ data }) => data ? PROGRAM_EDITOR_METHODS.map(method => `${method}: ${programAssignment(data, method) || '—'}`).join(' · ') : '', cellRenderer: ReadAssignments },
  { colId: 'results', headerName: 'Результаты', filterValueGetter: ({ data }) => data ? resultValues(data) : [], width: 450, minWidth: 260, flex: 2.4, autoHeight: true, valueGetter: ({ data }) => data ? resultValue(data) : '', cellRenderer: ReadResults },
]

/** Saved values only. Joint lists under stamps use the common page scroll. */
export const ProgramReadOnlyTable = memo(function ProgramReadOnlyTable(props: ReadProps) {
  const sessionKey = props.sessionKey ?? 'joints'
  const [details, setDetails] = useProgramSessionState(`details:${sessionKey}`, new Set<number>())
  const toggle = useCallback((row: WeldRow) => setDetails(previous => { const next = new Set(previous); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next }), [setDetails])
  const actions = useMemo(() => ({ ...props, toggle }), [props.rows, props.onAssignment, props.onContextMenu, props.removalHints, props.sessionKey, props.contextLabel, toggle])
  return <ReadContext.Provider value={actions}><ReadExpansionContext.Provider value={details}><div data-testid="program-joint-scroll">
    <ProgramGrid kind="joints" sessionKey={sessionKey} label="Назначения и результаты" contextLabel={props.contextLabel} rows={props.rows} columns={readColumns} getId={row => String(row.id)}
      detailRenderer={ReadDetails} isExpanded={row => details.has(row.id)} onRowClick={toggle} onRowMenu={props.onContextMenu}
      getRowClass={readRowClass} rowAttributes={readRowAttributes} />
  </div></ReadExpansionContext.Provider></ReadContext.Provider>
})
