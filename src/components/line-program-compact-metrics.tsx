import type { ReactNode } from 'react'
import { ProgramControlDetails } from './line-program-control-details'
import type { LineProgramOverview } from '@/lib/line-program-overview'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import type { ProgramScopeMenuEvent } from './line-program-scope-menu'

const metricBase = 'flex min-h-7 min-w-0 flex-wrap items-baseline justify-center gap-x-1.5 rounded px-1 py-0.5 text-center font-normal text-slate-600'
const metric = `${metricBase} hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500`
export function CompactLineMetrics({ overview: o, select, onOpenMenu }: { overview: LineProgramOverview; select: (value: ProgramSelection) => void; onOpenMenu?: (event: ProgramScopeMenuEvent) => void }) {
  if (!o.common || !o.pvk) return null
  const missing = o.common.missing + o.pvk.missing, excess = o.common.excess + o.pvk.excess
  return <div className="program-line-metrics-container min-w-0"><div data-testid="line-card-metrics" className="program-line-metrics grid min-w-0 items-start gap-x-2 gap-y-1">
    <Count label="Клейм" value={o.stamps} title="Количество клейм на линии" />
    <Count slice="all" label="Соединений" accessibleLabel="Учитываемых соединений" value={o.joints} title={`Физических соединений: ${o.joints}. Записей журнала: ${o.journalRows ?? o.joints}. R/W и заменённые исходные соединения не увеличивают физический итог; полный список сохраняет историю.`} onClick={() => select({ slice: 'all' })} />
    <div data-testid="program-quota-summary" className="contents">
      {(['common', 'pvk'] as const).map(kind => {
        const d = o[kind]!, label = `${PROGRAM_DEMAND_LABELS[kind]} · зачтено / нужно`
        const progress = d.actionableRequired ? (d.actionableRequired - d.missing) / d.actionableRequired * 100 : 100
        return <button key={kind} type="button" data-program-slice="covered" data-program-kind={kind} data-line-metric className={`${metric} w-full max-w-40 justify-self-center !justify-between gap-y-1`} aria-label={`${label} ${d.covered} / ${d.actionableRequired}`} title={`${label}. Зачёт нормы, не количество годных заключений. Нажмите для просмотра стыков.`} onClick={() => select({ kind, slice: 'covered' })}>
          <span data-metric-label className="whitespace-nowrap text-xs">{PROGRAM_DEMAND_LABELS[kind]}</span>
          <span data-quota-value className="whitespace-nowrap text-sm font-normal tabular-nums text-slate-700">{d.covered} / {d.actionableRequired}</span>
          <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1 w-full basis-full overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${d.missing ? 'bg-sky-400/70' : 'bg-emerald-400/70'}`} style={{ width: `${progress}%` }} /></span>
        </button>
      })}
    </div>
    <Count slice="missing" label="К назначению" value={missing} detail={<><span className="whitespace-nowrap">РК/УЗК: {o.common.missing}</span>{' · '}<span className="whitespace-nowrap">ПВК: {o.pvk.missing}</span></>} tone={missing ? 'text-amber-900' : undefined} title={`Места потребности, не число разных стыков. ${PROGRAM_DEMAND_LABELS.common}: ${o.common.missing} · ПВК: ${o.pvk.missing}`} onClick={() => select({ slice: 'missing' })} />
    <Count slice="excess" label="Лишнее" value={excess} tone={excess ? 'text-rose-700' : undefined} onClick={() => select({ slice: 'excess' })} />
    {o.reducible > 0 ? <Count slice="reduction" label="Можно снять" accessibleLabel="Возможное сокращение" value={o.reducible} tone="text-amber-800" title="Возможное сокращение: назначения с жёлтым пунктиром. Можно снять вместе без нарушения норм." onClick={() => select({ slice: 'reduction' })} /> : <span aria-hidden="true" />}
    <div className="flex min-w-0 justify-end"><ProgramControlDetails onOpenMenu={onOpenMenu} labeled approved={o.approved} additional={o.additional} onApproved={() => select({ slice: 'approved' })} onAdditional={() => select({ slice: 'additional' })} /></div>
  </div></div>
}

function Count({ slice, label, accessibleLabel = label, value, title, tone, detail, onClick }: { slice?: ProgramSelection['slice']; label: string; accessibleLabel?: string; value: ReactNode; title?: string; tone?: string; detail?: ReactNode; onClick?: () => void }) {
  const content = <><span data-metric-label className="text-xs leading-4">{label}</span><span data-metric-value className={`text-sm font-normal tabular-nums ${tone ?? 'text-slate-700'}`}>{value}</span>{detail ? <span data-testid="line-missing-breakdown" className="basis-full text-[11px] leading-4 text-slate-600">{detail}</span> : null}</>
  if (!onClick) return <div data-line-metric className={metricBase} title={title}>{content}</div>
  return <button type="button" data-program-slice={slice} data-line-metric className={`${metric} ${tone ?? ''}`} aria-label={`${accessibleLabel} ${value}`} title={title} onClick={onClick}>{content}</button>
}
