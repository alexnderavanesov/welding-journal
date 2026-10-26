import { useJournalSelectionSummary } from '@/lib/use-journal-selection-summary'
import { formatJournalNumber } from '@/lib/welding-journal-grid-state'
import type { JournalSummaryRange } from '@/lib/journal-selection-summary'

export function JournalSelectionSummary({ ids, identity, ready, range = null, recoverRevision }: { ids: ReadonlySet<number>; identity?: string; ready: boolean; range?: JournalSummaryRange; recoverRevision?: (error: unknown) => boolean }) {
  const { summary, error, retry } = useJournalSelectionSummary(ids, identity, ready, range, recoverRevision)
  if (!range && !ids.size) return null
  const source = <span className="text-slate-500">{range ? 'По области' : 'По выбранным'}</span>
  if (error) return <>{source}<span role="status" title={error}>{range?.error ?? 'Итоги недоступны.'} {!range?.error ? <button type="button" className="underline" onClick={retry}>Повторить</button> : null}</span></>
  if (!summary) return <>{source}<span role="status">Итоги: считаем…</span></>
  return <>
    {source}
    <span>Стыков: {summary.joints}</span>
    <span title={summary.missingWdi ? `Не задан WDI у физических стыков: ${summary.missingWdi}. Показана сумма известных значений.` : undefined}>
      WDI: {summary.wdi === null ? '—' : formatJournalNumber(summary.wdi)}{summary.missingWdi ? '*' : ''}
    </span>
    <span title={summary.missingDates ? `Без даты сварки: ${summary.missingDates} записей. Диапазон построен по заполненным датам выбранных записей.` : undefined}>
      Сварка: {summary.weldDate}{summary.missingDates ? '*' : ''}
    </span>
  </>
}
