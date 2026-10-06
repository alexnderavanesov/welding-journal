import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ProgramRemovalHints } from '@/lib/line-program-excess'
import type { WeldRow } from '@/lib/dispatcher-types'
import { PROGRAM_METHODS, PROGRAM_EDITOR_METHODS, programAssignment, isProgramRowClick, isProgramEditableRow, type ProgramMethod, type ProgramAssignment, PROGRAM_ASSIGNMENT_OPTIONS } from '@/lib/line-program-workspace'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkDisplayValue, isLnkMethodNoNeed } from '@/lib/lnk-status'
import { LAYERED_CONTROL_DOCUMENT_PROFILES } from '@/lib/layered-control-documents'
import { isAngularConnectionType } from '@/lib/connection-type'
import { getLineProgramOfficialStamps, isCompletedLineProgramResult, isRejectedLineProgramResult } from '@/lib/line-program-calculation'
import { calculateFinalStatus, normalizeResultStatus } from '@/lib/weld-status'
import { ProgramResultSummary } from './line-program-result-summary'
import { JointDetails } from './line-program-joint-details'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import { formatDisplayDate } from '@/lib/date-format'
import { ProgramPagination, programDisclosureClass } from './line-program-primitives'
import { getControlAssignmentHistory } from '@/lib/control-assignment-history'

const cell = 'border-b border-slate-100 px-2 py-1 align-middle text-left'
// Collapsed cell borders share one pixel between adjacent selected rows. Unlike
// inset outlines, they neither double the seam nor move controls on selection.
const assignmentCell = 'border-y border-slate-100 px-2 py-1 align-middle text-left first:border-l first:border-l-transparent last:border-r last:border-r-transparent'
const assignmentLabel = (value: string) => value === 'дополнительный' ? 'доп' : value || '—'
const assignmentColor = (value: string) => value === 'да' ? 'bg-emerald-50 text-emerald-700' : value === 'дополнительный' ? 'bg-sky-50 text-sky-700' : value === 'отменен' ? 'bg-rose-50 text-rose-700' : 'text-slate-500'

// Saved final status, not the assignment draft or any single good conclusion.
const jointStatusTone = (status: string) => status === 'годен' ? 'bg-emerald-50/70 hover:bg-emerald-100/60'
  : status.startsWith('не годен') ? 'bg-rose-50/70 hover:bg-rose-100/60' : ''

