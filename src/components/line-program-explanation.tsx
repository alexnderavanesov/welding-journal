import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLineProgramExplanation } from '@/server/line-program'
import { PROGRAM_EXPLANATION_LISTS, type ProgramExplanationList } from '@/lib/line-program-explanation'
import { ProgramPagination, lineProgramQueryPolicy } from './line-program-primitives'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import { ProgramCalculationSelect } from './line-program-calculation-select'

/** One active list, no hidden queries on mount/focus/reconnect or for collapsed lists. */
export function ProgramCalculationExplanation({ lineId, stamp, kind, list, onListChange, onReady, onOpenRow, onChoose }: { lineId: number; stamp?: string; kind: 'common' | 'pvk'; list: ProgramExplanationList; onListChange: (list: ProgramExplanationList) => void; onReady?: () => void; onOpenRow?: (id: number) => void; onChoose: (selection: ProgramSelection) => void }) {
  const [page, setPage] = useState(0)
  const query = useQuery({ queryKey: ['line-program', 'explanation', lineId, stamp ?? '', kind, list, page],
    queryFn: () => getLineProgramExplanation({ data: { id: lineId, stamp, kind, list, page } }), ...lineProgramQueryPolicy })
  useEffect(() => { if (query.data || query.error) onReady?.() }, [query.data, query.error, onReady])
  const slice: ProgramSelection['slice'] = list === 'physical' || list === 'sources' || list === 'excluded' || list === 'obligations' || list === 'protected' ? 'all' : list === 'overquota' ? 'excess' : list
  return <div className="mt-4 space-y-3 text-xs leading-5">
      <ProgramCalculationSelect label="Состав расчёта" ariaLabel={`Состав расчёта ${kind === 'common' ? 'РК/УЗК' : 'ПВК'}`} className="w-full sm:max-w-md" value={list} title={PROGRAM_EXPLANATION_LISTS[list]} onChange={value => onListChange(value as ProgramExplanationList)}>{Object.entries(PROGRAM_EXPLANATION_LISTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ProgramCalculationSelect>
      {query.isFetching ? <p role="status">Загрузка расчёта…</p> : query.error ? <p role="alert">{query.error instanceof Error ? query.error.message : 'Не удалось загрузить расчёт.'} <button type="button" onClick={() => void query.refetch()}>Повторить</button></p> : query.data ? <>
        <p className="rounded-lg bg-sky-50 p-3 text-slate-700">{query.data.explanation}</p>
        <p>{query.data.summary}</p>
        <ul>{query.data.math.map(text => <li key={text}>{text}</li>)}</ul>
        {query.data.mathGroupCount > 20 ? <p>Первые 20 групп; выберите клеймо для его полной математики.</p> : null}
        <p className="text-slate-500">{query.data.rules}</p>
        {query.data.issueCount > 0 ? <div role="status" className="rounded border border-amber-200 bg-amber-50 p-2">Проверьте целостность цепочек ({query.data.issueCount}): {query.data.issues.map(issue => issue.message).join(' ')}</div> : null}
        <ul className="divide-y divide-slate-200">{query.data.rows.map(row => <li key={row.id} className="py-1">{onOpenRow ? <button type="button" className="font-medium text-sky-700 underline decoration-dotted" aria-label={`Показать стык ${row.joint} в журнале`} onClick={() => onOpenRow(row.id)}>{row.joint}</button> : <span className="font-medium">{row.joint}</span>}{row.stamps ? ` · ${row.stamps}` : ''} — {row.reason}</li>)}</ul>
        {!query.data.total ? <p className="text-slate-500">В этой части расчёта нет стыков.</p> : null}
        <ProgramPagination page={query.data.page} total={query.data.total} pageSize={query.data.pageSize} onChange={setPage} noun="стыков" />
        <button type="button" className="rounded border border-slate-200 bg-white px-3 py-2 text-sky-700" onClick={() => onChoose({ stamp, kind, slice })}>{slice === 'all' ? 'Открыть все стыки группы' : 'Показать стыки в рабочей таблице'}</button>
      </> : null}
  </div>
}
