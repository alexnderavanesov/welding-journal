import { createContext, useContext, useMemo } from 'react'
import type { WeldTableProps } from '@/lib/weld-report-table-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { useStableEventCallback } from '@/lib/use-stable-event-callback'
import type { AgGridWeldReport } from '@/lib/weld-report-grid-profile'

type CellTable = Pick<WeldTableProps, 'rowsReady' | 'onEdit' | 'onDelete' | 'onOpenDocument' | 'onOpenLnkRequest' | 'onOpenLnkResult' | 'onOpenJoint' | 'onOpenJointOverview' | 'controlBasisEditorEnabled'>
export type JournalGridContextValue = {
  table: CellTable
  getActionRow: (row: WeldRow) => WeldRow
  canEditCell: (row: WeldRow, fieldKey: WeldFieldKey) => boolean
  openMenu: (row: WeldRow, position: { x: number; y: number; anchorElement?: Element }, fieldKey?: WeldFieldKey) => void
}
export const JournalGridContext = createContext<JournalGridContextValue | null>(null)
export const JournalFilterContext = createContext<(Pick<WeldTableProps, 'columnFilters' | 'onColumnFiltersChange'> & { report: AgGridWeldReport }) | null>(null)
export const JournalExtrasContext = createContext<{
  table: Pick<WeldTableProps, 'rowsReady' | 'extraColumns' | 'rowActions'>
  getActionRow: JournalGridContextValue['getActionRow']
} | null>(null)

// Cell rendering depends on data/permissions, not search drafts, selected IDs,
// report totals or filter options. Stable event callbacks still call the latest
// workflow with its current selection; an absent handler stays absent.
export function useJournalCellContext(props: CellTable, getActionRow: JournalGridContextValue['getActionRow'], canEditCell: JournalGridContextValue['canEditCell'], openMenu: JournalGridContextValue['openMenu']) {
  const edit = useStableEventCallback(props.onEdit)
  const remove = useStableEventCallback(props.onDelete)
  const document = useStableEventCallback(props.onOpenDocument)
  const request = useStableEventCallback(props.onOpenLnkRequest)
  const result = useStableEventCallback(props.onOpenLnkResult)
  const joint = useStableEventCallback(props.onOpenJoint)
  const overview = useStableEventCallback(props.onOpenJointOverview)
  const onEdit = props.onEdit ? edit : undefined
  const onDelete = props.onDelete ? remove : undefined
  const onOpenDocument = props.onOpenDocument ? document : undefined
  const onOpenLnkRequest = props.onOpenLnkRequest ? request : undefined
  const onOpenLnkResult = props.onOpenLnkResult ? result : undefined
  const onOpenJoint = props.onOpenJoint ? joint : undefined
  const onOpenJointOverview = props.onOpenJointOverview ? overview : undefined
  return useMemo<JournalGridContextValue>(() => ({
    table: { rowsReady: props.rowsReady, controlBasisEditorEnabled: props.controlBasisEditorEnabled,
      onEdit, onDelete, onOpenDocument, onOpenLnkRequest, onOpenLnkResult, onOpenJoint, onOpenJointOverview },
    getActionRow, canEditCell, openMenu,
  }), [props.rowsReady, props.controlBasisEditorEnabled,
    onEdit, onDelete, onOpenDocument, onOpenLnkRequest, onOpenLnkResult, onOpenJoint, onOpenJointOverview,
    getActionRow, canEditCell, openMenu])
}

export function useJournalGrid() {
  const value = useContext(JournalGridContext)
  if (!value) throw new Error('Journal grid context is missing')
  return value
}
export function useJournalFilter() {
  const value = useContext(JournalFilterContext)
  if (!value) throw new Error('Journal filter context is missing')
  return value
}
export function useJournalGridExtras() {
  const value = useContext(JournalExtrasContext)
  if (!value) throw new Error('Journal extras context is missing')
  return value
}
