import { ChevronDown, ChevronRight } from 'lucide-react'

type WeldFormSectionHeaderProps = {
  section: string
  fieldsCount: number
  collapsed: boolean
  onToggle: () => void
}

export function WeldFormSectionHeader({ section, fieldsCount, collapsed, onToggle }: WeldFormSectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-4 flex w-full items-center gap-3 rounded-sm text-left transition-colors hover:text-slate-900"
      aria-expanded={!collapsed}
    >
      {collapsed ? <ChevronRight className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section}</h3>
      <div className="h-px flex-1 bg-slate-200/80" />
      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
        {collapsed ? 'Скрыто' : `${fieldsCount}`}
      </span>
    </button>
  )
}
