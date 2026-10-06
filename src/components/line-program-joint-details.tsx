import { getCancelledLnkResultDisplay, getCancelledPstoResultDisplay, isCancelledControlValue } from '@/lib/report-value-utils'
import { Fragment } from 'react'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isRejectedLineProgramResult } from '@/lib/line-program-calculation'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { getLnkDisplayValue, isLnkMethodNoNeed } from '@/lib/lnk-status'
import { getPreHeatTreatmentHistoryNote, isPreHeatTreatmentLnkMethodCode, isPreHeatTreatmentMethodNoNeed } from '@/lib/lnk-control-stage'
import { LAYERED_CONTROL_DOCUMENT_PROFILES } from '@/lib/layered-control-documents'
import { normalizeResultStatus } from '@/lib/weld-status'
import { buildPstoCycleTimeline, getRetainedPstoRequestNote, getRetainedPstoCycleLabel } from '@/lib/psto-cycle'
import { getSystemDocumentReferenceForField, type SystemDocumentReference } from '@/lib/system-document-types'
import { ProgramDocumentLink, type ProgramDocument } from './line-program-document-link'
import { CONTROL_ASSIGNMENT_BASIS_FIELDS } from '@/lib/control-assignment-basis'

const text = (value: unknown) => String(value ?? '').trim()
const rejected = (value: unknown) => isRejectedLineProgramResult(value) || /^не\s+годен(?:\s|$)/i.test(text(value))
const resultColor = (value: unknown) => rejected(value) ? 'font-medium text-rose-700' : normalizeResultStatus(value) === 'годен' ? 'text-emerald-700' : 'text-slate-600'
type HistoryControl = { id: string | number; method: string; result?: unknown; request?: unknown; requestDate?: unknown; conclusion?: unknown; conclusionDate?: unknown; defect?: unknown; controlDate?: unknown; note?: unknown; requestDocument?: ProgramDocument; conclusionDocument?: ProgramDocument }
const resultTone = (control: HistoryControl) => {
  if (rejected(control.result)) return 'bg-rose-50/80'
  if (normalizeResultStatus(control.result) === 'годен') return 'bg-emerald-50/70'
  if (text(control.result).toLocaleLowerCase('ru').includes('ожида') || (!text(control.result) && (text(control.request) || text(control.requestDate)))) return 'bg-amber-50/70'
  return 'bg-slate-50'
}
const present = (control: HistoryControl) => [control.result, control.request, control.requestDate, control.conclusion, control.conclusionDate, control.defect, control.controlDate, control.note].some(value => text(value))
const document = (reference: SystemDocumentReference | null): ProgramDocument | undefined => reference ? { reference } : undefined
const reference = (type: SystemDocumentReference['type'], title: unknown, date: unknown, scope: Partial<SystemDocumentReference> = {}) => text(title) ? document({ type, title: text(title), date: text(date), ...scope }) : undefined

