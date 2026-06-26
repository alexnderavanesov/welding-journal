import type { ReactNode } from 'react'

type ReportPageHeaderProps = {
  title: string
  stickyLeft: number
  minWidth: number
  children: ReactNode
}

export function ReportPageHeader({ title, stickyLeft, minWidth, children }: ReportPageHeaderProps) {
  return (
    <header
      className="sticky z-40 flex w-full items-start gap-4 bg-white pb-1"
      style={{ left: stickyLeft, minWidth }}
    >
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </header>
  )
}
