import { ChevronDown, ChevronRight } from 'lucide-react'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'
import { canCollapseSection } from '@/lib/weld-table-utils'

type WeldTableSectionToolbarProps = {
  sections: Array<{ section: string; fields: WeldField[] }>
  collapsedSections: ReadonlySet<string>
  alwaysVisibleFieldKeys: ReadonlySet<WeldFieldKey>
  tableMinWidth: number
  stickyLeft: number
  onToggleSection: (section: string) => void
}

export function WeldTableSectionToolbar({
  sections,
  collapsedSections,
  alwaysVisibleFieldKeys,
  tableMinWidth,
  stickyLeft,
  onToggleSection,
}: WeldTableSectionToolbarProps) {
  return (
    <div
      className="sticky z-20 flex flex-wrap items-center gap-2 rounded-md border border-slate-100 bg-white px-3 py-2 shadow-sm shadow-slate-200/30"
      style={{ left: stickyLeft, minWidth: tableMinWidth }}
    >
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Разделы</span>
      {sections.map((group) => {
        const canCollapse = canCollapseSection(group.fields, alwaysVisibleFieldKeys)
        const collapsed = canCollapse && collapsedSections.has(group.section)
        const visibleCount = collapsed
          ? group.fields.filter((field) => alwaysVisibleFieldKeys.has(field.key)).length
          : group.fields.length

        return (
          <button
            key={group.section}
            type="button"
            onClick={() => onToggleSection(group.section)}
            disabled={!canCollapse}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              !canCollapse
                ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-500'
                : collapsed
                  ? 'border-slate-100 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
            title={!canCollapse ? 'Обязательные поля всегда показаны' : collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {getSectionTitle(group.section)}
            <span className="text-slate-400">
              {visibleCount}/{group.fields.length}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function getSectionTitle(section: string) {
  return section === 'Контроль' ? 'Назначение' : section
}
