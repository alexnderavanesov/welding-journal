import type { WeldRow } from '@/lib/dispatcher-types'

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
  const selectableVisibleRows = filteredRows.filter((row) => !selectable || isRowSelectable(row))
  const selectedVisibleRows = selectableVisibleRows.filter((row) => selectedRowIds.has(row.id))
  const allVisibleRowsSelected = selectableVisibleRows.length > 0 && selectedVisibleRows.length === selectableVisibleRows.length
  const someVisibleRowsSelected = selectedVisibleRows.length > 0 && !allVisibleRowsSelected

  function setRowSelected(row: WeldTableRow, selected: boolean) {
    if (!isRowSelectable(row)) return

    const next = new Set(selectedRowIds)
    if (selected) {
      next.add(row.id)
    } else {
      next.delete(row.id)
    }
    onSelectedRowIdsChange?.(next)
  }

  function setVisibleRowsSelected(selected: boolean) {
    const next = new Set(selectedRowIds)
    for (const row of selectableVisibleRows) {
      if (selected) {
        next.add(row.id)
      } else {
        next.delete(row.id)
      }
    }
    onSelectedRowIdsChange?.(next)
  }

  return {
    selectableVisibleRows,
    allVisibleRowsSelected,
    someVisibleRowsSelected,
    setRowSelected,
    setVisibleRowsSelected,
  }
}
