import { type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { programAssignment, type ProgramMethod } from '@/lib/line-program-workspace'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkDisplayValue, isLnkMethodNoNeed } from '@/lib/lnk-status'
import { LAYERED_CONTROL_DOCUMENT_PROFILES } from '@/lib/layered-control-documents'
import { getLineProgramOfficialStamps, isCompletedLineProgramResult, isRejectedLineProgramResult } from '@/lib/line-program-calculation'
import { calculateFinalStatus, normalizeResultStatus } from '@/lib/weld-status'
import { getSystemDocumentReferenceForField } from '@/lib/system-document-types'
import { formatDisplayDate } from '@/lib/date-format'
import { programDisclosureClass } from './line-program-primitives'
import { getControlAssignmentHistory } from '@/lib/control-assignment-history'

export const assignmentLabel = (value: string) => value === 'дополнительный' ? 'доп' : value || '—'
export const assignmentColor = (value: string) => value === 'да' ? 'bg-emerald-50 text-emerald-700' : value === 'дополнительный' ? 'bg-sky-50 text-sky-700' : value === 'отменен' ? 'bg-rose-50 text-rose-700' : 'text-slate-500'

export function removalLabel(row: WeldRow, method: ProgramMethod) {
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

export function HistoryBadge({ row, stage, onClick }: { row: WeldRow; stage: 'pre' | 'duplicates'; onClick: () => void }) {
  const controls = (stage === 'pre' ? row.preHeatTreatmentControls : row.duplicateControls) ?? []
  const rejected = controls.filter(control => isRejectedLineProgramResult(control.result))
  if (!controls.length || stage === 'pre' && !rejected.length) return null
  const name = stage === 'pre' ? 'НК до ТО' : 'Дубли'
  return <button type="button" data-control-stage={stage} className={`min-h-6 min-w-6 rounded px-1 text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${rejected.length ? 'bg-rose-50 text-rose-700' : 'text-sky-700'}`} onClick={onClick}>{name}{stage === 'pre' && row.preHeatTreatmentLnkEnabled === false ? ' · история, не учитывается' : ''}{rejected.length ? `: ${rejected.map(control => `${control.method} ${control.result}`).join(', ')}` : ` · ${controls.length}`}</button>
}

export function programResultDisplay(row: WeldRow, method: ProgramMethod | 'ВИК') {
    const profile = LNK_METHODS.find(item => item.code === method)
    const reference = profile ? getSystemDocumentReferenceForField(row, profile.conclusionKey) : null
    const layeredCount = method === 'Послойный ПВК' ? Object.values(LAYERED_CONTROL_DOCUMENT_PROFILES).filter(item => item.fieldKey.toLowerCase().includes('pvk') && (row[item.fieldKey] || row[item.idKey])).length : 0
    const value = method === 'Послойный ПВК' ? layeredCount ? `Заключения: ${layeredCount}/2` : row.layeredControlAssigned ? isCompletedLineProgramResult(row.pvkResult) ? 'Назначен · нет послойных заключений' : 'Назначен · ожидает основного ПВК' : '' : String(profile ? (isLnkMethodNoNeed(row, profile) ? getLnkDisplayValue(row, profile.resultKey) : row[profile.resultKey]) ?? '' : '')
    return { value, text: !value && !reference ? '' : `${method} ${value || 'Заключение'}${method !== 'ВИК' && programAssignment(row, method) === 'отменен' ? ' · назначение отменено' : ''}` }
}

export function ProgramResult({ row, method, onDetails }: { row: WeldRow; method: ProgramMethod | 'ВИК'; onDetails: () => void }): ReactNode {
    const { value, text } = programResultDisplay(row, method)
    if (!text) return null
    return <button type="button" className={`min-h-6 min-w-6 rounded text-left text-[13px] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${isRejectedLineProgramResult(value) ? 'text-rose-700' : normalizeResultStatus(value) === 'годен' ? 'text-emerald-700' : 'text-slate-600'}`} onClick={onDetails}>
      {text}</button>
  }

export function ProgramJointIdentity({ row, onDetails, expanded }: { row: WeldRow; onDetails: () => void; expanded?: boolean }) {
  return <><div className="flex min-w-0 items-center gap-1"><button type="button" title={String(row.joint || `#${row.id}`)} className={`${programDisclosureClass} min-w-0 text-sky-800`} aria-expanded={expanded} onClick={onDetails}>{expanded !== undefined ? expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}<span className="truncate">{String(row.joint || `#${row.id}`)}</span></button><span className="shrink-0 whitespace-nowrap text-xs text-slate-600">{String(row.connectionType ?? '')}</span><ProgramJointExclusions row={row} compact /></div>
        {calculateFinalStatus(row) === 'ошибка' ? <span className="mt-1 block text-xs text-rose-700">Ошибка данных контроля</span> : null}</>
}

export function ProgramJointMetadata({ row, stacked = false }: { row: WeldRow; stacked?: boolean }) {
  if (stacked) {
    const stamps = getLineProgramOfficialStamps(row)
    return <span className="flex flex-col text-xs leading-4 text-slate-500" data-testid="program-joint-metadata">
      <span>{row.weldDate ? <time dateTime={String(row.weldDate)} title="Дата сварки">{formatDisplayDate(row.weldDate)}</time> : 'ожидает сварку'}</span>
      <span className="flex flex-wrap gap-x-1">{stamps.length ? stamps.map((stamp, index) => <span key={stamp} className="break-all"><span>{stamp}</span>{index < stamps.length - 1 ? ', ' : ''}</span>) : 'нет клейма'}</span>
    </span>
  }
  return <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-slate-500" data-testid="program-joint-metadata">{row.weldDate ? <time dateTime={String(row.weldDate)} title="Дата сварки">{formatDisplayDate(row.weldDate)}</time> : 'ожидает сварку'} · {getLineProgramOfficialStamps(row).join(', ') || 'нет клейма'}</span>
}

export function ProgramJointExclusions({ row, compact = false }: { row: WeldRow; compact?: boolean }) {
  const exclusions = [
    String(row.officiality ?? '').trim().toLocaleLowerCase('ru') === 'неофициальный' ? 'Неофициальный' : null,
    String(row.revisionActuality ?? '').trim().toLocaleLowerCase('ru') === 'не актуален' ? 'Неактуальный' : null,
  ].filter(Boolean)
  return exclusions.length ? <span className={`inline-flex gap-1 ${compact ? 'shrink-0 whitespace-nowrap' : 'flex-wrap'}`} data-testid="program-joint-exclusions">{exclusions.map(label => <span key={label} title="Только для просмотра: не участвует в показателях программы линий. История стыка сохранена." className="rounded border border-slate-200 bg-slate-100/80 px-1 text-[11px] leading-4 text-slate-600">{label}</span>)}</span> : null
}
