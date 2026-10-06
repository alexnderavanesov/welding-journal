import type { ReactNode } from 'react'
import { getReportViewportWidth } from '@/lib/report-layout'

type ReportPageHeaderProps = {
  title: string
  stickyLeft: number
  children: ReactNode
  summary?: ReactNode
  fluid?: boolean
}

export function ReportPageHeader({
  title,
  stickyLeft,
  children,
  summary,
  fluid = false,
}: ReportPageHeaderProps) {
  const viewportWidth = getReportViewportWidth(stickyLeft)

  return (
    <header
      data-report-page-header
      className="sticky z-40 min-w-0 border-b border-slate-200 bg-white/95 pb-3 backdrop-blur-sm"
      style={fluid ? { left: 0, width: '100%', maxWidth: '100%' } : { left: stickyLeft, width: viewportWidth, maxWidth: viewportWidth }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="shrink-0 text-2xl font-semibold text-slate-950">{title}</h1>
        <div className={fluid ? 'min-w-0 flex-1 basis-full sm:basis-auto' : 'min-w-0 flex-1'} data-report-header-actions>
          {children}
        </div>
      </div>
      {summary ? (
        <div className="mt-2 border-t border-slate-100 pt-2" data-report-header-summary>
          {summary}
        </div>
      ) : null}
    </header>
  )
}
