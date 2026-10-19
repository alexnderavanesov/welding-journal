import { useCallback } from 'react'
import type { GridApi, IRowNode } from 'ag-grid-community'
import type { WeldRow } from './dispatcher-types'
import { FIELD_BY_KEY, type WeldFieldKey } from './weld-fields'
import { useGridRangeSummary } from './use-grid-range-summary'
import { journalNumericValue } from './welding-journal-grid-state'

const FIELDS = new Set<string>(FIELD_BY_KEY.keys())
const isNumeric = (key: string) => FIELD_BY_KEY.get(key as WeldFieldKey)?.kind === 'number'

export function journalGroupRangeValue(node: IRowNode<WeldRow>, key: string, anchor: string): unknown {
  if (key !== anchor) return node.aggData?.[key]
  // The anchor displays the grouping key, which can itself be a numeric field.
  const groupField = node.rowGroupColumn?.getColId() as WeldFieldKey | undefined
  return groupField && isNumeric(groupField) ? journalNumericValue(node.key) ?? node.key : node.key || '(Пусто)'
}

export function useJournalRangeSummary(api: GridApi<WeldRow> | null, groupAnchor = 'line') {
  const valueAt = useCallback((node: IRowNode<WeldRow>, key: string) => node.group
    ? journalGroupRangeValue(node, key, groupAnchor)
    : node.data ? api?.getCellValue({ rowNode: node, colKey: key, useFormatter: false }) : undefined,
  [api, groupAnchor])
  return useGridRangeSummary(api, FIELDS, valueAt, isNumeric)
}
