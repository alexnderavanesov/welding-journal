import { ChevronDown, ChevronRight } from 'lucide-react'
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
  onToggleSection: (section: string) => void
}

export function WeldTableSectionHeaderRow({
  sections,
  alwaysVisibleFieldKeys,
  readOnly,
  onToggleSection,
}: WeldTableSectionHeaderRowProps) {
  return (
    <>
      {sections.map((group) => {
        const canCollapse = canCollapseSection(group.fields, alwaysVisibleFieldKeys)
        return (
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
              disabled={!canCollapse}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
                canCollapse ? 'hover:bg-slate-100' : 'cursor-not-allowed'
              }`}
              title={!canCollapse ? 'Обязательные поля всегда показаны' : group.collapsed ? 'Раскрыть раздел' : 'Скрыть раздел'}
            >
              {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {group.section}
            </button>
          </th>
        )
      })}
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
