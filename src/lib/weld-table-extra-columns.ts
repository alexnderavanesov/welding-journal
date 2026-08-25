import type { ReactNode } from 'react'

import type { WeldRow } from '@/lib/dispatcher-types'

export type WeldTableExtraColumn = {
  key: string
  section: string
  label: string
  width: number
  insertBeforeSection?: string
  collapsible?: boolean
  renderCell: (row: WeldRow) => ReactNode
}

export function getCollapsibleExtraSectionNames(columns: WeldTableExtraColumn[]) {
  return new Set(columns.filter((column) => column.collapsible).map((column) => column.section))
}

export function getVisibleWeldTableExtraColumns(
  columns: WeldTableExtraColumn[],
  collapsedSections: ReadonlySet<string>,
) {
  return columns.filter((column) => !column.collapsible || !collapsedSections.has(column.section))
}
