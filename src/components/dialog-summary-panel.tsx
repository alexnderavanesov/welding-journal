import type { ReactNode } from 'react'

type DialogSummaryPanelProps = {
  title: string
  children: ReactNode
}

type DialogSummaryStatProps = {
  label: string
  value: ReactNode
}

export function DialogSummaryPanel({ title, children }: DialogSummaryPanelProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </div>
  )
}

export function DialogSummaryStat({ label, value }: DialogSummaryStatProps) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
      {label}: <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}
