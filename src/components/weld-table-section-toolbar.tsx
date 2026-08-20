import { ChevronDown, ChevronRight, Columns3 } from 'lucide-react'
import type { WeldField } from '@/lib/weld-fields'
import { canCollapseSection } from '@/lib/weld-table-section-state'

type WeldTableSectionToolbarProps = {
  sections: Array<{ section: string; fields: WeldField[] }>
  collapsedSections: ReadonlySet<string>
  alwaysVisibleFieldKeys: ReadonlySet<string>
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
      className="sticky z-20 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/95 px-2.5 py-1.5 shadow-sm shadow-slate-200/30 backdrop-blur"
      style={{ left: stickyLeft, minWidth: tableMinWidth }}
    >
      <span className="mr-1 inline-flex h-7 items-center gap-1.5 text-xs font-semibold text-slate-600">
        <Columns3 className="h-3.5 w-3.5 text-slate-400" />
        Разделы
      </span>
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
