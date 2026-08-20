import type { WeldRow } from '@/lib/dispatcher-types'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

type WeldTableRow = WeldRow

type UseWeldTableSelectionParams = {
  filteredRows: WeldTableRow[]
  selectable: boolean
  selectedRowIds: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable: (row: WeldTableRow) => boolean
}

export function useWeldTableSelection({
  filteredRows,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
  isRowSelectable,
}: UseWeldTableSelectionParams) {
  const selectedRowIdsRef = useRef(selectedRowIds)
  useLayoutEffect(() => {
    selectedRowIdsRef.current = selectedRowIds
  }, [selectedRowIds])
  const selectableVisibleRows = useMemo(
    () => filteredRows.filter((row) => !selectable || isRowSelectable(row)),
    [filteredRows, isRowSelectable, selectable],
  )
  const selectedVisibleRows = useMemo(
    () => selectableVisibleRows.filter((row) => selectedRowIds.has(row.id)),
    [selectableVisibleRows, selectedRowIds],
  )
  const allVisibleRowsSelected = selectableVisibleRows.length > 0 && selectedVisibleRows.length === selectableVisibleRows.length
  const someVisibleRowsSelected = selectedVisibleRows.length > 0 && !allVisibleRowsSelected

  const setRowSelected = useCallback((row: WeldTableRow, selected: boolean) => {
    if (!isRowSelectable(row)) return

    const next = new Set(selectedRowIdsRef.current)
    if (selected) {
      next.add(row.id)
    } else {
      next.delete(row.id)
    }
    onSelectedRowIdsChange?.(next)
  }, [isRowSelectable, onSelectedRowIdsChange])

  const setVisibleRowsSelected = useCallback((selected: boolean) => {
    const next = new Set(selectedRowIdsRef.current)
    for (const row of selectableVisibleRows) {
      if (selected) {
        next.add(row.id)
      } else {
        next.delete(row.id)
      }
    }
    onSelectedRowIdsChange?.(next)
  }, [onSelectedRowIdsChange, selectableVisibleRows])

  return {
    selectableVisibleRows,
    allVisibleRowsSelected,
    someVisibleRowsSelected,
    setRowSelected,
    setVisibleRowsSelected,
  }
}
