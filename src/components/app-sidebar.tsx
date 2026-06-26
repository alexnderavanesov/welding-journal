import { ClipboardCheck, Flame, NotebookTabs, PanelLeftClose, PanelLeftOpen, Stamp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ActiveReport } from '@/lib/home-state'

type AppSidebarProps = {
  activeReport: ActiveReport
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onReportChange: (report: ActiveReport) => void
}

const sidebarItems: Array<{
  report: ActiveReport
  label: string
  icon: typeof NotebookTabs
}> = [
  { report: 'weldingJournal', label: 'Сварочный журнал', icon: NotebookTabs },
  { report: 'heatTreatment', label: 'Термообработка', icon: Flame },
  { report: 'lnk', label: 'ЛНК', icon: ClipboardCheck },
  { report: 'welderStamps', label: 'Клейма', icon: Stamp },
]

export function AppSidebar({ activeReport, collapsed, onCollapsedChange, onReportChange }: AppSidebarProps) {
  return (
    <aside
      className={`fixed left-0 top-0 z-30 h-screen border-r border-slate-100 bg-white px-3 py-5 transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-48 lg:w-64 lg:px-4'
      }`}
    >
      <div className={`mb-3 flex items-start ${collapsed ? 'justify-center [&>div]:sr-only' : 'justify-between gap-3'}`}>
        <div className="text-lg font-semibold tracking-tight">Сварка</div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          title={collapsed ? 'Раскрыть меню' : 'Скрыть меню'}
          className="h-9 w-9 shrink-0"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="space-y-1">
        {sidebarItems.map((item) => {
          const Icon = item.icon
          const isActive = activeReport === item.report
          return (
            <button
              key={item.report}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              } ${collapsed ? 'justify-center px-0' : ''}`}
              onClick={() => onReportChange(item.report)}
              title={item.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
