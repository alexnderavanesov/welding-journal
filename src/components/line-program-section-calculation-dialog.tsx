import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ProgramCalculationSelect } from './line-program-calculation-select'
import { ProgramPagination } from './line-program-primitives'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'
import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { PROGRAM_SECTION_METRICS, PROGRAM_SECTION_EXPLANATIONS, summarizeProgramSection, programSectionMetricValue,
  type ProgramSectionLine, type ProgramSectionMetric, type ProgramSectionSummary } from '@/lib/line-program-section-summary'

export type ProgramSectionDialogState = { metric: ProgramSectionMetric; search: string; page: number; scrollTop: number; focusLineId?: number }
const SUPPORT_SECTION_EXPLANATIONS: Partial<Record<ProgramSectionMetric, string>> = {
  common: 'Складываются зачёт УЗК в пределах нормы каждого официального клейма и текущая достижимая потребность. Исходная ОП и её ремонты дают одно место физической опоры. Зачёт не означает получение годного заключения.',
  pvk: 'ПВК опор считается независимо от УЗК. Складываются зачёт в пределах каждой нормы и достижимая потребность. Брак и ремонт не создают добор.',
  missing: 'Общий остаток — сумма «К назначению» по УЗК и ПВК всех линий. Отмена невыполненного метода уменьшает доступное количество; сама отмена не даёт зачёт. Недостижимая часть нормы не создаёт долг.',
  excess: 'Складываются лишние обычные назначения УЗК и ПВК. Единица — запись и метод. Нужное превышение помечается «Дополнительный». Выполненные факты и обязательные методы ремонта защищены от снятия.',
}
type Props = {
  lines: ProgramSectionLine[]; totals: ProgramSectionSummary; context: string; initialMetric: ProgramSectionMetric; family?: 'supports'
  initialState?: ProgramSectionDialogState
  onClose: () => void; onOpenLine: (line: ProgramSectionLine, metric: ProgramSectionMetric, state: ProgramSectionDialogState) => void
}