type RowContextMenu = (event: React.MouseEvent, row: WeldRow) => void
type Props = {
  approvedRowIds?: ReadonlySet<number>
  removalHints?: ProgramRemovalHints
  rows: WeldRow[]; selected: Set<number>; draft: Map<number, WeldRow>; busy: boolean
  canSelect: (row: WeldRow) => boolean; onSelect: (id: number, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onChange: (row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => void
  getError: (row: WeldRow, method: ProgramMethod, value: ProgramAssignment) => string
  onContextMenu?: RowContextMenu; focusedMethod?: ProgramMethod; focusedJoint?: number | null
}

/** Assignment edits with a read-only saved-result summary. Selection never applies values. */
export function ProgramAssignmentTable({ rows, selected, draft, busy, canSelect, onSelect, onSelectAll, onChange, getError, onContextMenu, focusedMethod, focusedJoint, removalHints, approvedRowIds }: Props) {
  const table = useRef<HTMLTableElement>(null)
  const [page, setPage] = useState(0)
  const pageSize = 50, actualPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1))
  const shown = rows.slice(actualPage * pageSize, (actualPage + 1) * pageSize)
  const focusedIndex = rows.findIndex(row => row.id === focusedJoint)
  useEffect(() => {
    if (focusedIndex >= 0) setPage(Math.floor(focusedIndex / pageSize))
  }, [focusedJoint, focusedIndex])
  useEffect(() => {
    if (focusedJoint == null) return
    const row = table.current?.querySelector<HTMLTableRowElement>(`tr[data-row-id="${focusedJoint}"]`)
    const body = row?.closest<HTMLElement>('[data-testid="assignment-dialog-body"]')
    if (row && body) body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - (table.current?.tHead?.offsetHeight ?? 0) - 8
  }, [focusedJoint, actualPage])
  const eligible = rows.filter(canSelect)
  const all = eligible.length > 0 && eligible.every(row => selected.has(row.id))
  const partly = !all && eligible.some(row => selected.has(row.id))
  const isHighlighted = (row?: WeldRow) => !!row && (focusedJoint === row.id || selected.has(row.id))
  return <div className="bg-white"><table ref={table} className="w-full min-w-[900px] border-collapse table-fixed text-sm" aria-label="Стыки и назначения всех методов">
    <colgroup><col className="w-11" /><col className="w-[22%]" />{PROGRAM_EDITOR_METHODS.map(method => <col key={method} />)}<col className="w-[23%]" /></colgroup>
    <thead data-testid="assignment-table-header" className={`sticky top-0 z-10 bg-slate-50 text-xs text-slate-600 ${isHighlighted(shown[0]) ? '[&_th]:border-b-sky-300' : 'shadow-[0_1px_0_#e2e8f0]'}`}><tr>
      <th className={assignmentCell}><input type="checkbox" className="h-4 w-4 accent-sky-600" aria-label="Выбрать все доступные стыки" ref={element => { if (element) element.indeterminate = partly }} checked={all} disabled={busy || !eligible.length} onChange={event => onSelectAll(event.target.checked)} /></th>
      <th className={assignmentCell}>Стык</th>{PROGRAM_EDITOR_METHODS.map(method => <th key={method} className={assignmentCell}>{method}</th>)}<th className={assignmentCell}>Результат</th>
    </tr></thead>
    <tbody>{shown.map((row, index) => {
      const status = calculateFinalStatus(row), tone = jointStatusTone(status)
      const highlighted = isHighlighted(row)
      const hasRepairHints = row.programRepairRequirements?.some(item => item.method !== 'ВИК')
      return <tr key={row.id} data-row-id={row.id} data-highlighted={highlighted || undefined} data-final-status={status} title={`Итоговое состояние: ${status}`} data-testid="line-program-joint" onContextMenu={event => onContextMenu?.(event, row)} onClick={event => { if (!busy && canSelect(row) && isProgramRowClick(event.target)) onSelect(row.id, !selected.has(row.id)) }} className={`cursor-pointer ${tone || (highlighted ? 'bg-sky-50' : 'even:bg-slate-50/40 hover:bg-sky-50/50')} ${highlighted ? '[&>td]:border-y-sky-300 [&>td:first-child]:border-l-sky-300 [&>td:last-child]:border-r-sky-300' : isHighlighted(shown[index + 1]) ? '[&>td]:border-b-sky-300' : ''}`}>
      <td className={assignmentCell}><input type="checkbox" className="h-4 w-4 accent-sky-600" aria-label={`Выбрать ${row.joint}`} checked={selected.has(row.id)} disabled={busy || !canSelect(row)} onChange={event => onSelect(row.id, event.target.checked)} /></td>
      <td className={assignmentCell}><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-semibold text-sky-800">{String(row.joint)}</span><span className="text-xs text-slate-500">{String(row.connectionType ?? '')}</span><ProgramJointExclusions row={row} />{approvedRowIds?.has(row.id) ? <span className="text-[11px] text-emerald-700" title="Есть сохранённое согласование контроля. Выберите стык, чтобы снять согласование без изменения назначений.">✓ Согласовано</span> : null}</div><ProgramJointMetadata row={row} stacked /></td>
      {PROGRAM_EDITOR_METHODS.map(method => {
        const old = programAssignment(row, method), value = programAssignment(draft.get(row.id) ?? row, method), dirty = old !== value
        const options = PROGRAM_ASSIGNMENT_OPTIONS.map(([option, label]) => ({ value: option, label, error: option === value ? '' : getError(row, method, option) }))
        const unavailable = method === 'Послойный ПВК' && !isAngularConnectionType(row.connectionType)
        const removalReason = options.find(option => option.value === '')?.error ?? ''
        const requirement = row.programRepairRequirements?.find(item => item.method === method)
        return <td key={method} className={assignmentCell}><div className="flex flex-col gap-0.5">
          {unavailable ? <span className="flex h-8 items-center text-slate-300">—</span> : <select aria-label={`${row.joint} · ${method}`} disabled={busy || !isProgramEditableRow(row)} value={value} onChange={event => onChange(row, method, event.target.value as ProgramAssignment)} data-removal-candidate={removalHints?.get(row.id)?.has(method) || undefined} title={requirement?.reason || removalHints?.get(row.id)?.get(method) || removalReason || 'Изменить назначение'} className={`h-8 w-full min-w-0 rounded-md border px-2 text-left text-xs ${removalHints?.get(row.id)?.has(method) ? 'border-dashed border-amber-400 ring-1 ring-inset ring-amber-200' : dirty ? 'border-dashed border-sky-500 bg-sky-50' : requirement ? 'border-amber-400 ring-1 ring-inset ring-amber-200' : 'border-slate-200'} ${assignmentColor(value)} ${focusedJoint === row.id && focusedMethod === method ? 'ring-2 ring-sky-300' : ''}`}>
            {options.map(option => <option key={option.value} value={option.value} disabled={!!option.error} title={option.error}>{option.value === '' ? 'Пусто' : option.label}</option>)}
          </select>}
          <div data-program-previous-assignment className="flex h-4">{dirty ? <span className="h-4 rounded bg-sky-100 px-1.5 text-[11px] font-semibold leading-4 text-sky-900">было: {assignmentLabel(old)}</span> : null}</div>
          {hasRepairHints ? <div data-program-repair-hint className="h-4">{requirement ? <span className="block truncate rounded px-1 text-[11px] leading-4 text-amber-800 ring-1 ring-amber-300" title={requirement.reason}>Обязательный метод</span> : null}</div> : null}
          {!requirement && !unavailable && removalReason ? <span className="sr-only">{removalLabel(row, method)}</span> : null}
        </div></td>
      })}
      <td className={assignmentCell}><ProgramResultSummary row={row} compact /></td>
    </tr>})}</tbody>
  </table>{!rows.length ? <p className="p-5 text-sm text-slate-500">В этой выборке нет стыков.</p> : null}{rows.length > pageSize ? <div className="px-3"><ProgramPagination page={actualPage} total={rows.length} pageSize={pageSize} onChange={next => { setPage(next); table.current?.closest('[data-testid="assignment-dialog-body"]')?.scrollTo?.({ top: 0 }) }} noun="стыков назначений" /></div> : null}</div>
}

