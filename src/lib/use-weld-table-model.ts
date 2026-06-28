import { useMemo } from 'react'
import { filterWeldRowsByColumns, hasColumnFilters as getHasColumnFilters } from '@/lib/weld-table-filtering'
import { getWeldTableColumnSpan, getWeldTableMinWidth } from '@/lib/weld-table-layout'
import {
  getAlwaysVisibleFieldKeys,
  getAvailableWeldTableSections,
  getFilteredWeldTableSections,
} from '@/lib/weld-table-sections'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ReportRowActions } from '@/lib/report-row-actions'
import { useWeldTableCollapsedSections } from '@/lib/use-weld-table-collapsed-sections'
import { useWeldTableEditability } from '@/lib/use-weld-table-editability'
import { useWeldTableSelection } from '@/lib/use-weld-table-selection'
import { getDuplicateKeys } from '@/lib/weld-table-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'

type RowWithId = WeldRow

type UseWeldTableModelOptions = {
  rows: RowWithId[]
  columnFilters: Record<string, string>
  onEdit?: (row: RowWithId, fieldKey?: WeldFieldKey) => void
  readOnly: boolean
  editableFieldKeys: ReadonlySet<WeldFieldKey>
  blockedFieldKeys: ReadonlySet<WeldFieldKey>
  isCellEditable: (row: RowWithId, fieldKey: WeldFieldKey) => boolean
  onOpenChain?: (row: RowWithId) => void
  onOpenLinkedReport?: (row: RowWithId) => void
  selectable: boolean
  selectedRowIds: ReadonlySet<number>
  onSelectedRowIdsChange?: (ids: Set<number>) => void
  isRowSelectable: (row: RowWithId) => boolean
  storageKey: string
  hiddenFieldKeys: ReadonlySet<WeldFieldKey>
  mergePstoSections: boolean
  rowActions?: ReportRowActions
}

export function useWeldTableModel({
  rows,
  columnFilters,
  onEdit,
  readOnly,
  editableFieldKeys,
  blockedFieldKeys,
  isCellEditable,
  onOpenChain,
  onOpenLinkedReport,
  selectable,
  selectedRowIds,
  onSelectedRowIdsChange,
  isRowSelectable,
  storageKey,
  hiddenFieldKeys,
  mergePstoSections,
  rowActions,
}: UseWeldTableModelOptions) {
  const alwaysVisibleFieldKeys = useMemo(() => getAlwaysVisibleFieldKeys(mergePstoSections), [mergePstoSections])
  const availableSections = useMemo(
    () => getAvailableWeldTableSections({ hiddenFieldKeys, mergePstoSections }),
    [hiddenFieldKeys, mergePstoSections],
  )
  const { collapsedSections, toggleSection } = useWeldTableCollapsedSections({
    storageKey,
    availableSections,
    alwaysVisibleFieldKeys,
  })
  const filteredSections = useMemo(
    () => getFilteredWeldTableSections({ availableSections, collapsedSections, alwaysVisibleFieldKeys }),
    [alwaysVisibleFieldKeys, availableSections, collapsedSections],
  )
  const filteredFields = useMemo(() => filteredSections.flatMap((group) => group.fields), [filteredSections])
  const hasRowActions = Boolean(rowActions)
  const hasChainAction = Boolean(onOpenChain || onOpenLinkedReport)
  const hasColumnFilters = getHasColumnFilters(columnFilters)
  const tableColumnSpan = getWeldTableColumnSpan({
    fieldCount: filteredFields.length,
    readOnly,
    selectable,
    hasRowActions,
    hasChainAction,
  })
  const tableMinWidth = getWeldTableMinWidth({
    fields: filteredFields,
    readOnly,
    selectable,
    hasRowActions,
    hasChainAction,
  })
  const duplicateKeys = useMemo(() => getDuplicateKeys(rows), [rows])
  const filteredRows = useMemo(() => filterWeldRowsByColumns(rows, columnFilters), [rows, columnFilters])
  const selection = useWeldTableSelection({
    filteredRows,
    selectable,
    selectedRowIds,
    onSelectedRowIdsChange,
    isRowSelectable,
  })
  const editability = useWeldTableEditability({
    onEdit,
    readOnly,
    editableFieldKeys,
    blockedFieldKeys,
    isCellEditable,
  })

  return {
    alwaysVisibleFieldKeys,
    availableSections,
    duplicateKeys,
    filteredFields,
    filteredRows,
    filteredSections,
    hasChainAction,
    hasColumnFilters,
    hasRowActions,
    tableColumnSpan,
    tableMinWidth,
    toggleSection,
    ...selection,
    ...editability,
  }
}
