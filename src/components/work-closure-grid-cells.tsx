import { closureColumns, type ClosureDimension } from '@/lib/work-closure-columns'
import type { WeldRow } from '@/lib/dispatcher-types'

export function WorkClosureGridCell({ dimension, row, onOpen }: {
  dimension: ClosureDimension
  row: WeldRow
  onOpen: () => void
}) {
  const column = closureColumns[dimension]
  const value = String(row[column.key] ?? '')
  const positions = value ? value.split('\n') : []
  const label = dimension === 'workType' ? 'Закрытие работ' : column.label

  return <button type="button" aria-label={label + ' · ' + row.joint} title=""
    data-journal-tip-title={value ? column.label : undefined} data-journal-tip-list={value || undefined}
    className="flex h-full w-full min-w-0 items-center text-left text-xs text-sky-800 hover:text-sky-950" onClick={onOpen}>
    {positions.length ? <span className="block w-full truncate">{positions.map((text, i) =>
      <span key={i} className="not-first:ml-1.5">{i > 0 && ' '}{positions.length > 1 &&
        <span className="text-[11px] font-medium tabular-nums text-slate-500">{i + 1}. </span>}{text}</span>)}</span>
      : <span className="text-slate-400">—</span>}
  </button>
}
