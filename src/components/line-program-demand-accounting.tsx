import type { getProgramDemandAccounting } from '@/lib/line-program-accounting'

/** Mutually exclusive buckets make the arithmetic visible without counting methods twice. */
export function ProgramDemandAccounting({ accounting, quotaPlaces = false }: { accounting?: ReturnType<typeof getProgramDemandAccounting>; quotaPlaces?: boolean }) {
  if (!accounting) return null
  const a = accounting.assignments, c = accounting.coverage
  const buckets = (counts: typeof a) => <>только «да» {counts.yesOnly} + только «доп» {counts.additionalOnly} + совместно {counts.mixed}</>
  return <div className="space-y-1 text-[11px] leading-relaxed text-slate-500" aria-label="Состав назначения и зачёта">
    <p>Назначено стыков: <strong className="font-medium text-slate-700">{a.total}</strong> = {buckets(a)}</p>
    <p>{quotaPlaces ? 'Зачёт по нормам клейм' : 'Всего в зачёте'}: <strong className="font-medium text-slate-700">{c.total}</strong> = {buckets(c)}{c.other ? <> + факт / отмена без активного назначения {c.other}</> : null}</p>
    <p>«Совместно» — «да» и «доп» на одном стыке, считаем один раз.{quotaPlaces ? ' Один стык может закрывать место в норме каждого своего клейма.' : ''}</p>
  </div>
}
