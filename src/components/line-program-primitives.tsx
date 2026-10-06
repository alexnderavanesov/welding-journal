import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useRef } from 'react'

export const lineProgramQueryPolicy = { staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false } as const
export const programPrimaryActionClass = 'gap-2 border border-sky-700 bg-sky-700 text-white hover:bg-sky-800'
const programScopeButtonClass = 'inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border px-3 text-[13px] font-medium shadow-sm shadow-slate-900/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'
export const programScopeActionClass = `${programScopeButtonClass} border-sky-200 bg-white text-sky-800 hover:bg-sky-50`
export const programScopePrimaryActionClass = `${programScopeButtonClass} border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100`
export const programDisclosureClass = 'flex min-h-6 items-center gap-1.5 rounded px-1 text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'
export const programLinkClass = 'inline-flex min-h-6 min-w-6 items-center gap-1 rounded text-left text-sky-800 underline decoration-dotted underline-offset-4 hover:text-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500'
export const programMetricLabelClass = 'text-sm font-normal leading-[18px]'
export const programMetricValueClass = 'text-lg font-medium leading-6 tabular-nums'
export const programMetricDetailClass = 'text-sm leading-[18px]'

/** Observe geometry only; never fetch or rerender line data while scrolling/resizing. */
export function useProgramStickyHeight(variable: string) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = root.current, target = element?.parentElement
    if (!element || !target) return
    const update = () => target.style.setProperty(variable, `${element.getBoundingClientRect().height}px`)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [variable])
  return root
}

export function ProgramError({ error }: { error: Error }) { return <p role="alert" className="text-sm text-red-700">{error.message}</p> }

type QuotaSummary = { covered: number; actionableRequired: number; missing: number }

export function ProgramQuotaSummary({ common, pvk, onCommon, onPvk, fluid = false }: { common: QuotaSummary; pvk: QuotaSummary; onCommon: () => void; onPvk: () => void; fluid?: boolean }) {
  // Extra assignments at one stamp must not visually close another stamp's deficit.
  const percent = common.actionableRequired ? Math.min(100, Math.round((common.actionableRequired - common.missing) / common.actionableRequired * 100)) : 100
  return <div data-testid="program-quota-summary" className={`flex min-h-20 ${fluid ? 'min-w-0 w-full' : 'w-80 max-w-full shrink-0'} flex-col justify-center gap-1 rounded-lg border border-slate-200 bg-white p-1`} title="Зачтено в пределах нормы каждого клейма; лишние назначения другого клейма не закрывают недобор. Это покрытие нормы, а не число годных заключений.">
    {([{ label: `${PROGRAM_DEMAND_LABELS.common} · зачтено / нужно`, demand: common, onClick: onCommon }, { label: 'ПВК · зачтено / нужно', demand: pvk, onClick: onPvk }] as const).map(({ label, demand, onClick }, index) => <div key={label} className="space-y-1">
      <button type="button" data-section-metric={index === 0 ? 'common' : 'pvk'} onClick={onClick} aria-label={`${label} ${demand.covered} / ${demand.actionableRequired}`} className={`group flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left ${programMetricLabelClass} text-slate-500 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500`}>
        <span data-metric-label title={label} className="min-w-0 flex-1 truncate">{label}</span><span data-quota-value data-metric-value className="shrink-0 whitespace-nowrap text-base font-normal leading-6 tabular-nums text-slate-600">{demand.covered} / {demand.actionableRequired}</span><ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-sky-600" />
      </button>
      {index === 0 ? <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mx-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${common.missing ? 'bg-sky-500/70' : 'bg-emerald-500/70'}`} style={{ width: `${percent}%` }} /></div> : null}
    </div>)}
  </div>
}

/** Bounded numbered navigation; a one-page list has no redundant next button. */
export function ProgramPagination({ page, total, pageSize, onChange, noun }: { page: number; total: number; pageSize: number; onChange: (page: number) => void; noun: string }) {
  const count = Math.ceil(total / pageSize)
  const pages = [...new Set([0, page - 1, page, page + 1, count - 1])].filter((n) => n >= 0 && n < count).sort((a, b) => a - b)
  return <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs text-slate-500">
    <span>{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} из ${total} ${noun}` : `0 ${noun}`}</span>
    {count > 1 ? <nav aria-label={`Страницы ${noun}`} className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Предыдущая страница" disabled={!page} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      {pages.map((n, i) => <span key={n} className="flex items-center gap-1">{i > 0 && n > pages[i - 1] + 1 ? <span className="px-2">…</span> : null}<Button size="sm" variant={n === page ? 'secondary' : 'ghost'} aria-current={n === page ? 'page' : undefined} aria-label={`Страница ${n + 1}`} onClick={() => onChange(n)}>{n + 1}</Button></span>)}
      <Button variant="ghost" size="icon" aria-label="Следующая страница" disabled={page + 1 >= count} onClick={() => onChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </nav> : null}
  </div>
}
