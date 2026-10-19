import { isAgGridWeldReport } from '@/lib/weld-report-grid-profile'
import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import type { ActiveReport } from '@/lib/home-state'
import './welding-journal-ui.css'

type ReportWorkspaceProps = {
  activeReport: ActiveReport
  navCollapsed: boolean
  registerMinWidth: number
  children: ReactNode
  onNavCollapsedChange: (collapsed: boolean) => void
  onReportChange: (report: ActiveReport) => void
}

export function ReportWorkspace({
  activeReport,
  navCollapsed,
  registerMinWidth,
  children,
  onNavCollapsedChange,
  onReportChange,
}: ReportWorkspaceProps) {
  const isFluidReport =
    isAgGridWeldReport(activeReport) ||
    activeReport === 'statistics' ||
    activeReport === 'percentageLines' ||
    activeReport === 'welderStamps' ||
    activeReport === 'documents' ||
    activeReport === 'settings' ||
    activeReport === 'userGuide'
  const isWideTableReport =
    isAgGridWeldReport(activeReport) ||
    activeReport === 'lnk'
  const workspaceBackgroundClass = isWideTableReport || activeReport === 'percentageLines' ? 'bg-white' : 'bg-[#f4f7f9]'

  return (
    <main className={`relative min-h-screen ${workspaceBackgroundClass}`} onContextMenuCapture={event => { if (isAgGridWeldReport(activeReport)) event.preventDefault() }}>
      <AppSidebar
        activeReport={activeReport}
        collapsed={navCollapsed}
        onCollapsedChange={onNavCollapsedChange}
        onReportChange={onReportChange}
      />

      <div
        className={`min-w-0 ${workspaceBackgroundClass} pt-5 transition-[padding-left] duration-200 ${isAgGridWeldReport(activeReport) ? 'pr-4' : 'pr-6'} ${
          isAgGridWeldReport(activeReport) ? (navCollapsed ? 'pl-[72px]' : 'pl-[200px] lg:pl-[280px]') : (navCollapsed ? 'pl-20' : 'pl-52 lg:pl-72')
        }`}
      >
        <div
          data-scroll-top-boundary
          className={`space-y-3 ${workspaceBackgroundClass} pb-5 ${
            isFluidReport ? 'min-w-0 w-full' : 'min-w-full w-max'
          }`}
          style={isFluidReport ? undefined : { minWidth: registerMinWidth }}
        >
          {children}
        </div>
      </div>
    </main>
  )
}
