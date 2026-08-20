import { type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

type WeldFormSectionHeaderProps = {
  section: string
  fieldsCount: number
  collapsed: boolean
  onToggle: () => void
  actions?: ReactNode
  statusCount?: number
  statusLabel?: string
}

export function WeldFormSectionHeader({
  section,
  fieldsCount,
  collapsed,
  onToggle,
  actions,
  statusCount = 0,
  statusLabel = 'Изменено',
}: WeldFormSectionHeaderProps) {
  return (
    <div className="mb-4 flex w-full items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left transition-colors hover:text-slate-900"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />}
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section}</h3>
        <div className="h-px flex-1 bg-slate-200/80" />
      </button>
      {actions ? <div className="shrink-0">{actions}</div> : null}
      {statusCount > 0 ? (
        <span className="shrink-0 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
          {statusLabel}: {statusCount}
        </span>
      ) : null}
      <span className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
        {collapsed ? 'Скрыто' : `${fieldsCount}`}
      </span>
    </div>
  )
}
