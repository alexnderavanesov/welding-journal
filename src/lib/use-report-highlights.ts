import { useEffect, useRef, useState } from 'react'

import { HIGHLIGHT_DURATION_MS as highlightDurationMs } from '@/lib/report-config'
import { buildHighlightSets, expandHighlightFieldKeys } from '@/lib/report-ui-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type HighlightSnapshot = {
  rows: Array<{ id?: number }>
  fieldKeys: WeldFieldKey[]
  createdAt: number
}

export function useReportHighlights() {
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestHighlightRef = useRef<HighlightSnapshot | null>(null)
  const [highlightedRowIds, setHighlightedRowIds] = useState<Set<number>>(new Set())
  const [highlightedCellKeys, setHighlightedCellKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  function applyChangedRowsHighlight(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    const highlightSets = buildHighlightSets(rows, cellFieldKeys)
    if (!highlightSets) return

    setHighlightedRowIds(highlightSets.rowIds)
    setHighlightedCellKeys(highlightSets.cellKeys)
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedRowIds(new Set())
      setHighlightedCellKeys(new Set())
      highlightTimerRef.current = null
    }, highlightDurationMs)
  }

  function highlightChangedRows(rows: Array<{ id?: number }> | undefined, cellFieldKeys: WeldFieldKey[] = []) {
    if (rows && rows.length > 0) {
      latestHighlightRef.current = {
        rows,
        fieldKeys: expandHighlightFieldKeys(cellFieldKeys),
        createdAt: Date.now(),
      }
    }
    applyChangedRowsHighlight(rows, cellFieldKeys)
  }

  function replayLatestHighlight() {
    const latestHighlight = latestHighlightRef.current
    if (!latestHighlight) return
    if (Date.now() - latestHighlight.createdAt > highlightDurationMs * 4) return
    applyChangedRowsHighlight(latestHighlight.rows, latestHighlight.fieldKeys)
  }

  return {
    highlightedRowIds,
    highlightedCellKeys,
    highlightChangedRows,
    replayLatestHighlight,
  }
}
