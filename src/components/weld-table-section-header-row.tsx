import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import { canCollapseSection } from '@/lib/weld-table-utils'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'

type WeldTableSectionGroup = {
  section: string
  fields: WeldField[]
  collapsed: boolean
}

type WeldTableSectionHeaderRowProps = {
  sections: WeldTableSectionGroup[]
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
  readOnly: boolean
  extraColumns: WeldTableExtraColumn[]
  onToggleSection: (section: string) => void
}

export function WeldTableSectionHeaderRow({
  sections,
  alwaysVisibleFieldKeys,
  readOnly,
  extraColumns,
  onToggleSection,
}: WeldTableSectionHeaderRowProps) {
  const trailingExtraSections = groupExtraColumnsBySection(getTrailingExtraColumns(extraColumns, sections))

  return (
    <>
      {sections.flatMap((group) => {
        const canCollapse = canCollapseSection(group.fields, alwaysVisibleFieldKeys)
        const canToggle = group.collapsed || canCollapse
        const insertedExtraSections = groupExtraColumnsBySection(
          extraColumns.filter((column) => column.insertBeforeSection === group.section),
        )
        return [
          ...insertedExtraSections.map((extraGroup) => (
            <ExtraSectionHeader key={`extra-${extraGroup.section}`} section={extraGroup.section} colSpan={extraGroup.fields.length} />
          )),
          <th
            key={group.section}
            colSpan={group.fields.length}
            className={`border-r border-slate-200/70 px-3 py-3 text-center text-[13px] font-bold tracking-wide shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)] ${
              group.collapsed ? 'bg-slate-50 text-slate-500' : 'text-slate-700'
            }`}
          >
            <button
              type="button"
              onClick={() => onToggleSection(group.section)}
              disabled={!canToggle}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
                canToggle ? 'hover:bg-slate-100' : 'cursor-not-allowed'
              }`}
              title={!canToggle ? 'Обязательные поля всегда показаны' : group.collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
            >
              {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {getSectionTitle(group.section)}
            </button>
          </th>,
        ]
      })}
      {trailingExtraSections.map((group) => (
        <ExtraSectionHeader key={`extra-${group.section}`} section={group.section} colSpan={group.fields.length} />
      ))}
      {!readOnly ? (
        <th
          rowSpan={2}
          className="w-24 border-r border-slate-200/70 px-3 py-2.5 text-right text-xs font-semibold text-slate-500 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
        >
          Действия
        </th>
      ) : null}
    </>
  )
}

function ExtraSectionHeader({ section, colSpan }: { section: string; colSpan: number }) {
  return (
    <th
      colSpan={colSpan}
      className="border-r border-slate-200/70 px-3 py-3 text-center text-[13px] font-bold tracking-wide text-slate-700 shadow-[inset_0_1px_0_0_rgb(241,245,249),inset_0_-1px_0_0_rgb(226,232,240)]"
    >
      <span className="inline-flex items-center gap-1.5 rounded px-2 py-1">{getSectionTitle(section)}</span>
    </th>
  )
}

function getSectionTitle(section: string) {
  return section === 'Контроль' ? 'Назначения' : section
}

function groupExtraColumnsBySection(columns: WeldTableExtraColumn[]) {
  const groups: Array<{ section: string; fields: WeldTableExtraColumn[] }> = []
  for (const column of columns) {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup?.section === column.section) {
      lastGroup.fields.push(column)
    } else {
      groups.push({ section: column.section, fields: [column] })
    }
  }
  return groups
}

function getTrailingExtraColumns(columns: WeldTableExtraColumn[], sections: WeldTableSectionGroup[]) {
  const sectionNames = new Set(sections.map((section) => section.section))
  return columns.filter((column) => !column.insertBeforeSection || !sectionNames.has(column.insertBeforeSection))
}