/** The same compact snapshot as the header. No per-line requests until the user opens a line. */
export function LineProgramSectionCalculationDialog({ lines, totals, context, initialMetric, initialState, onClose, onOpenLine, family }: Props) {
  const metrics = family === 'supports' ? { ...PROGRAM_SECTION_METRICS, common: 'УЗК · зачтено / нужно' } : PROGRAM_SECTION_METRICS
  const [metric, setMetric] = useState(initialState?.metric ?? initialMetric)
  const [page, setPage] = useState(initialState?.page ?? 0)
  const [search, setSearch] = useState(initialState?.search ?? '')
  const searchInput = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    const previousLine = initialState?.focusLineId ? body.current?.querySelector<HTMLButtonElement>(`[data-line-id="${initialState.focusLineId}"]`) : undefined
    ;(previousLine ?? closeButton.current)?.focus({ preventScroll: true })
    if (body.current) body.current.scrollTop = initialState?.scrollTop ?? 0
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const needle = search.trim().toLocaleLowerCase('ru')
  const filtered = lines.filter(line => line.line.toLocaleLowerCase('ru').includes(needle))
  const actualPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1))
  const value = programSectionMetricValue(totals, metric)
  const breakdown = (summary: ProgramSectionSummary) => metric === 'missing' || metric === 'excess'
    ? `${family === 'supports' ? 'УЗК' : PROGRAM_DEMAND_LABELS.common}: ${summary.common[metric]} · ПВК: ${summary.pvk[metric]}` : null
  return <LargeDialogShell onEscape={onClose} ariaLabel="Расчёт · итоги раздела" maxWidthClassName="max-w-[1000px]" maxHeightClassName="max-h-[90dvh]" panelRadiusClassName="rounded-2xl" panelClassName="min-w-0 overflow-hidden">
    <div className="flex min-h-0 flex-col" onKeyDown={event => {
      if (shouldDeferModalEscape(closeButton.current?.closest('[data-modal-dialog="true"]'))) return
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === closeButton.current) { event.preventDefault(); returnButton.current?.focus() }
        else if (!event.shiftKey && document.activeElement === returnButton.current) { event.preventDefault(); closeButton.current?.focus() }
      }
    }}>
      <header className="flex shrink-0 items-start gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div className="min-w-0 flex-1 break-words"><h2 className="text-xl font-semibold text-slate-900">Расчёт · итоги раздела</h2><p className="mt-1 text-sm text-slate-500">{context}</p></div>
        <button ref={closeButton} type="button" aria-label="Закрыть общий расчёт" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-200" onClick={onClose}><X className="h-5 w-5" /></button>
      </header>
      <div ref={body} className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ProgramCalculationSelect label="Показатель" ariaLabel="Показатель общего расчёта" value={metric} onChange={value => { setMetric(value as ProgramSectionMetric); setPage(0) }}>
            {Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ProgramCalculationSelect>
          <div className="min-w-0 rounded-xl bg-sky-50 px-4 py-3" data-testid="section-calculation-total"><p className="text-sm text-slate-600">{metrics[metric]}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-sky-900">{value}</p>{breakdown(totals) ? <p className="mt-1 text-xs text-slate-600">{breakdown(totals)}</p> : null}</div>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{family === 'supports' ? SUPPORT_SECTION_EXPLANATIONS[metric] ?? PROGRAM_SECTION_EXPLANATIONS[metric].replaceAll('РК/УЗК', 'УЗК') : PROGRAM_SECTION_EXPLANATIONS[metric]}</p>
        <p className="text-xs leading-relaxed text-slate-500">Итог складывается из полного набора линий текущей вкладки и поиска страницы программы, включая нулевой вклад. Поиск в этом окне и страница списка не меняют итог. Для формул, клейм и состава стыков откройте подробности нужной линии.</p>
        {totals.issues > 0 ? <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Нужна настройка: {totals.issues}. Общая потребность неполна, пока требования этих линий не настроены.</p> : null}
        <div className="space-y-2">
          <div className="relative w-full"><Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><Input ref={searchInput} aria-label="Найти линию" placeholder="Найти линию…" value={search} className="w-full pl-9 pr-9" onChange={event => { setSearch(event.target.value); setPage(0) }} />{search ? <button type="button" aria-label="Очистить поиск линий" className="absolute right-1 top-1 rounded p-2 text-slate-500 hover:bg-slate-100" onClick={() => { setSearch(''); setPage(0); searchInput.current?.focus() }}><X aria-hidden className="h-4 w-4" /></button> : null}</div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-slate-500"><span>Поиск по списку; итог раздела не меняется</span><span role="status">Найдено {filtered.length} из {lines.length}</span></div>
        </div>
        <div className="space-y-2" aria-label="Вклад линий в общий итог">
          {filtered.slice(actualPage * 50, (actualPage + 1) * 50).map(line => {
            const summary = summarizeProgramSection([line])
            const unavailable = line.configurationIssue || (line.weldControlPercent == null || line.pvkControlPercent == null ? 'Сначала настройте требования контроля линии.' : !line.overview ? 'Обновите данные программы линии.' : null)
            const unknown = !line.overview && metric !== 'lines' && metric !== 'configuration' || !!unavailable && ['common', 'pvk', 'missing', 'excess', 'reduction'].includes(metric)
            return <section key={line.id} data-testid="section-calculation-line" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <div className="min-w-0 flex-1 basis-40 break-words"><h3 className="font-medium text-slate-800">{line.line}</h3><p className="text-xs text-slate-500">{line.projectTitle} · {line.subtitleCode}</p>{unavailable ? <p className="mt-1 text-xs text-amber-800">{unavailable}</p> : null}</div>
              <div className="text-right"><p className="font-semibold tabular-nums text-slate-800">{unknown ? 'Нет расчёта' : programSectionMetricValue(summary, metric)}</p>{!unknown && breakdown(summary) ? <p className="text-xs text-slate-500">{breakdown(summary)}</p> : null}</div>
              <Button data-line-id={line.id} variant="ghost" size="sm" className="gap-1" aria-label={`Подробнее · ${line.line}`} disabled={!!unavailable} title={unavailable ?? undefined} onClick={() => onOpenLine(line, metric, { metric, search, page: actualPage, scrollTop: body.current?.scrollTop ?? 0, focusLineId: line.id })}>Расчёт линии<ChevronRight className="h-4 w-4" /></Button>
            </section>
          })}
        </div>
        {!filtered.length ? <p className="text-sm text-slate-500">Линии не найдены</p> : null}
        <ProgramPagination page={actualPage} total={filtered.length} pageSize={50} noun="линий расчёта" onChange={setPage} />
      </div>
      <footer className="flex shrink-0 justify-end border-t border-slate-200 px-6 py-3"><Button ref={returnButton} variant="outline" onClick={onClose}>Вернуться к линиям</Button></footer>
    </div>
  </LargeDialogShell>
}
