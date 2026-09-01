import type { ReactNode } from 'react'

type ReportPageHeaderProps = {
  title: string
  stickyLeft: number
  children: ReactNode
}

export function ReportPageHeader({
  title,
  stickyLeft,
  children,
}: ReportPageHeaderProps) {
  const viewportWidth = `calc(100vw - ${stickyLeft + 24}px)`

  return (
    <header
      className="sticky z-40 min-w-0 bg-[#f4f7f9]/95 pb-1 backdrop-blur-sm"
      style={{ left: stickyLeft, width: viewportWidth, maxWidth: viewportWidth }}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
        <h1 className="shrink-0 text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </header>
  )
}
