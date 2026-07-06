import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import type { ActiveReport } from '@/lib/home-state'

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
  const isFluidReport = activeReport === 'statistics' || activeReport === 'welderStamps'

  return (
    <main className="relative min-h-screen bg-white">
      <AppSidebar
        activeReport={activeReport}
        collapsed={navCollapsed}
        onCollapsedChange={onNavCollapsedChange}
        onReportChange={onReportChange}
      />

      <div
        className={`min-w-0 bg-white py-5 pr-4 transition-[padding-left] duration-200 lg:pr-6 ${
          navCollapsed ? 'pl-20' : 'pl-52 lg:pl-72'
        }`}
      >
        <div
          className={`space-y-4 bg-white ${
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
