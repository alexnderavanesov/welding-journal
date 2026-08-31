import type { ReactNode } from 'react'

type ReportPageHeaderProps = {
  title: string
  stickyLeft: number
  children: ReactNode
}

export function ReportPageHeader({ title, stickyLeft, children }: ReportPageHeaderProps) {
  const viewportWidth = `calc(100vw - ${stickyLeft + 24}px)`

  return (
    <header
      className="sticky z-40 flex min-w-0 items-start gap-4 bg-[#f4f7f9]/95 pb-1 backdrop-blur-sm"
      style={{ left: stickyLeft, width: viewportWidth, maxWidth: viewportWidth }}
    >
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </header>
  )
}
