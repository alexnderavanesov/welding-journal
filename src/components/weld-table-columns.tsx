import { ACTIONS_COLUMN_WIDTH, getWeldColumnWidth } from '@/lib/weld-column-widths'
import { ROW_ACTIONS_COLUMN_WIDTH, SELECT_COLUMN_WIDTH } from '@/lib/weld-table-layout'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import {
  getTrailingWeldTableExtraColumns,
  getWeldTableExtraColumnsAfterSection,
  getWeldTableExtraColumnsBeforeSection,
  type WeldTableExtraColumn,
} from '@/lib/weld-table-extra-columns'

type WeldTableColumnsProps = {
  sections: WeldTableDisplaySection[]
  readOnly: boolean
  selectable: boolean
  hasRowActions: boolean
  hasChainAction: boolean
  extraColumns: WeldTableExtraColumn[]
}

export function WeldTableColumns({
  sections,
  readOnly,
  selectable,
  hasRowActions,
  hasChainAction,
  extraColumns,
}: WeldTableColumnsProps) {
  const trailingExtraColumns = getTrailingWeldTableExtraColumns(extraColumns, sections)
  const hasControlColumn = selectable || hasChainAction

  return (
    <colgroup>
      {hasControlColumn ? <col style={{ width: SELECT_COLUMN_WIDTH }} /> : null}
      {hasRowActions ? <col style={{ width: ROW_ACTIONS_COLUMN_WIDTH }} /> : null}
      {sections.flatMap((section) => [
        ...getWeldTableExtraColumnsBeforeSection(extraColumns, section.section)
          .map((column) => <col key={column.key} style={{ width: column.width }} />),
        ...section.fields.map((field) => <col key={field.key} style={{ width: getWeldColumnWidth(field.key) }} />),
        ...getWeldTableExtraColumnsAfterSection(extraColumns, section.section)
          .map((column) => <col key={column.key} style={{ width: column.width }} />),
      ])}
      {trailingExtraColumns.map((column) => (
        <col key={column.key} style={{ width: column.width }} />
      ))}
      {!readOnly ? <col style={{ width: ACTIONS_COLUMN_WIDTH }} /> : null}
    </colgroup>
  )
}
