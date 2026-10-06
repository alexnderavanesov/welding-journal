import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'
import type { LineProgramRecord } from '@/lib/line-program'
import type { LineProgramDemandSummary } from '@/lib/line-program-overview'
import type { ProgramSelection } from '@/lib/line-program-workspace'
import { ProgramDemandAccounting } from './line-program-demand-accounting'
import { ProgramCalculationExplanation } from './line-program-explanation'
import { PROGRAM_EXPLANATION_LISTS, type ProgramExplanationList } from '@/lib/line-program-explanation'
import { ProgramCalculationSelect } from './line-program-calculation-select'

type CalculationGroup = {
  stamp: string; scope: string; welderName?: string
  common: LineProgramDemandSummary & { reducible?: number }; pvk: LineProgramDemandSummary & { reducible?: number }
}
type Props = {
  line: LineProgramRecord; groups: CalculationGroup[]; stamp?: string; stampOptions?: { stamp: string }[]
  onClose: () => void; onChoose: (selection: ProgramSelection) => void
  onOpenRow?: (id: number) => void
  initialSelection?: ProgramSelection
}

export function LineProgramCalculationDialog({ line, groups, stamp, stampOptions, initialSelection, onClose, onChoose, onOpenRow }: Props) {
  const [selectedStamp, setSelectedStamp] = useState(stamp ?? '')
  const initialGroup = groups.find(group => stamp ? group.stamp === stamp : group.scope === 'line')
  const [detail, setDetail] = useState<{ kind: 'common' | 'pvk'; list: ProgramExplanationList } | null>(() => {
    if (!initialSelection) return null
    const slice = initialSelection.slice
    const value = (kind: 'common' | 'pvk') => {
      const d = initialGroup?.[kind]
      return d ? slice === 'excess' ? d.excess + d.duplicateAssignments : slice === 'reduction' ? d.reducible ?? 0 : slice === 'results' ? d.completed : slice === 'duplicates' ? d.duplicateAssignments : slice === 'all' || slice === 'approved' ? 0 : d[slice] : 0
    }
    return { kind: initialSelection.kind ?? (value('pvk') > 0 && !value('common') ? 'pvk' : 'common'), list: slice === 'all' ? 'physical' : slice }
  })
  const detailId = useId()
  const detailPanel = useRef<HTMLDivElement>(null)
  const scrollDetail = useCallback(() => detailPanel.current?.scrollIntoView?.({ block: 'start' }), [])
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const full = line.weldControlPercent === 100
  const visible = groups.filter(group => selectedStamp ? group.stamp === selectedStamp : group.scope === 'line')
  // Older cached payloads may not yet contain a line summary.
  const shown = visible.length ? visible : groups.filter(group => !selectedStamp || group.stamp === selectedStamp)
  const reveal = (kind: 'common' | 'pvk', list: ProgramExplanationList) => {
    setDetail(current => current?.kind === kind && current.list === list ? null : { kind, list })
  }
  useEffect(() => { if (detail) scrollDetail() }, [detail, scrollDetail])
  return <LargeDialogShell ariaLabel={`Расчёт · ${line.line}`} maxWidthClassName="max-w-[1180px]" maxHeightClassName="max-h-[90dvh]" panelRadiusClassName="rounded-2xl" panelClassName="min-w-0 overflow-hidden">
    <div ref={panel} className="flex min-h-0 flex-col" onKeyDown={event => {
      if (shouldDeferModalEscape()) return
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const fields = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex="0"]') ?? [])
        const first = fields[0], last = fields.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="flex shrink-0 items-start gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 break-words"><h2 className="text-xl font-semibold text-slate-900">Расчёт · {line.line}</h2><p className="mt-1 text-sm text-slate-500">{line.projectTitle} · {line.subtitleCode}</p></div>
        <button ref={closeButton} type="button" aria-label="Закрыть расчёт" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-200" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      <div data-testid="line-calculation-dialog-body" className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600">{full ? `${PROGRAM_DEMAND_LABELS.common} — 100% всей линии, в том числе до сварки.${line.pvkControlPercent !== 100 ? ` ПВК — отдельно ${line.pvkControlPercent}% по сваренным стыкам каждого клейма.` : ' ПВК — также по всей линии.'}` : 'Процент считается отдельно по сваренным стыкам каждого клейма. Назначения включают ранний план; его участие в процентном зачёте проверяется отдельно.'}</p>
          <ProgramCalculationSelect label="Область расчёта" ariaLabel="Клеймо в расчёте" className="w-full sm:w-64 sm:shrink-0" value={selectedStamp} title={selectedStamp ? `Клеймо ${selectedStamp}` : 'Вся линия'} onChange={value => { setSelectedStamp(value); setDetail(null) }}>
              <option value="">Вся линия</option>{(stampOptions ?? groups.filter(group => group.scope !== 'line')).map(group => <option key={group.stamp} value={group.stamp}>Клеймо {group.stamp}</option>)}
          </ProgramCalculationSelect>
        </div>
        <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm leading-relaxed text-slate-600">Нажмите на строку показателя: ниже откроются его объяснение, формула и состав стыков. Назначения и зачёт не означают, что получены годные заключения. Для перехода к стыкам используйте кнопку в пояснении.</p>
        {shown.map(group => <section key={`${group.scope}:${group.stamp}`} className="min-w-0 space-y-3">
          <h3 className="break-words font-semibold text-slate-800">{group.stamp ? `Клеймо ${group.stamp}` : 'Вся линия'}{group.welderName ? <span className="ml-2 text-sm font-normal text-slate-500">{group.welderName}</span> : null}</h3>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">{(['common', 'pvk'] as const).map(kind => {
            const demand = group[kind]
            const credited = demand.accounting?.coverage.total ?? demand.covered
            // Line coverage is capped separately for each stamp. A surplus in A
            // must not cancel B's deficit in the explanation either.
            const overage = Math.max(0, credited - (group.scope === 'line' ? demand.covered : demand.required))
            return <section key={kind} data-testid={`demand-${kind}`} className="min-w-0 rounded-xl border border-slate-200 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-slate-800">{PROGRAM_DEMAND_LABELS[kind]}</h4><span className="text-sm text-slate-500">{demand.percent}%</span></div>
              <p className="mt-3 text-sm text-slate-600">Расчётная норма <strong className="text-slate-900">{demand.required}</strong>: по проценту {demand.baseRequired} + из-за брака {demand.additionalRequired}</p>
              <div className="mt-3 rounded-lg bg-slate-50 p-3"><ProgramDemandAccounting accounting={demand.accounting} /><p className="mt-2 text-xs text-slate-600">В пределах текущей нормы: {Math.min(demand.covered, demand.actionableRequired)} / {demand.actionableRequired}. Превышение зачёта: {overage}.</p></div>
              <div className="mt-3 divide-y divide-slate-100">{([
                ['Зачтено, включая сверх нормы', credited, 'covered'], ['Назначено в расчётной группе', demand.assigned, 'assigned'],
                ['С результатом, включая негодные', demand.completed, 'results'], ['Назначение отменено', demand.cancelled, 'cancelled'],
                ['Из назначенных — с «доп»', demand.additional, 'additional'], ['К назначению', demand.missing, 'missing'],
                ['Лишнее', demand.excess + demand.duplicateAssignments, 'excess'], ['Сверх нормы', demand.excess, 'overquota'], ['Несколько способов на одном стыке', demand.duplicateAssignments, 'duplicates'],
                ['Возможное сокращение', demand.reducible ?? 0, 'reduction'],
                ['Доступно для назначения', demand.candidates, 'candidates'], ['Текущая потребность с учётом предела', demand.actionableRequired, 'physical'],
              ] as const).map(([label, value, list]) => <button type="button" key={list} aria-label={`${label} ${value}`} aria-expanded={detail?.kind === kind && detail.list === list} aria-controls={detailId} className={`flex w-full min-w-0 items-baseline justify-between gap-4 rounded py-2 text-left text-sm hover:bg-sky-50 hover:text-sky-800 ${detail?.kind === kind && detail.list === list ? 'bg-sky-50 text-sky-800' : 'text-slate-600'}`} onClick={() => reveal(kind, list)}><span className="min-w-0 break-words">{label}{' '}</span><strong className="shrink-0 tabular-nums text-sky-700 underline decoration-dotted underline-offset-4">{value}</strong></button>)}</div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">Текущая потребность ограничена уже зачтёнными и доступными стыками. При отсутствии кандидатов назначать больше не нужно. С появлением подходящих стыков потребность пересчитывается. «Доп» закрывает норму и может сделать обычный «да» лишним. Сам «доп» не предлагается к снятию. Превышение зачёта не всегда равно числу лишних «да»: дополнительный контроль и назначения, необходимые другим клеймам или послойной замене, защищены. Несколько обязательных способов на одном стыке показаны отдельно.</p>
            </section>
          })}</div>
        </section>)}
        <div id={detailId} ref={detailPanel}>{detail ? <section aria-label="Подробности расчёта" className="rounded-xl border border-sky-200 bg-slate-50/60 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4"><h3 className="min-w-0 break-words font-semibold text-slate-800">{PROGRAM_EXPLANATION_LISTS[detail.list]} · {selectedStamp ? `клеймо ${selectedStamp}` : 'вся линия'}</h3>
            <div className="shrink-0 space-y-1.5"><span className="block text-xs font-medium leading-4 text-slate-500">Метод контроля</span>
              <div role="group" aria-label="Метод подробного расчёта" className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100 p-1">
                {(['common', 'pvk'] as const).map(kind => <button key={kind} type="button" aria-pressed={detail.kind === kind} onClick={() => { if (detail.kind !== kind) setDetail({ ...detail, kind }) }} className={`h-full whitespace-nowrap rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1 ${detail.kind === kind ? 'bg-white text-sky-800 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}>{PROGRAM_DEMAND_LABELS[kind]}</button>)}
              </div>
            </div></div>
          <ProgramCalculationExplanation key={`${selectedStamp}:${detail.kind}:${detail.list}`} lineId={line.id} stamp={selectedStamp || undefined} kind={detail.kind} list={detail.list} onListChange={list => setDetail({ ...detail, list })} onReady={scrollDetail} onChoose={onChoose} onOpenRow={onOpenRow ? id => { onClose(); onOpenRow(id) } : undefined} />
        </section> : null}</div>
        {!shown.length ? <p className="text-sm text-slate-500">Пока нет стыков для расчёта. На процентной линии нужны сваренные стыки с клеймом; назначать НК в рабочей таблице можно заранее.</p> : null}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3"><span className="text-xs text-slate-500">Это просмотр расчёта. Назначения здесь не меняются.</span><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Вернуться к стыкам</button></footer>
    </div>
  </LargeDialogShell>
}