function removalLabel(row: WeldRow, method: ProgramMethod) {
  if (method === 'Послойный ПВК') return 'Отдельное снятие комплекта'
  const config = LNK_METHODS.find(item => item.code === method)!
  const history = getControlAssignmentHistory(row, config.enabledKey)
  if (history?.includes('НК до ТО')) return 'Есть история НК до ТО'
  if (history?.includes('дубль')) return 'Есть дубль контроля'
  if (row[config.conclusionKey] || row[config.conclusionDateKey]) return 'Есть заключение'
  if (isCompletedLineProgramResult(row[config.resultKey])) return 'Есть результат'
  if (history) return 'Есть заявка'
  if (method === 'ПВК' && row.layeredControlAssigned) return 'Нужен для послойного'
  return 'Снятие недоступно'
}

function HistoryBadge({ row, stage, onClick }: { row: WeldRow; stage: 'pre' | 'duplicates'; onClick: () => void }) {
  const controls = (stage === 'pre' ? row.preHeatTreatmentControls : row.duplicateControls) ?? []
  const rejected = controls.filter(control => isRejectedLineProgramResult(control.result))
  if (!controls.length || stage === 'pre' && !rejected.length) return null
  const name = stage === 'pre' ? 'НК до ТО' : 'Дубли'
  return <button type="button" data-control-stage={stage} className={`min-h-6 min-w-6 rounded px-1 text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${rejected.length ? 'bg-rose-50 text-rose-700' : 'text-sky-700'}`} onClick={onClick}>{name}{stage === 'pre' && row.preHeatTreatmentLnkEnabled === false ? ' · история, не учитывается' : ''}{rejected.length ? `: ${rejected.map(control => `${control.method} ${control.result}`).join(', ')}` : ` · ${controls.length}`}</button>
}

