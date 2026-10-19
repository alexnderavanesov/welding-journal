import { useCallback, useEffect, useRef, useState } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import { EMPTY_JOURNAL_RANGE_SUMMARY, journalRangeSummaryChunks, type JournalRangeSpan } from './journal-range-summary'

// Read only displayed, cached nodes: a server-side range must never fetch missing blocks.
export function useGridRangeSummary<Row>(
  api: GridApi<Row> | null,
  allowedColumns: ReadonlySet<string>,
  getValue: (node: IRowNode<Row>, key: string) => unknown,
  isNumericField: (key: string) => boolean,
) {
  const [summary, setSummary] = useState(EMPTY_JOURNAL_RANGE_SUMMARY)
  const frame = useRef(0)
  const task = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => { cancelAnimationFrame(frame.current); clearTimeout(task.current) }, [])
  const update = useCallback(() => {
    cancel()
    // Most model updates have no cell selection. Do not add another frame or
    // cached-row traversal to the document selection synchronisation then.
    if (!api || api.isDestroyed() || !api.getCellRanges()?.length) {
      setSummary(previous => previous.count ? EMPTY_JOURNAL_RANGE_SUMMARY : previous)
      return
    }
    frame.current = requestAnimationFrame(() => {
      if (!api || api.isDestroyed()) return
      const ranges = (api.getCellRanges() ?? []).filter(range => range.startRow && range.endRow && !range.startRow.rowPinned && !range.endRow.rowPinned)
      const nodes: IRowNode<Row>[] = []
      if (ranges.length) api.forEachNode(node => {
        if (node.rowIndex != null && node.rowIndex >= 0 && !node.rowPinned && !node.footer && !node.stub) nodes.push(node)
      })
      nodes.sort((a, b) => a.rowIndex! - b.rowIndex!)
      const lowerBound = (position: number) => {
        let low = 0, high = nodes.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if (nodes[mid].rowIndex! < position) low = mid + 1
          else high = mid
        }
        return low
      }
      const spans: JournalRangeSpan<string>[] = []
      for (const range of ranges) {
        const first = lowerBound(Math.min(range.startRow!.rowIndex, range.endRow!.rowIndex))
        const last = lowerBound(Math.max(range.startRow!.rowIndex, range.endRow!.rowIndex) + 1) - 1
        for (const column of range.columns) {
          const fieldKey = column.getColId()
          if (allowedColumns.has(fieldKey) && column.isVisible?.() !== false) spans.push({ fieldKey, first, last })
        }
      }
      const calculation = journalRangeSummaryChunks(spans, (index, key) => getValue(nodes[index], key), isNumericField)
      const run = () => {
        if (api.isDestroyed()) return
        const started = performance.now()
        do {
          const next = calculation.next()
          if (next.done) {
            const value = next.value
            setSummary(previous => previous.count === value.count && previous.numericCount === value.numericCount && previous.sum === value.sum ? previous : value)
            return
          }
        } while (performance.now() - started < 4)
        task.current = setTimeout(run, 0)
      }
      run()
    })
  }, [api, allowedColumns, getValue, isNumericField, cancel])
  useEffect(() => { update(); return cancel }, [update, cancel])
  return { summary, update }
}
