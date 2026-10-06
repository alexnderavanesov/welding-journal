import type { ProgramRowCounts, ProgramStatusFilter } from '@/lib/line-program-row-filters'
import { PROGRAM_STATUS_LABELS } from '@/lib/line-program-row-filters'

export type ProgramQuickFilter = 'all' | 'missing' | ProgramStatusFilter

/** Missing is quota places; unlike the status counts it is not a number of joint records. */
export function ProgramQuickFilters({ value, counts, missing, onChange, disabled = false }: {
  value: ProgramQuickFilter; counts?: ProgramRowCounts; missing?: number
  onChange: (value: ProgramQuickFilter) => void; disabled?: boolean
}) {
  const filters: ProgramQuickFilter[] = ['all', 'good', 'incomplete', 'rejected', 'missing', ...(counts?.error || value === 'error' ? ['error' as const] : [])]
  return <div role="group" aria-label="Фильтр стыков" className="flex min-w-0 flex-wrap items-center gap-1">
    {filters.map(filter => {
      const label = filter === 'all' ? 'Все' : filter === 'missing' ? 'К назначению' : PROGRAM_STATUS_LABELS[filter]
      const count = filter === 'missing' ? missing : counts?.[filter]
      return <button key={filter} type="button" data-program-filter={filter} aria-pressed={value === filter} disabled={disabled}
        aria-label={`Фильтр: ${label}${count != null ? ` ${count}` : ''}`}
        title={filter === 'missing' ? 'Места потребности, не число стыков. Показать доступные стыки для незакрытой потребности.' : filter === 'all' ? 'Все записи, включая неофициальные и неактуальные.' : 'По сохранённому итоговому статусу учитываемых записей. Зачёт нормы не означает годность.'}
        className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded border px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-50 ${value === filter ? filter === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800' : `border-transparent hover:bg-slate-50 ${filter === 'good' ? 'text-emerald-700' : 'text-slate-600'}`}`}
        onClick={() => onChange(filter)}>{label}{count != null ? <span className="font-normal tabular-nums opacity-80">{count}</span> : null}</button>
    })}
  </div>
}