export function buildProgramHistory(row: WeldRow) {
  const resultDisplay = (method: string, result: unknown) => {
    const definition = LNK_METHODS.find(entry => entry.code === method)
    return definition && isCancelledControlValue(row[definition.enabledKey]) ? getCancelledLnkResultDisplay(result) : result
  }
  const pre = row.preHeatTreatmentControls ?? []
  const duplicates = row.duplicateControls ?? []
  const layered = Object.values(LAYERED_CONTROL_DOCUMENT_PROFILES).filter(profile => row[profile.fieldKey] || row[profile.idKey])
  const sections: { title: string; note?: string; controls: HistoryControl[] }[] = []
  if (pre.length) sections.push({ title: 'НК до ТО', note: getPreHeatTreatmentHistoryNote(row), controls: pre.map(c => ({
    id: c.id, method: c.method, result: resultDisplay(c.method, isPreHeatTreatmentLnkMethodCode(c.method) && isPreHeatTreatmentMethodNoNeed(row, c.method) ? 'нет потребности' : c.result), request: c.requestName, requestDate: c.requestDate, conclusion: c.conclusionName, conclusionDate: c.conclusionDate, defect: c.defectDescription,
    requestDocument: reference('lnkRequest', c.requestName, c.requestDate, { sourceKind: 'beforeHeatTreatment' }),
    conclusionDocument: reference('lnkConclusion', c.conclusionName, c.conclusionDate, { sourceKind: 'beforeHeatTreatment', methodCode: c.method }),
  })) })
  const cycles = buildPstoCycleTimeline(row, row.pstoRepeatCycles)
  if (cycles.length) sections.push({ title: 'ПСТО и ТВМТ', note: getRetainedPstoRequestNote(row), controls: cycles.flatMap(c => {
    const scope = { sourceKind: 'pstoCycle' as const, cycleSequences: [c.sequence] }
    const suffix = cycles.length > 1 ? ` · цикл ${c.sequence}` : ''
    const historyLabel = getRetainedPstoCycleLabel(row, c)
    return [
      { id: `psto-${c.sequence}`, method: `ПСТО${suffix}`, result: historyLabel ?? (isCancelledControlValue(row.pstoRequired) ? getCancelledPstoResultDisplay(c.pstoResult) : c.pstoResult), request: c.pstoRequest, requestDate: c.pstoRequestDate, conclusion: c.heatTreatmentDiagram, conclusionDate: c.pstoDate, note: c.pstoNote,
        requestDocument: reference('pstoRequest', c.pstoRequest, c.pstoRequestDate, scope), conclusionDocument: reference('pstoConclusion', c.heatTreatmentDiagram, c.pstoDate, scope) },
      { id: `tvmt-${c.sequence}`, method: `ТВМТ${suffix}`, result: historyLabel ? undefined : isCancelledControlValue(row.pstoRequired) ? getCancelledLnkResultDisplay(c.tvmtResult) : c.tvmtResult, request: c.tvmtRequest, requestDate: c.tvmtRequestDate, conclusion: c.tvmtConclusion, conclusionDate: c.tvmtConclusionDate,
        requestDocument: reference('lnkRequest', c.tvmtRequest, c.tvmtRequestDate, { ...scope, methodCode: 'ТВМТ' }), conclusionDocument: reference('lnkConclusion', c.tvmtConclusion, c.tvmtConclusionDate, { ...scope, methodCode: 'ТВМТ' }) },
    ].filter(present)
  }) })
  sections.push({ title: 'Основной этап', controls: LNK_METHODS.map(method => ({
    id: method.code, method: method.code, result: isLnkMethodNoNeed(row, method) ? getLnkDisplayValue(row, method.resultKey) : resultDisplay(method.code, row[method.resultKey]), request: row[method.requestKey], requestDate: row[method.requestDateKey], conclusion: row[method.conclusionKey], conclusionDate: row[method.conclusionDateKey], defect: row[method.defectDescriptionKey],
    requestDocument: document(getSystemDocumentReferenceForField(row, method.requestKey)), conclusionDocument: document(getSystemDocumentReferenceForField(row, method.conclusionKey)),
  })).filter(present) })
  // Duplicate conclusion numbers are external facts, not references to a primary-stage document.
  if (duplicates.length) sections.push({ title: 'Дубли контроля', controls: duplicates.map(c => ({ id: c.id, method: c.method, result: resultDisplay(c.method, c.result), conclusion: c.conclusion, conclusionDate: c.conclusionDate, controlDate: c.controlDate })) })
  return { sections, layered }
}

