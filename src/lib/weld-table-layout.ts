import { ACTIONS_COLUMN_WIDTH, getWeldTableWidth } from '@/lib/weld-column-widths'
import type { WeldField } from '@/lib/weld-fields'

export const SELECT_COLUMN_WIDTH = 48
export const ROW_ACTIONS_COLUMN_WIDTH = 72
export const CHAIN_ACTION_COLUMN_WIDTH = 76

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
  return (
    getWeldTableWidth(fields) -
    (readOnly ? ACTIONS_COLUMN_WIDTH : 0) +
    (selectable ? SELECT_COLUMN_WIDTH : 0) +
    (hasRowActions ? ROW_ACTIONS_COLUMN_WIDTH : 0) +
    (hasChainAction ? CHAIN_ACTION_COLUMN_WIDTH : 0)
  )
}
