import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useRef } from 'react'
import { readWorkClosureSummary } from '@/server/work-closures-api'
import { closureValueLabel, withClosureColumnFilters, type WorkClosureFilter } from '@/lib/work-closures'
import { closureColumns, closureDimensions, type ClosureDimension } from '@/lib/work-closure-columns'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'

export function WorkClosureSummary({ dimension, filter, columnFilters, onClose, onSelect }: {
  dimension: ClosureDimension; filter: WorkClosureFilter; columnFilters: Record<string, string>
  onClose: () => void; onSelect: (next: WorkClosureFilter) => void
}) {
  const filters = withClosureColumnFilters(columnFilters, filter)
  const fields = [dimension, ...closureDimensions.filter(key => key !== dimension)]
  const title = closureColumns[dimension].summary
  const query = useQuery({ queryKey: ['work-closure-summary', dimension, filters], queryFn: ({ signal }) =>
    readWorkClosureSummary({ signal, data: { dimension, columnFilters: filters } }), staleTime: 0, retry: false })
  const viewport = useRef<HTMLDivElement>(null)
  const rows = query.data ?? []
  const virtual = rows.length > 200
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 41,
    overscan: 10,
  })
  const visibleRows = virtualizer.getVirtualItems()
  const paddingTop = visibleRows[0]?.start ?? 0
  const paddingBottom = virtualizer.getTotalSize() - (visibleRows.at(-1)?.end ?? 0)
  function renderRow(row: typeof rows[number], index: number) {
    const open = () => {
      if (!row.subtotal) return onSelect({ actNumber: [row.actNumber], workType: [row.workType], rateCode: [row.rateCode] })
      const next = { ...filter, [dimension]: [row[dimension]] }
      if (dimension === 'rateCode') delete next.rateAssigned
      onSelect(next)
    }
    const values = (row.subtotal ? [dimension] : fields).map(key => closureValueLabel(key, row[key]))
    return <tr key={index} aria-rowindex={index + 2} data-index={index}
      ref={virtual ? virtualizer.measureElement : undefined} onClick={open}
      className={'cursor-pointer border-b border-slate-100 hover:bg-sky-50 focus-within:bg-sky-50 ' + (row.subtotal ? 'bg-slate-50 font-medium' : '')}>
      {row.subtotal ? <th scope="row" colSpan={3} className="px-2 py-2 [overflow-wrap:anywhere]">{values[0]} · всего</th>
        : values.map((value, i) => <td key={fields[i]} className="px-2 py-2 [overflow-wrap:anywhere]">{value}</td>)}
      <td className="px-2 py-1 text-right"><Button variant="ghost" size="sm" className="text-sky-700"
        aria-label={['Показать стыки', ...values].join(' · ')}
        onClick={event => { event.stopPropagation(); open() }}>{row.joints}<ChevronRight size={14} /></Button></td>
    </tr>
  }
  return <LargeDialogShell ariaLabel={title} maxWidthClassName="max-w-2xl" onEscape={onClose}>
    <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
      <h2 className="font-semibold text-slate-900">{title}</h2><Button variant="ghost" onClick={onClose}>Закрыть</Button>
    </header>
    <div ref={viewport} className="min-h-0 overflow-auto px-5 pb-4 text-sm">
      {query.isError ? <p role="alert" className="py-3">{query.error.message} <Button variant="outline" onClick={() => void query.refetch()}>Повторить</Button></p>
        : query.isFetching || !query.data ? <p role="status" className="py-4 text-slate-500">Загружаем сводку…</p>
        : !query.data.length ? <p className="py-4 text-slate-500">По выбранным условиям работ нет.</p>
        : <table aria-label={title} aria-rowcount={rows.length + 1} className={'w-full text-left' + (virtual ? ' table-fixed' : '')}>
          <thead className="sticky top-0 bg-white text-xs text-slate-500"><tr>
            {[...fields.map(key => closureColumns[key].label), 'Стыков'].map(label => <th key={label} scope="col" className="border-b px-2 py-3 font-medium last:text-right">{label}</th>)}
          </tr></thead>
          <tbody>
            {virtual && paddingTop > 0 && <tr aria-hidden="true"><td colSpan={4} style={{ height: paddingTop }} /></tr>}
            {virtual ? visibleRows.map(item => renderRow(rows[item.index], item.index)) : rows.map(renderRow)}
            {virtual && paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={4} style={{ height: paddingBottom }} /></tr>}
          </tbody>
        </table>}
    </div>
  </LargeDialogShell>
}