function ProgramResult({ row, method, onDetails }: { row: WeldRow; method: ProgramMethod | 'ВИК'; onDetails: () => void }): ReactNode {
    const profile = LNK_METHODS.find(item => item.code === method)
    const reference = profile ? getSystemDocumentReferenceForField(row, profile.conclusionKey) : null
    const layeredCount = method === 'Послойный ПВК' ? Object.values(LAYERED_CONTROL_DOCUMENT_PROFILES).filter(item => item.fieldKey.toLowerCase().includes('pvk') && (row[item.fieldKey] || row[item.idKey])).length : 0
    const value = method === 'Послойный ПВК' ? layeredCount ? `Заключения: ${layeredCount}/2` : row.layeredControlAssigned ? isCompletedLineProgramResult(row.pvkResult) ? 'Назначен · нет послойных заключений' : 'Назначен · ожидает основного ПВК' : '' : String(profile ? (isLnkMethodNoNeed(row, profile) ? getLnkDisplayValue(row, profile.resultKey) : row[profile.resultKey]) ?? '' : '')
    if (!value && !reference) return null
    return <button type="button" className={`min-h-6 min-w-6 rounded text-left text-[13px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${isRejectedLineProgramResult(value) ? 'text-rose-700' : normalizeResultStatus(value) === 'годен' ? 'text-emerald-700' : 'text-slate-600'}`} onClick={onDetails}>
      {method} {value || 'Заключение'}{method !== 'ВИК' && programAssignment(row, method) === 'отменен' ? ' · назначение отменено' : ''}</button>
  }

function ProgramJointIdentity({ row, onDetails, expanded }: { row: WeldRow; onDetails: () => void; expanded?: boolean }) {
  return <><div className="flex min-w-0 items-center gap-1"><button type="button" title={String(row.joint || `#${row.id}`)} className={`${programDisclosureClass} min-w-0 text-sky-800`} aria-expanded={expanded} onClick={onDetails}>{expanded !== undefined ? expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}<span className="truncate">{String(row.joint || `#${row.id}`)}</span></button><span className="shrink-0 whitespace-nowrap text-xs text-slate-600">{String(row.connectionType ?? '')}</span><ProgramJointExclusions row={row} compact /></div>
        {calculateFinalStatus(row) === 'ошибка' ? <span className="mt-1 block text-xs text-rose-700">Ошибка данных контроля</span> : null}</>
}

function ProgramJointMetadata({ row, stacked = false }: { row: WeldRow; stacked?: boolean }) {
  if (stacked) {
    const stamps = getLineProgramOfficialStamps(row)
    return <span className="flex flex-col text-xs leading-4 text-slate-500" data-testid="program-joint-metadata">
      <span>{row.weldDate ? <time dateTime={String(row.weldDate)} title="Дата сварки">{formatDisplayDate(row.weldDate)}</time> : 'ожидает сварку'}</span>
      <span className="flex flex-wrap gap-x-1">{stamps.length ? stamps.map((stamp, index) => <span key={stamp} className="break-all"><span>{stamp}</span>{index < stamps.length - 1 ? ', ' : ''}</span>) : 'нет клейма'}</span>
    </span>
  }
  return <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-slate-500" data-testid="program-joint-metadata">{row.weldDate ? <time dateTime={String(row.weldDate)} title="Дата сварки">{formatDisplayDate(row.weldDate)}</time> : 'ожидает сварку'} · {getLineProgramOfficialStamps(row).join(', ') || 'нет клейма'}</span>
}

function ProgramJointExclusions({ row, compact = false }: { row: WeldRow; compact?: boolean }) {
  const exclusions = [
    String(row.officiality ?? '').trim().toLocaleLowerCase('ru') === 'неофициальный' ? 'Неофициальный' : null,
    String(row.revisionActuality ?? '').trim().toLocaleLowerCase('ru') === 'не актуален' ? 'Неактуальный' : null,
  ].filter(Boolean)
  return exclusions.length ? <span className={`inline-flex gap-1 ${compact ? 'shrink-0 whitespace-nowrap' : 'flex-wrap'}`} data-testid="program-joint-exclusions">{exclusions.map(label => <span key={label} title="Только для просмотра: не участвует в показателях программы линий. История стыка сохранена." className="rounded border border-slate-200 bg-slate-100/80 px-1 text-[11px] leading-4 text-slate-600">{label}</span>)}</span> : null
}

