import { ChevronDown, ChevronRight, Columns3 } from 'lucide-react'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'
import type { WeldField } from '@/lib/weld-fields'
import { canCollapseSection } from '@/lib/weld-table-section-state'
import type { ReactNode } from 'react'

type WeldTableSectionToolbarProps = {
  sections: Array<{ section: string; fields: WeldField[] }>
  extraColumns: WeldTableExtraColumn[]
  collapsedSections: ReadonlySet<string>
  alwaysVisibleFieldKeys: ReadonlySet<string>
  tableMinWidth: number
  stickyLeft: number
  onToggleSection: (section: string) => void
  viewControls?: ReactNode
}

export function WeldTableSectionToolbar({
  sections,
  extraColumns,
  collapsedSections,
  alwaysVisibleFieldKeys,
  tableMinWidth,
  stickyLeft,
  onToggleSection,
  viewControls,
}: WeldTableSectionToolbarProps) {
  const controls = getSectionControls(sections, extraColumns)
  const toolbarWidth = Math.max(0, tableMinWidth)

  return (
    <div
      className="sticky z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/95 px-2.5 py-1.5 shadow-sm shadow-slate-200/30 backdrop-blur"
      style={{ left: stickyLeft, width: toolbarWidth, minWidth: toolbarWidth }}
    >
      <span className="mr-1 inline-flex h-7 items-center gap-1.5 text-xs font-semibold text-slate-600">
        <Columns3 className="h-3.5 w-3.5 text-slate-400" />
        Разделы
      </span>
      {controls.map((group) => {
        const isExtra = group.kind === 'extra'
        const canCollapse = isExtra
          ? group.columns.some((column) => column.collapsible)
          : canCollapseSection(group.fields, alwaysVisibleFieldKeys)
        const collapsed = canCollapse && collapsedSections.has(group.section)
        const fieldCount = isExtra ? group.columns.length : group.fields.length
        const visibleCount = collapsed
          ? isExtra
            ? 0
            : group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key)).length
          : fieldCount

        return (
          <button
            key={group.section}
            type="button"
            onClick={() => onToggleSection(group.section)}
            disabled={!canCollapse}
            className={`inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors ${
              !canCollapse
                ? 'cursor-not-allowed border-slate-100 bg-white/60 text-slate-400'
                : collapsed
                  ? 'border-transparent bg-transparent text-slate-400 hover:border-slate-200 hover:bg-white hover:text-slate-600'
                  : 'border-sky-200 bg-white text-slate-800 shadow-sm shadow-sky-100/50 hover:bg-sky-50'
            }`}
            title={!canCollapse ? 'Обязательные поля всегда показаны' : collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {getSectionTitle(group.section)}
            <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${collapsed ? 'bg-slate-100 text-slate-400' : 'bg-sky-50 text-sky-700'}`}>
              {visibleCount}/{fieldCount}
            </span>
          </button>
        )
      })}
      {viewControls}
    </div>
  )
}

type SectionControl =
  | { kind: 'fields'; section: string; fields: WeldField[] }
  | { kind: 'extra'; section: string; columns: WeldTableExtraColumn[] }

function getSectionControls(
  sections: Array<{ section: string; fields: WeldField[] }>,
  extraColumns: WeldTableExtraColumn[],
): SectionControl[] {
  const extraGroups = groupCollapsibleExtraColumns(extraColumns)
  const sectionNames = new Set(sections.map((section) => section.section))
  const controls: SectionControl[] = []

  for (const section of sections) {
    controls.push(
      ...extraGroups.filter((group) => group.insertBeforeSection === section.section),
      { kind: 'fields', ...section },
      ...extraGroups.filter((group) => group.insertAfterSection === section.section),
    )
  }
  controls.push(
    ...extraGroups.filter((group) => {
      const anchorSection = group.insertBeforeSection ?? group.insertAfterSection
      return !anchorSection || !sectionNames.has(anchorSection)
    }),
  )
  return controls
}

function groupCollapsibleExtraColumns(columns: WeldTableExtraColumn[]) {
  const groups = new Map<string, Extract<SectionControl, { kind: 'extra' }> & {
    insertBeforeSection?: string
    insertAfterSection?: string
  }>()
  for (const column of columns) {
    if (!column.collapsible) continue
    const group = groups.get(column.section)
    if (group) {
      group.columns.push(column)
    } else {
      groups.set(column.section, {
        kind: 'extra',
        section: column.section,
        columns: [column],
        insertBeforeSection: column.insertBeforeSection,
        insertAfterSection: column.insertAfterSection,
      })
    }
  }
  return [...groups.values()]
}

function getSectionTitle(section: string) {
  return section === 'Контроль' ? 'Назначение' : section
}
