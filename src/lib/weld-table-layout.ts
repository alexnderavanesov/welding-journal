import { ACTIONS_COLUMN_WIDTH, getWeldTableWidth } from '@/lib/weld-column-widths'
import type { WeldField } from '@/lib/weld-fields'

export const SELECT_COLUMN_WIDTH = 48
export const ROW_ACTIONS_COLUMN_WIDTH = 72

export function getWeldTableMinWidth({
  fields,
  readOnly,
  selectable,
  hasRowActions,
  hasChainAction,
}: {
  fields: WeldField[]
  readOnly: boolean
  selectable: boolean
  hasRowActions: boolean
  hasChainAction: boolean
}) {
  const hasControlColumn = selectable || hasChainAction

  return (
    getWeldTableWidth(fields) -
    (readOnly ? ACTIONS_COLUMN_WIDTH : 0) +
    (hasControlColumn ? SELECT_COLUMN_WIDTH : 0) +
    (hasRowActions ? ROW_ACTIONS_COLUMN_WIDTH : 0)
    )
}

export function getWeldTableColumnSpan({
  fieldCount,
  readOnly,
  selectable,
  hasRowActions,
  hasChainAction,
}: {
  fieldCount: number
  readOnly: boolean
  selectable: boolean
  hasRowActions: boolean
  hasChainAction: boolean
}) {
  const hasControlColumn = selectable || hasChainAction

  return (
    fieldCount +
    (readOnly ? 0 : 1) +
    (hasControlColumn ? 1 : 0) +
    (hasRowActions ? 1 : 0)
  )
}