/** Compact saved values only. Clicking free row space toggles history, never assignments. */
export function ProgramReadOnlyTable({ rows, onAssignment, onContextMenu, removalHints }: { removalHints?: ProgramRemovalHints; rows: WeldRow[]; onAssignment: (id: number, method?: ProgramMethod) => void; onContextMenu?: RowContextMenu }) {
  const [details, setDetails] = useState(new Set<number>())
  const [page, setPage] = useState(0)
  const pageSize = 50, actualPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1))
  return <div className="max-h-[65vh] overflow-auto bg-white" data-testid="program-joint-scroll"><table className="w-full min-w-[1000px] table-fixed text-sm" aria-label="Назначения и результаты">
    <colgroup><col className="w-[21rem]" /><col className="w-[15%]" /><col className="w-[18%]" /><col /></colgroup>
    <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-600"><tr>{['Стык', 'Сварка / клейма', 'Назначения', 'Результаты'].map(label => <th key={label} className={cell}>{label}</th>)}</tr></thead>
    <tbody>{rows.slice(actualPage * pageSize, (actualPage + 1) * pageSize).map(row => {
      const toggle = () => setDetails(current => { const next = new Set(current); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next })
      const assignments = PROGRAM_METHODS.filter(method => method !== 'ВИК' && programAssignment(row, method))
      return <ReadOnlyJoint key={row.id} onContextMenu={onContextMenu} row={row} expanded={details.has(row.id)} onToggle={toggle}>
        <td className={cell}><ProgramJointIdentity row={row} expanded={details.has(row.id)} onDetails={toggle} /></td>
        <td className={cell}><ProgramJointMetadata row={row} /></td>
        <td className={cell}><div className="flex flex-wrap items-center gap-1" data-testid="assignment-badges">{assignments.length ? [(['РК', 'УЗК'] as const), (['ПВК'] as const), (['Послойный ПВК'] as const)].map((group, index) => <div key={index} className="contents">{group.filter(method => assignments.includes(method)).map(method => {
          const value = programAssignment(row, method)
          return <button type="button" key={method} data-removal-candidate={removalHints?.get(row.id)?.has(method) || undefined} title={removalHints?.get(row.id)?.get(method)} onClick={() => onAssignment(row.id, method)} aria-label={`Назначение ${row.joint} · ${method}: ${assignmentLabel(value)}`} className={`min-h-6 min-w-6 rounded border ${removalHints?.get(row.id)?.has(method) ? 'border-dashed border-amber-400' : 'border-transparent'} px-1 py-0.5 text-xs hover:ring-1 hover:ring-sky-300 focus-visible:ring-2 focus-visible:ring-sky-600 ${assignmentColor(value)}`}>{method}: {assignmentLabel(value)}</button>
        })}</div>) : <button type="button" onClick={() => onAssignment(row.id)} aria-label={`Назначение ${row.joint}: нет назначений`} className="min-h-7 min-w-7 justify-self-start rounded px-2 py-1 text-[13px] text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 hover:bg-sky-50 hover:text-sky-800">—</button>}</div></td>
        <td className={cell}><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><HistoryBadge row={row} stage="pre" onClick={toggle} />{PROGRAM_METHODS.map(method => <ProgramResult key={method} row={row} method={method} onDetails={toggle} />)}<HistoryBadge row={row} stage="duplicates" onClick={toggle} /></div></td>
      </ReadOnlyJoint>
    })}</tbody>
  </table>{!rows.length ? <p className="p-5 text-sm text-slate-500">В этой выборке нет стыков.</p> : null}{rows.length > pageSize ? <div className="px-3"><ProgramPagination page={actualPage} total={rows.length} pageSize={pageSize} onChange={setPage} noun="стыков списка" /></div> : null}</div>
}

function ReadOnlyJoint({ row, expanded, onToggle, onContextMenu, children }: { row: WeldRow; onContextMenu?: RowContextMenu; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  const status = calculateFinalStatus(row), tone = jointStatusTone(status)
  return <><tr data-testid="line-program-readonly-joint" data-joint={String(row.joint ?? '')} data-final-status={status} title={`Итоговое состояние: ${status}`} onContextMenu={event => onContextMenu?.(event, row)} onClick={event => { if (isProgramRowClick(event.target)) onToggle() }} className={`cursor-pointer ${tone || (expanded ? 'bg-sky-100/60' : 'even:bg-slate-50/40 hover:bg-sky-50/50')} ${expanded ? 'shadow-[inset_1px_0_0_#0284c7]' : ''}`}>{children}</tr>{expanded ? <tr><td colSpan={4} onContextMenu={event => onContextMenu?.(event, row)} className="border-b border-sky-200 bg-sky-50/60 py-2 pl-3 pr-2"><JointDetails row={row} /></td></tr> : null}</>
}
