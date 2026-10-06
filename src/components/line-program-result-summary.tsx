import type { WeldRow } from '@/lib/dispatcher-types'
import { isRejectedLineProgramResult } from '@/lib/line-program-calculation'
import { calculateFinalStatus, normalizeResultStatus } from '@/lib/weld-status'
import { formatDisplayDate } from '@/lib/date-format'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { buildProgramHistory } from './line-program-joint-details'

const summaryMethods = new Set<string>(LNK_METHODS.map(method => method.code))

/** Saved facts only, no queries on render and no dependence on the assignment draft. */
export function ProgramResultSummary({ row, compact = false }: { row: WeldRow; compact?: boolean }) {
  if (compact) {
    const status = calculateFinalStatus(row)
    return <details onClick={event => event.stopPropagation()} className="text-xs">
      <summary className={`min-h-6 cursor-pointer rounded py-0.5 ${status === 'годен' ? 'text-emerald-700' : status.startsWith('не годен') || status === 'ошибка' ? 'text-rose-700' : 'text-slate-600'}`}>{status}<span className="ml-1 text-slate-400">· результаты</span></summary>
      <div className="py-1"><ProgramResultSummary row={row} /></div>
    </details>
  }
  const { sections, layered } = buildProgramHistory(row)
  // This assignment view contains only NK; the full PSTO/TVMT history remains unchanged.
  const shown = sections.map(section => ({ ...section, controls: section.controls.filter(control => summaryMethods.has(control.method)) })).filter(section => section.controls.length)
  return <div aria-label={`Результат ${row.joint}`} className="cursor-default space-y-1.5 text-[11px] leading-4" onClick={event => event.stopPropagation()}>
    {shown.map(section => <div key={section.title}>
      <p className="mb-0.5 text-[10px] text-slate-500">{section.title}{section.note ? ' · не учитывается' : ''}</p>
      <div className="flex flex-wrap gap-1">{section.controls.map(control => {
        const result = String(control.result || (control.conclusion ? 'заключение без результата' : control.request ? 'ожидает НК' : 'результата нет'))
        const tone = isRejectedLineProgramResult(result) || /^не\s+годен(?:\s|$)/i.test(result) ? 'bg-rose-50 text-rose-700' : normalizeResultStatus(result) === 'годен' ? 'bg-emerald-50 text-emerald-800' : result.includes('ожидает') ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'
        const title = [section.title, `${control.method}: ${result}`, control.conclusion ? `Заключение: ${control.conclusion} · ${formatDisplayDate(control.conclusionDate)}` : '', control.request ? `Заявка: ${control.request}` : '', control.defect ? `Дефекты: ${control.defect}` : '', section.note].filter(Boolean).join('\n')
        return <span key={control.id} title={title} className={`rounded px-1.5 py-0.5 ${tone}`}>
          {control.method}: {result}
        </span>
      })}</div>
    </div>)}
    {row.layeredControlAssigned || layered.length ? <p className="text-slate-500">Послойный: {layered.length ? `документов ${layered.length}/4` : 'ожидает заключений'}</p> : null}
    {!shown.length && !row.layeredControlAssigned && !layered.length ? <span className="text-slate-400">Нет результатов НК</span> : null}
  </div>
}
