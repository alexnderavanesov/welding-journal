import { useCallback, useEffect, useRef, useState } from 'react'
import type { GridApi } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import { EMPTY_JOURNAL_RANGE_SUMMARY, journalRangeSummaryChunks, type JournalRangeSpan } from './journal-range-summary'

export function useJournalRangeSummary(api: GridApi<WeldRow> | null) {
  const [summary, setSummary] = useState(EMPTY_JOURNAL_RANGE_SUMMARY)
  const frame = useRef(0)
  const task = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => { cancelAnimationFrame(frame.current); clearTimeout(task.current) }, [])
  useEffect(() => cancel, [cancel, api])
  const update = useCallback(() => {
    cancel()
    frame.current = requestAnimationFrame(() => {
      if (!api || api.isDestroyed()) return
      const spans: JournalRangeSpan[] = []
      for (const range of api.getCellRanges() ?? []) {
        if (!range.startRow || !range.endRow) continue
        const first = Math.max(0, Math.min(range.startRow.rowIndex, range.endRow.rowIndex))
        const last = Math.min(api.getDisplayedRowCount() - 1, Math.max(range.startRow.rowIndex, range.endRow.rowIndex))
        for (const column of range.columns) {
          const fieldKey = column.getColId() as WeldFieldKey
          if (FIELD_BY_KEY.has(fieldKey)) spans.push({ fieldKey, first, last })
        }
      }
      const calculation = journalRangeSummaryChunks(spans, (index, fieldKey) => {
        const node = api.getDisplayedRowAtIndex(index)
        return node?.data ? api.getCellValue({ rowNode: node, colKey: fieldKey, useFormatter: false }) : undefined
      })
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
  }, [api, cancel])
  return { summary, update }
}
