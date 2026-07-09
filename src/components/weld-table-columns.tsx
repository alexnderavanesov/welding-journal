import { ACTIONS_COLUMN_WIDTH, getWeldColumnWidth } from '@/lib/weld-column-widths'
import { CHAIN_ACTION_COLUMN_WIDTH, ROW_ACTIONS_COLUMN_WIDTH, SELECT_COLUMN_WIDTH } from '@/lib/weld-table-layout'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'

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
  const trailingExtraColumns = getTrailingExtraColumns(extraColumns, sections)

  return (
    <colgroup>
      {selectable ? <col style={{ width: SELECT_COLUMN_WIDTH }} /> : null}
      {hasChainAction ? <col style={{ width: CHAIN_ACTION_COLUMN_WIDTH }} /> : null}
      {hasRowActions ? <col style={{ width: ROW_ACTIONS_COLUMN_WIDTH }} /> : null}
      {sections.flatMap((section) => [
        ...extraColumns
          .filter((column) => column.insertBeforeSection === section.section)
          .map((column) => <col key={column.key} style={{ width: column.width }} />),
        ...section.fields.map((field) => <col key={field.key} style={{ width: getWeldColumnWidth(field.key) }} />),
      ])}
      {trailingExtraColumns.map((column) => (
        <col key={column.key} style={{ width: column.width }} />
      ))}
      {!readOnly ? <col style={{ width: ACTIONS_COLUMN_WIDTH }} /> : null}
    </colgroup>
  )
}

function getTrailingExtraColumns(columns: WeldTableExtraColumn[], sections: WeldTableDisplaySection[]) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection))
}
