import type { ReactNode } from 'react'
import type { LineProgramOverview } from '@/lib/line-program-overview'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { useProgramAppearance } from './line-program-appearance'

const metricBase = 'flex min-h-7 min-w-7 flex-wrap items-baseline justify-start gap-x-1.5 rounded px-1 py-0.5 text-left font-normal text-slate-600'
const metric = `${metricBase} hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500`
export function CompactLineMetrics({ overview: o, select, only }: { only: 'stamps' | 'joints' | 'common' | 'pvk' | 'missing' | 'excess' | 'reduction' | 'control'; overview: LineProgramOverview; select: (value: ProgramSelection) => void }) {
  const light = useProgramAppearance().appearance.theme === 'quartz'
  if (!o.common || !o.pvk) return null
  const missing = o.common.missing + o.pvk.missing, excess = o.common.excess + o.pvk.excess
  return <div data-testid="line-card-metrics" className="w-full min-w-0">
    {only === 'stamps' ? <Count label="Клейм" value={o.stamps} title="Количество клейм на линии" /> : null}
    {only === 'joints' ? <Count slice="all" label="Соединений" accessibleLabel="Учитываемых соединений" value={o.joints} title={`Физических соединений: ${o.joints}. Записей журнала: ${o.journalRows ?? o.joints}. R/W и заменённые исходные соединения не увеличивают физический итог; полный список сохраняет историю.`} onClick={() => select({ slice: 'all' })} /> : null}
    {only === 'common' || only === 'pvk' ? <div data-testid="program-quota-summary" className="contents">
      {(['common', 'pvk'] as const).filter(kind => only === kind).map(kind => {
        const d = o[kind]!, label = `${PROGRAM_DEMAND_LABELS[kind]} · зачтено / нужно`
        const progress = d.actionableRequired ? (d.actionableRequired - d.missing) / d.actionableRequired * 100 : 100
        return <button key={kind} type="button" data-program-slice="covered" data-program-kind={kind} data-line-metric className={`${metric} w-full !justify-start gap-y-1`} aria-label={`${label} ${d.covered} / ${d.actionableRequired}`} title={`${label}. Зачёт нормы, не количество годных заключений. Нажмите для просмотра стыков.`} onClick={() => select({ kind, slice: 'covered' })}>
          <span data-metric-label className="sr-only">{PROGRAM_DEMAND_LABELS[kind]}</span>
          <span data-quota-value className="whitespace-nowrap text-sm font-normal tabular-nums text-slate-700">{d.covered} / {d.actionableRequired}</span>
          <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1 w-full basis-full overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${d.missing ? 'bg-sky-400/70' : 'bg-emerald-400/70'}`} style={{ width: `${progress}%` }} /></span>
        </button>
      })}
    </div> : null}
    {only === 'missing' ? <Count slice="missing" label="К назначению" value={missing} detail={<><span className="whitespace-nowrap">РК/УЗК: {o.common.missing}</span>{' · '}<span className="whitespace-nowrap">ПВК: {o.pvk.missing}</span></>} tone={missing ? 'text-amber-900' : undefined} title={`Места потребности, не число разных стыков. ${PROGRAM_DEMAND_LABELS.common}: ${o.common.missing} · ПВК: ${o.pvk.missing}`} onClick={() => select({ slice: 'missing' })} /> : null}
    {only === 'excess' ? <Count slice="excess" label="Лишнее" value={excess} tone={excess ? 'text-rose-700' : undefined} onClick={() => select({ slice: 'excess' })} /> : null}
    {(only === 'reduction') && o.reducible > 0 ? <Count slice="reduction" label="Можно снять" accessibleLabel="Возможное сокращение" value={o.reducible} tone="text-amber-800" title="Возможное сокращение: назначения с жёлтым пунктиром. Можно снять вместе без нарушения норм." onClick={() => select({ slice: 'reduction' })} /> : <span aria-hidden="true" />}
    {only === 'reduction' && light && o.reducible === 0 ? <span data-line-metric data-program-slice="reduction" className={metricBase}><span data-metric-value>0</span></span> : null}
    {only === 'control' ? <div className="program-control-values">
      {o.approved > 0 ? <button type="button" data-program-slice="approved" aria-label={`Согласовано: ${o.approved}`} onClick={() => select({ slice: 'approved' })}>Согласовано: {o.approved}</button> : null}
      {o.additional > 0 ? <button type="button" data-program-slice="additional" aria-label={`Дополнительные стыки: ${o.additional}`} onClick={() => select({ slice: 'additional' })}>Доп: {o.additional}</button> : null}
    </div> : null}
  </div>
}

function Count({ slice, label, accessibleLabel = label, value, title, tone, detail, onClick }: { slice?: ProgramSelection['slice']; label: string; accessibleLabel?: string; value: ReactNode; title?: string; tone?: string; detail?: ReactNode; onClick?: () => void }) {
  const content = <><span data-metric-label className="sr-only">{label}</span><span data-metric-value className={`text-sm font-normal tabular-nums ${tone ?? 'text-slate-700'}`}>{value}</span>{detail ? <span data-testid="line-missing-breakdown" className="basis-full text-[11px] leading-4 text-slate-600">{detail}</span> : null}</>
  if (!onClick) return <div data-line-metric className={metricBase} title={title}>{content}</div>
  return <button type="button" data-program-slice={slice} data-line-metric className={`${metric} ${tone ?? ''}`} aria-label={`${accessibleLabel} ${value}`} title={title} onClick={onClick}>{content}</button>
}
