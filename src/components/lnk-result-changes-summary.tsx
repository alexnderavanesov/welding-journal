import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowRight, ClipboardCheck, Trash2 } from 'lucide-react'
import type { LnkResultEditChange } from '@/lib/lnk-result-edit-plan'

export function LnkResultChangesSummary({ changes }: { changes: readonly LnkResultEditChange[] }) {
  const viewport = useRef<HTMLDivElement>(null)
  const virtualized = changes.length > 40
  const virtualizer = useVirtualizer({
    count: changes.length,
    enabled: virtualized,
    getScrollElement: () => viewport.current,
    estimateSize: () => 76,
    getItemKey: index => changes[index].key,
    overscan: 4,
    initialRect: { width: 390, height: 320 },
  })
  const virtualRows = virtualizer.getVirtualItems()
  const visibleRows = virtualized
    ? virtualRows.length > 0
      ? virtualRows.map(row => ({ change: changes[row.index], index: row.index }))
      : changes.slice(0, 12).map((change, index) => ({ change, index }))
    : changes.map((change, index) => ({ change, index }))
  const deletions = changes.filter(change => change.to === null).length
  const before = virtualized ? virtualRows[0]?.start ?? 0 : 0
  const after = virtualized ? Math.max(0, virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? visibleRows.length * 76)) : 0

  return <section aria-label="Изменения результатов" className="min-w-0 space-y-3 text-slate-700">
    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800">
        <ClipboardCheck aria-hidden="true" className="h-4 w-4" />Изменений: {changes.length}
      </span>
      {deletions > 0 ? <span className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800">Удалений: {deletions}</span> : null}
    </div>
    <p className="text-sm leading-5">Проверьте все подготовленные изменения, включая позиции, скрытые фильтрами редактора.</p>
    <div ref={viewport} tabIndex={0} role="region" aria-label="Список изменений результатов"
      className="max-h-[min(44dvh,24rem)] overflow-auto overscroll-contain rounded-lg border border-slate-200 bg-white [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
      <table role="table" className="block w-full table-fixed text-left text-xs sm:table sm:text-sm">
        <colgroup className="hidden sm:table-column-group"><col className="w-[32%]" /><col className="w-[16%]" /><col className="w-[22%]" /><col className="w-[30%]" /></colgroup>
        <thead role="rowgroup" className="sr-only bg-slate-50 text-[11px] text-slate-500 sm:not-sr-only sm:sticky sm:top-0 sm:z-10 sm:table-header-group sm:text-xs">
          <tr>{['Стык', 'Метод', 'Было', 'Станет'].map(label => <th key={label} scope="col" className="px-2 py-2.5 font-medium">{label}</th>)}</tr>
        </thead>
        <tbody role="rowgroup" className="block divide-y divide-slate-100 sm:table-row-group">
          {before > 0 ? <tr aria-hidden="true" className="block sm:table-row"><td colSpan={4} className="block sm:table-cell" style={{ height: before }} /></tr> : null}
          {visibleRows.map(({ change, index }) => <tr key={change.key} data-index={index}
            role="row" ref={virtualized ? virtualizer.measureElement : undefined}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-3 align-top sm:table-row sm:p-0">
            <th scope="row" role="rowheader" className="block min-w-0 font-normal [overflow-wrap:anywhere] sm:table-cell sm:px-2 sm:py-3">
              <strong className="block font-semibold text-slate-900">{change.joint || `#${change.rowId}`}</strong>
              {change.line ? <span className="mt-1 block text-[11px] text-slate-500">Линия {change.line}</span> : null}
              {change.project ? <span className="block text-[11px] text-slate-500">{change.project}</span> : null}
              {change.subtitleCode ? <span className="block text-[11px] text-slate-500">Шифр {change.subtitleCode}</span> : null}
            </th>
            <td role="cell" className="block max-w-24 font-medium text-slate-700 sm:table-cell sm:max-w-none sm:px-2 sm:py-3">{change.method}</td>
            <td role="cell" className="col-span-2 flex min-w-0 items-start gap-2 sm:table-cell sm:px-2 sm:py-3">
              <span aria-hidden="true" className="w-12 shrink-0 pt-0.5 text-[11px] text-slate-500 sm:hidden">Было</span>
              <span className="inline-block max-w-full whitespace-normal break-normal rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700 [overflow-wrap:normal]">{change.from || '—'}</span>
            </td>
            <td role="cell" className="col-span-2 flex min-w-0 items-start gap-2 sm:table-cell sm:px-2 sm:py-3">
              <span aria-hidden="true" className="w-12 shrink-0 pt-0.5 text-[11px] text-slate-500 sm:hidden">Станет</span>
              <div className="min-w-0 whitespace-normal break-normal [overflow-wrap:normal]">
                <span className={`inline-flex max-w-full items-start gap-1 rounded border px-1.5 py-0.5 ${change.to === null ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
                  {change.to === null ? <Trash2 aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" /> : <ArrowRight aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />}
                  <span className="min-w-0">{change.to === null ? 'Удаление результата' : change.to}</span>
                </span>
                {change.detail ? <span className="mt-1 block text-[11px] text-slate-500">{change.detail}</span> : null}
              </div>
            </td>
          </tr>)}
          {after > 0 ? <tr aria-hidden="true" className="block sm:table-row"><td colSpan={4} className="block sm:table-cell" style={{ height: after }} /></tr> : null}
        </tbody>
      </table>
    </div>
    {deletions > 0 ? <p className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-700">
      При удалении у указанного стыка и метода будут очищены результат, название заключения и дата контроля. Остальные позиции общего документа сохранятся.
    </p> : null}
    <p className="text-xs leading-5 text-slate-500">До подтверждения данные не меняются. Возврат к редактированию сохранит ваш выбор в открытом окне.</p>
  </section>
}
