import { useState } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import { programAssignment, PROGRAM_METHODS, type ProgramChange } from '@/lib/line-program-workspace'
import { ProgramPagination } from './line-program-primitives'

const label = (value: string) => value || 'Пусто'
export function ProgramChangeSummary({ changes, rows, draft }: { changes: ProgramChange[]; rows: ReadonlyMap<number, WeldRow>; draft: ReadonlyMap<number, WeldRow> }) {
  const [page, setPage] = useState(0)
  const entries = changes.flatMap(change => PROGRAM_METHODS.flatMap(method => {
    const before = programAssignment(rows.get(change.id)!, method), after = programAssignment(draft.get(change.id)!, method)
    return before === after ? [] : [{ id: `${change.id}:${method}`, joint: String(rows.get(change.id)!.joint ?? change.id), method, before, after }]
  }))
  const removed = entries.filter(e => !e.after).length, cancelled = entries.filter(e => e.after === 'отменен').length
  const added = entries.filter(e => !e.before && e.after && e.after !== 'отменен').length
  const changed = entries.length - removed - cancelled - added
  const actualPage = Math.min(page, Math.max(0, Math.ceil(entries.length / 30) - 1))
  return <details className="min-w-0 text-xs text-slate-600" aria-label="Состав изменений">
    <summary className="cursor-pointer rounded py-1 text-sky-800">{[`Добавить: ${added}`, `снять: ${removed}`, `отменить: ${cancelled}`, changed ? `изменить: ${changed}` : ''].filter(Boolean).join(' · ')}<span className="ml-2 text-slate-500">({changes.length} стыков)</span></summary>
    <div className="max-h-40 overflow-y-auto py-2">{entries.slice(actualPage * 30, actualPage * 30 + 30).map(entry => <p key={entry.id} className="py-0.5">{entry.joint} · {entry.method}: {label(entry.before)} → {label(entry.after)}</p>)}{entries.length > 30 ? <ProgramPagination page={actualPage} pageSize={30} total={entries.length} noun="изменений" onChange={setPage} /> : null}</div>
  </details>
}
