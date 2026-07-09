import {
  BarChart3,
  ClipboardCheck,
  FileText,
  Flame,
  NotebookTabs,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Settings,
  Stamp,
} from 'lucide-react'
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
  { report: 'percentageLines', label: 'Процентные линии', icon: Percent },
  { report: 'statistics', label: 'Статистика', icon: BarChart3 },
  { report: 'documents', label: 'Документы', icon: FileText },
]

export function AppSidebar({ activeReport, collapsed, onCollapsedChange, onReportChange }: AppSidebarProps) {
  const settingsItem = { report: 'settings' as const, label: 'Настройки', icon: Settings }

  return (
    <aside
      className={`fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-slate-100 bg-white px-3 py-5 transition-[width] duration-200 ${
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
      <nav className="mt-auto border-t border-slate-100 pt-3">
        {(() => {
          const Icon = settingsItem.icon
          const isActive = activeReport === settingsItem.report
          return (
            <button
              key={settingsItem.report}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                isActive ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              } ${collapsed ? 'justify-center px-0' : ''}`}
              onClick={() => onReportChange(settingsItem.report)}
              title={settingsItem.label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className={collapsed ? 'sr-only' : ''}>{settingsItem.label}</span>
            </button>
          )
        })()}
      </nav>
    </aside>
  )
}