export function JointDetails({ row }: { row: WeldRow }) {
  const { sections, layered } = buildProgramHistory(row)
  return <div className="space-y-3 rounded-r-lg border border-sky-100 border-l border-l-sky-500 bg-white p-3 text-xs" aria-label={`История контроля ${row.joint}`}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-sky-100 pb-2"><span className="font-semibold text-sky-900">Стык {String(row.joint || `#${row.id}`)}</span>{row.line ? <span className="text-slate-500">· {String(row.line)}</span> : null}<span className="text-slate-500">· История контроля</span></div>
    <table className="w-full table-fixed text-left" aria-label={`Этапы контроля ${row.joint}`}>
      <colgroup><col className="w-[20%]" /><col className="w-[29%]" /><col className="w-[29%]" /><col className="w-[22%]" /></colgroup>
      <thead className="text-[11px] text-slate-500"><tr>{['Контроль', 'Заявка', 'Заключение', 'Дефекты'].map(label => <th key={label} className="px-2 pb-1 font-normal">{label}</th>)}</tr></thead>
      <tbody>{sections.map(section => <Fragment key={section.title}>
        <tr><th colSpan={4} className="border-t border-sky-100 px-2 pb-1 pt-3"><h4 className="font-semibold text-slate-800">{section.title}</h4>{section.note ? <p className="mt-1 font-normal text-amber-800">{section.note}</p> : null}</th></tr>
        {section.controls.length ? section.controls.map(control => <tr key={control.id} data-testid="control-history-row" className={`align-top text-slate-600 ${resultTone(control)}`}>
          <td className="break-words px-2 py-1.5"><span className={resultColor(control.result)}>{control.method}: {text(control.result) || 'результата нет'}</span>{text(control.controlDate) ? <p className="mt-1 text-slate-500">Контроль: {formatDisplayDate(control.controlDate)}</p> : null}{text(control.note) ? <p className="mt-1 text-slate-500">{text(control.note)}</p> : null}</td>
          <td className="px-2 py-1.5"><HistoryDocument title={control.request} date={control.requestDate} document={control.requestDocument} label="Заявка" /></td>
          <td className="px-2 py-1.5"><HistoryDocument title={control.conclusion} date={control.conclusionDate} document={control.conclusionDocument} label="Заключение" /></td>
          <td className="break-words px-2 py-1.5">{text(control.defect) || <span className="text-slate-400">—</span>}</td>
        </tr>) : <tr><td colSpan={4} className="px-2 py-2 text-slate-500">Нет заявок и результатов.</td></tr>}
      </Fragment>)}</tbody>
    </table>
    {CONTROL_ASSIGNMENT_BASIS_FIELDS.some(field => text(row[field.basisKey])) ? <section className="border-t border-slate-100 px-2 py-2"><h4 className="font-medium text-slate-700">Основания назначений</h4>{CONTROL_ASSIGNMENT_BASIS_FIELDS.filter(field => text(row[field.basisKey])).map(field => <p key={field.basisKey} className="mt-1 whitespace-pre-wrap break-words text-slate-600">{field.code}: {text(row[field.basisKey])}</p>)}</section> : null}
    {row.layeredControlAssigned || layered.length ? <section className="border-t border-sky-100 px-2 pt-3"><h4 className="mb-1 font-semibold text-slate-800">Послойный контроль</h4>
      <p className="text-slate-600">{row.layeredControlAssigned ? 'Назначен' : 'Сохранённые документы без текущего назначения'} · документов: {layered.length} / 4</p>
      {layered.map(profile => <p key={profile.idKey} className="mt-1 break-words text-slate-600">{profile.templateLabel}: {row[profile.idKey] ? <ProgramDocumentLink document={{ row, field: profile.fieldKey }}>{text(row[profile.fieldKey]) || `Документ №${row[profile.idKey]}`}</ProgramDocumentLink> : text(row[profile.fieldKey])}</p>)}
    </section> : null}
  </div>
}

function HistoryDocument({ title, date, document, label }: { title: unknown; date: unknown; document?: ProgramDocument; label: string }) {
  if (!text(title) && !text(date)) return <span className="text-slate-400">—</span>
  return <div className="break-words" aria-label={`${label}: ${text(title) || 'без номера'}`}>
    {document ? <ProgramDocumentLink document={document}>{text(title)}</ProgramDocumentLink> : <span>{text(title) || 'без номера'}</span>}
    {text(date) ? <p className="mt-1 text-[11px] text-slate-500">{formatDisplayDate(date)}</p> : null}
  </div>
}
