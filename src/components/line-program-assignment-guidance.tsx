import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { getLineProgramRowDemand, getLineProgramOfficialStamps, isLineProgramControlRow, type LineProgramStampCalculation } from '@/lib/line-program-calculation'
import type { LineProgramRecord } from '@/lib/line-program'
import type { WeldRow } from '@/lib/dispatcher-types'
import { matchesProgramScope } from '@/lib/line-program-workspace'
import { getProgramDemandAccounting } from '@/lib/line-program-accounting'
import { ProgramDemandAccounting } from './line-program-demand-accounting'

/** Quotas include the current draft; saved data is never changed by this projection. */
export function ProgramAssignmentGuidance({ groups, line, stamp, unassigned = false, rows, draft = false }: {
  groups: readonly LineProgramStampCalculation[]; line: LineProgramRecord; stamp?: string; unassigned?: boolean; rows?: readonly WeldRow[]; draft?: boolean
}) {
  return <div aria-label="Подсказка по назначениям" className="grid items-start gap-2 text-xs sm:grid-cols-2">
    <span className="text-[11px] text-slate-500 sm:col-span-2"><span className="inline-block min-w-[13rem]">{draft ? 'С учётом несохранённых изменений' : 'Сохранённые назначения'}</span> · В {PROGRAM_DEMAND_LABELS.common} засчитывается РК, УЗК или послойный контроль. {PROGRAM_DEMAND_LABELS.common} и ПВК — отдельные нормы; процентные нормы считаются по клеймам.</span>
    {(['common', 'pvk'] as const).map(kind => {
      const wholeLine = (kind === 'common' ? line.weldControlPercent : line.pvkControlPercent) === 100
      const relevant = groups.filter(group => wholeLine ? group.scope === 'line' : !unassigned && group.scope !== 'line' && (!stamp || group.stamp.toLocaleLowerCase('ru') === stamp.toLocaleLowerCase('ru')))
      // Sum each stamp's shortfall separately; extra control at another stamp cannot fill it.
      const members = rows?.filter(row => isLineProgramControlRow(row) && (wholeLine || matchesProgramScope(row, { stamp, unassigned })))
      const states = members?.map(row => ({ id: row.id, ...getLineProgramRowDemand(row, kind) }))
      const assignments = getProgramDemandAccounting({
        assignedRowIds: states ? states.filter(row => row.assigned).map(row => row.id) : relevant.flatMap(group => group[kind].assignedRowIds),
        additionalRowIds: states ? states.filter(row => row.additional).map(row => row.id) : relevant.flatMap(group => group[kind].additionalRowIds),
        coveredRowIds: [],
      }).assignments
      const coverage = relevant.map(group => getProgramDemandAccounting(group[kind]).coverage).reduce((total, counts) => {
        for (const key of ['yesOnly', 'additionalOnly', 'mixed', 'other', 'total'] as const) total[key] += counts[key]
        return total
      }, { yesOnly: 0, additionalOnly: 0, mixed: 0, other: 0, total: 0 })
      const assigned = assignments.total
      const required = relevant.reduce((sum, group) => sum + group[kind].actionableRequired, 0)
      const excess = new Set(relevant.flatMap(group => group[kind].excessRowIds)).size
      const planned = !wholeLine && members?.some(row => !row.weldDate || !getLineProgramOfficialStamps(row).length)
      const missing = relevant.reduce((sum, group) => sum + group[kind].missing, 0)
      const scope = wholeLine ? 'вся линия' : unassigned ? 'без клейма' : stamp ? `клеймо ${stamp}` : 'по клеймам'
      return <div key={kind} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid={`assignment-guidance-${kind}`}>
        <span className="font-medium text-slate-700">{PROGRAM_DEMAND_LABELS[kind]} · {scope}:</span>
        <span className="ml-auto whitespace-nowrap text-slate-600">Назначено: <strong className="text-sky-800">{assigned}</strong></span>
        <span className={`rounded px-1.5 py-0.5 font-medium ${missing ? 'bg-amber-100/70 text-amber-900' : 'text-slate-500'}`}>К назначению: {missing}</span>
        <div data-program-additional-hint className="min-h-[23px] w-full">{assignments.additionalOnly || assignments.mixed ? <details className="w-full border-t border-slate-100 pt-1.5"><summary className="cursor-pointer text-sky-700">Состав зачёта · с учётом «доп»</summary>
          <ProgramDemandAccounting accounting={{ assignments, coverage }} quotaPlaces={!wholeLine && !stamp && !unassigned} />
          <p className="mt-1 text-[11px] text-slate-600">Текущая норма: {required} · Обычных «да» сверх нормы: {excess}</p>
        </details> : null}</div>
        {planned ? <span className="w-full text-slate-500">Назначать можно заранее. В процентную норму стык войдёт после сварки и назначения клейма.</span> : null}
      </div>
    })}
    {!stamp && !unassigned && rows?.some(row => getLineProgramOfficialStamps(row).length > 1) ? <p className="text-[11px] text-slate-500 sm:col-span-2">Назначено — физические стыки. Процентная норма — сумма по клеймам: один общий стык может закрыть несколько мест. Избыток у одного клейма не закрывает недобор другого.</p> : null}
  </div>
}
