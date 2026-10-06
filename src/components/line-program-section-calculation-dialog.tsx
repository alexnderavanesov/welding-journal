import { useEffect, useRef, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { ProgramCalculationSelect } from './line-program-calculation-select'
import { ProgramPagination } from './line-program-primitives'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'
import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { PROGRAM_SECTION_METRICS, PROGRAM_SECTION_EXPLANATIONS, summarizeProgramSection, programSectionMetricValue,
  type ProgramSectionLine, type ProgramSectionMetric, type ProgramSectionSummary } from '@/lib/line-program-section-summary'

type Props = {
  lines: ProgramSectionLine[]; totals: ProgramSectionSummary; context: string; initialMetric: ProgramSectionMetric
  onClose: () => void; onOpenLine: (line: ProgramSectionLine, metric: ProgramSectionMetric) => void
}

/** The same compact snapshot as the header. No per-line requests until the user opens a line. */
export function LineProgramSectionCalculationDialog({ lines, totals, context, initialMetric, onClose, onOpenLine }: Props) {
  const [metric, setMetric] = useState(initialMetric)
  const [page, setPage] = useState(0)
  const closeButton = useRef<HTMLButtonElement>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const actualPage = Math.min(page, Math.max(0, Math.ceil(lines.length / 50) - 1))
  const value = programSectionMetricValue(totals, metric)
  const breakdown = (summary: ProgramSectionSummary) => metric === 'missing' || metric === 'excess'
    ? `${PROGRAM_DEMAND_LABELS.common}: ${summary.common[metric]} · ПВК: ${summary.pvk[metric]}` : null
  return <LargeDialogShell ariaLabel="Расчёт · итоги раздела" maxWidthClassName="max-w-[1000px]" maxHeightClassName="max-h-[90dvh]" panelRadiusClassName="rounded-2xl" panelClassName="min-w-0 overflow-hidden">
    <div className="flex min-h-0 flex-col" onKeyDown={event => {
      if (shouldDeferModalEscape()) return
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === closeButton.current) { event.preventDefault(); returnButton.current?.focus() }
        else if (!event.shiftKey && document.activeElement === returnButton.current) { event.preventDefault(); closeButton.current?.focus() }
      }
    }}>
      <header className="flex shrink-0 items-start gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 break-words"><h2 className="text-xl font-semibold text-slate-900">Расчёт · итоги раздела</h2><p className="mt-1 text-sm text-slate-500">{context}</p></div>
        <button ref={closeButton} type="button" aria-label="Закрыть общий расчёт" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-200" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ProgramCalculationSelect label="Показатель" ariaLabel="Показатель общего расчёта" value={metric} onChange={value => { setMetric(value as ProgramSectionMetric); setPage(0) }}>
            {Object.entries(PROGRAM_SECTION_METRICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ProgramCalculationSelect>
          <div className="min-w-0 rounded-xl bg-sky-50 px-4 py-3" data-testid="section-calculation-total"><p className="text-sm text-slate-600">{PROGRAM_SECTION_METRICS[metric]}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-sky-900">{value}</p>{breakdown(totals) ? <p className="mt-1 text-xs text-slate-600">{breakdown(totals)}</p> : null}</div>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{PROGRAM_SECTION_EXPLANATIONS[metric]}</p>
        <p className="text-xs leading-relaxed text-slate-500">Итог складывается из показателей линий ниже, включая нулевой вклад. Учитываются текущая вкладка и поиск; фильтр списка и страница не меняют эти итоги. Для формул, клейм и состава стыков откройте подробности нужной линии.</p>
        {totals.issues > 0 ? <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Нужна настройка: {totals.issues}. Общая потребность неполна, пока требования этих линий не настроены.</p> : null}
        <div className="space-y-2" aria-label="Вклад линий в общий итог">
          {lines.slice(actualPage * 50, (actualPage + 1) * 50).map(line => {
            const summary = summarizeProgramSection([line])
            const unavailable = line.configurationIssue || (line.weldControlPercent == null || line.pvkControlPercent == null ? 'Сначала настройте требования контроля линии.' : !line.overview ? 'Обновите данные программы линии.' : null)
            const unknown = !line.overview && metric !== 'lines' && metric !== 'configuration' || !!unavailable && ['common', 'pvk', 'missing', 'excess', 'reduction'].includes(metric)
            return <section key={line.id} data-testid="section-calculation-line" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="min-w-0 flex-1 basis-40 break-words"><h3 className="font-medium text-slate-800">{line.line}</h3><p className="text-xs text-slate-500">{line.projectTitle} · {line.subtitleCode}</p>{unavailable ? <p className="mt-1 text-xs text-amber-800">{unavailable}</p> : null}</div>
              <div className="text-right"><p className="font-semibold tabular-nums text-slate-800">{unknown ? 'Нет расчёта' : programSectionMetricValue(summary, metric)}</p>{!unknown && breakdown(summary) ? <p className="text-xs text-slate-500">{breakdown(summary)}</p> : null}</div>
              <Button variant="ghost" size="sm" className="gap-1" aria-label={`Подробнее · ${line.line}`} disabled={!!unavailable} title={unavailable ?? undefined} onClick={() => onOpenLine(line, metric)}>Расчёт линии<ChevronRight className="h-4 w-4" /></Button>
            </section>
          })}
        </div>
        {!lines.length ? <p className="text-sm text-slate-500">В текущей вкладке и поиске линий нет.</p> : null}
        <ProgramPagination page={actualPage} total={lines.length} pageSize={50} noun="линий расчёта" onChange={setPage} />
      </div>
      <footer className="flex shrink-0 justify-end border-t border-slate-200 px-6 py-3"><Button ref={returnButton} variant="outline" onClick={onClose}>Вернуться к линиям</Button></footer>
    </div>
  </LargeDialogShell>
}
