import type { ReactNode } from 'react'
import { getReportViewportWidth } from '@/lib/report-layout'

type ReportPageHeaderProps = {
  title: string
  stickyLeft: number
  children?: ReactNode
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
      className="sticky z-40 min-w-0 shrink-0 bg-inherit py-0.5"
      style={fluid ? { left: 0, width: '100%', maxWidth: '100%' } : { left: stickyLeft, width: viewportWidth, maxWidth: viewportWidth }}
    >
      <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="min-w-0 text-xl font-semibold leading-7 tracking-tight text-slate-800">{title}</h1>
        {children ? <div className={fluid ? 'min-w-0 flex-1 basis-full sm:basis-auto' : 'min-w-0 flex-1'} data-report-header-actions>
          {children}
        </div> : null}
      </div>
      {summary ? (
        <div className="mt-1 text-sm leading-5 text-slate-500" data-report-header-summary>
          {summary}
        </div>
      ) : null}
    </header>
  )
}
