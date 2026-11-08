import { useState } from 'react'
import { formatDisplayDate } from '@/lib/date-format'
import { Button } from './ui/button'

export type PreHeatTreatmentDocumentRow = {
  key: string; joint?: string; location?: string; method: string; kind: 'request' | 'result'
  name?: string | null; date?: string | null; result?: string | null; issues?: string[]
  removed?: number; remaining?: number
}

/** The same readable columns for existing facts, planned documents and deletion previews. */
export function PreHeatTreatmentDocumentTable({ rows, showJoints = true, showImpact = false }: {
  rows: PreHeatTreatmentDocumentRow[]; showJoints?: boolean; showImpact?: boolean
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / 50)), current = Math.min(page, pages - 1)
  return <div className="space-y-2">
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[760px] table-fixed text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-medium text-slate-600"><tr>
          {showJoints ? <th className="w-[22%] px-3 py-2.5">Стык</th> : null}
          <th className="w-20 px-3 py-2.5">Метод</th><th className="w-28 px-3 py-2.5">Документ</th>
          <th className="px-3 py-2.5">Название</th><th className="w-28 px-3 py-2.5">Дата</th>
          <th className="w-40 px-3 py-2.5">{showImpact ? 'После отключения' : 'Результат'}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.slice(current * 50, (current + 1) * 50).map(row => <tr key={row.key} className={row.issues?.length ? 'bg-rose-50' : 'bg-white'}>
          {showJoints ? <td className="break-words px-3 py-3 align-top"><span className="font-medium">{row.joint}</span>{row.location ? <div className="mt-1 text-xs text-slate-500">{row.location}</div> : null}</td> : null}
          <td className="px-3 py-3 align-top font-medium">{row.method}</td>
          <td className="px-3 py-3 align-top text-slate-600">{row.kind === 'request' ? 'Заявка' : 'Заключение'}</td>
          <td className="break-words px-3 py-3 align-top"><span>{row.name || '—'}</span>{row.issues?.map(message => <p key={message} className="mt-1 text-xs text-rose-700">{message}</p>)}</td>
          <td className="whitespace-nowrap px-3 py-3 align-top tabular-nums text-slate-600">{formatDisplayDate(row.date) || '—'}</td>
          <td className="px-3 py-3 align-top">{showImpact ? <>
            <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${row.remaining ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700'}`}>{row.remaining ? 'Сохранится' : 'Удалится целиком'}</span>
            <div className="mt-1 text-xs text-slate-500">Удалится позиций: {row.removed}{row.remaining ? `; останется: ${row.remaining}` : ''}</div>
          </> : row.result ? <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${row.result.toLowerCase() === 'годен' ? 'bg-emerald-50 text-emerald-800' : ['ремонт', 'вырез'].includes(row.result.toLowerCase()) ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{row.result}</span> : <span className="text-slate-400">—</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 ? <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={!current} onClick={() => setPage(current - 1)}>Предыдущие</Button><span className="text-xs text-slate-500">{current + 1} / {pages} · всего {rows.length}</span><Button type="button" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Следующие</Button></div> : null}
  </div>
}

export type PreHeatTreatmentFact = {
  rowId: number; joint?: string | null; location?: string; method: string
  request?: string | null; requestDate?: string | null; conclusion?: string | null; conclusionDate?: string | null; result?: string | null
}

export function preHeatTreatmentFactRows(facts: PreHeatTreatmentFact[], issues: Array<{ rowId: number; method?: string; message: string }> = []): PreHeatTreatmentDocumentRow[] {
  return facts.flatMap(fact => {
    const common = { joint: fact.joint ?? String(fact.rowId), location: fact.location, method: fact.method,
      issues: [...new Set(issues.filter(issue => issue.rowId === fact.rowId && (!issue.method || issue.method === fact.method)).map(issue => issue.message))] }
    const rows: PreHeatTreatmentDocumentRow[] = []
    if (fact.request || fact.requestDate) rows.push({ ...common, key: `${fact.rowId}:${fact.method}:request`, kind: 'request', name: fact.request, date: fact.requestDate })
    if (fact.conclusion || fact.conclusionDate || fact.result) rows.push({ ...common, key: `${fact.rowId}:${fact.method}:result`, kind: 'result', name: fact.conclusion, date: fact.conclusionDate, result: fact.result })
    return rows
  })
}
