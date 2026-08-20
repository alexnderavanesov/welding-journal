import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import { getWeldColumnWidth } from '@/lib/weld-column-widths'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'
import type { WeldTableDisplaySection } from '@/lib/weld-table-sections'
import { isStickyWeldTableField } from '@/lib/weld-table-sticky-columns'

export type WeldTableFieldSpan = {
  fieldKey: WeldFieldKey
  start: number
  end: number
  sticky: boolean
}

export type WeldTableRenderColumn =
  | {
      kind: 'field'
      key: string
      field: WeldField
      isSectionEnd: boolean
    }
  | {
      kind: 'extra'
      key: string
      column: WeldTableExtraColumn
    }
  | {
      kind: 'spacer'
      key: string
      colSpan: number
    }

export function buildWeldTableFieldSpans({
  sections,
  extraColumns,
  leadingWidth,
}: {
  sections: WeldTableDisplaySection[]
  extraColumns: WeldTableExtraColumn[]
  leadingWidth: number
}) {
  const spans: WeldTableFieldSpan[] = []
  let offset = leadingWidth

  for (const section of sections) {
    for (const column of extraColumns) {
      if (column.insertBeforeSection === section.section) offset += column.width
    }
    for (const field of section.fields) {
      const width = getWeldColumnWidth(field.key)
      spans.push({
        fieldKey: field.key as WeldFieldKey,
        start: offset,
        end: offset + width,
        sticky: isStickyWeldTableField(field.key),
      })
      offset += width
    }
  }

  return spans
}

export function getVisibleWeldTableFieldKeys({
  spans,
  viewportStart,
  viewportEnd,
  overscan,
}: {
  spans: WeldTableFieldSpan[]
  viewportStart: number
  viewportEnd: number
  overscan: number
}) {
  const start = viewportStart - overscan
  const end = viewportEnd + overscan
  return spans
    .filter((span) => span.sticky || (span.end >= start && span.start <= end))
    .map((span) => span.fieldKey)
}

export function buildWeldTableRenderColumns({
  sections,
  extraColumns,
  visibleFieldKeys,
}: {
  sections: WeldTableDisplaySection[]
  extraColumns: WeldTableExtraColumn[]
  visibleFieldKeys?: ReadonlySet<WeldFieldKey>
}) {
  const columns: WeldTableRenderColumn[] = []
  let skippedCount = 0
  let spacerIndex = 0

  const flushSpacer = () => {
    if (skippedCount === 0) return
    columns.push({
      kind: 'spacer',
      key: `horizontal-spacer-${spacerIndex}`,
      colSpan: skippedCount,
    })
    spacerIndex += 1
    skippedCount = 0
  }

  for (const section of sections) {
    for (const column of extraColumns) {
      if (column.insertBeforeSection !== section.section) continue
      flushSpacer()
      columns.push({ kind: 'extra', key: `extra-${column.key}`, column })
    }

    section.fields.forEach((field, fieldIndex) => {
      if (visibleFieldKeys && !visibleFieldKeys.has(field.key as WeldFieldKey)) {
        skippedCount += 1
        return
      }
      flushSpacer()
      columns.push({
        kind: 'field',
        key: `field-${field.key}`,
        field,
        isSectionEnd: fieldIndex === section.fields.length - 1,
      })
    })
  }

  flushSpacer()
  for (const column of getTrailingExtraColumns(extraColumns, sections)) {
    columns.push({ kind: 'extra', key: `extra-${column.key}`, column })
  }
  return columns
}

function getTrailingExtraColumns(
  columns: WeldTableExtraColumn[],
  sections: WeldTableDisplaySection[],
) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter(
    (column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection),
  )
}
