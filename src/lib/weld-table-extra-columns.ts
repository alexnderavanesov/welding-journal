import type { ReactNode } from 'react'

import type { WeldRow } from '@/lib/dispatcher-types'

type WeldTableExtraColumnPlacement =
  | { insertBeforeSection?: string; insertAfterSection?: never }
  | { insertBeforeSection?: never; insertAfterSection?: string }

export type WeldTableExtraColumn = {
  key: string
  section: string
  label: string
  width: number
  appearance?: 'default' | 'quiet'
  collapsible?: boolean
  renderCell: (row: WeldRow) => ReactNode
} & WeldTableExtraColumnPlacement

export function getCollapsibleExtraSectionNames(columns: WeldTableExtraColumn[]) {
  return new Set(columns.filter((column) => column.collapsible).map((column) => column.section))
}

export function getVisibleWeldTableExtraColumns(
  columns: WeldTableExtraColumn[],
  collapsedSections: ReadonlySet<string>,
) {
  return columns.filter((column) => !column.collapsible || !collapsedSections.has(column.section))
}

export function getWeldTableExtraColumnsBeforeSection(
  columns: readonly WeldTableExtraColumn[],
  section: string,
) {
  return columns.filter((column) => column.insertBeforeSection === section)
}

export function getWeldTableExtraColumnsAfterSection(
  columns: readonly WeldTableExtraColumn[],
  section: string,
) {
  return columns.filter((column) => column.insertAfterSection === section)
}

export function getTrailingWeldTableExtraColumns(
  columns: readonly WeldTableExtraColumn[],
  sections: readonly { section: string }[],
) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => {
    const anchorSection = column.insertBeforeSection ?? column.insertAfterSection
    return !anchorSection || !sectionNames.has(anchorSection)
  })
}
