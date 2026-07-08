import { ACTIONS_COLUMN_WIDTH, getWeldColumnWidth } from '@/lib/weld-column-widths'
import { CHAIN_ACTION_COLUMN_WIDTH, ROW_ACTIONS_COLUMN_WIDTH, SELECT_COLUMN_WIDTH } from '@/lib/weld-table-layout'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldField } from '@/lib/weld-fields'

type WeldTableColumnsProps = {
  fields: WeldField[]
  readOnly: boolean
  selectable: boolean
  hasRowActions: boolean
  hasChainAction: boolean
  extraColumns: WeldTableExtraColumn[]
}

export function WeldTableColumns({
  fields,
  readOnly,
  selectable,
  hasRowActions,
  hasChainAction,
  extraColumns,
}: WeldTableColumnsProps) {
  return (
    <colgroup>
      {selectable ? <col style={{ width: SELECT_COLUMN_WIDTH }} /> : null}
      {hasChainAction ? <col style={{ width: CHAIN_ACTION_COLUMN_WIDTH }} /> : null}
      {hasRowActions ? <col style={{ width: ROW_ACTIONS_COLUMN_WIDTH }} /> : null}
      {fields.map((field) => (
        <col key={field.key} style={{ width: getWeldColumnWidth(field.key) }} />
      ))}
      {extraColumns.map((column) => (
        <col key={column.key} style={{ width: column.width }} />
      ))}
      {!readOnly ? <col style={{ width: ACTIONS_COLUMN_WIDTH }} /> : null}
    </colgroup>
  )
}
