import type { ReactNode } from 'react'

type LnkResultControlBarProps = {
  methodControl: ReactNode
  dateControl: ReactNode
  resultControl: ReactNode
  requestControl: ReactNode
  hint?: ReactNode
}

export function LnkResultControlBar({
  methodControl,
  dateControl,
  resultControl,
  requestControl,
  hint,
}: LnkResultControlBarProps) {
  return (
    <section className="shrink-0 border-b border-slate-200 bg-slate-50/40 px-5 py-2.5">
      <div className="grid gap-3 xl:grid-cols-[170px_190px_250px_minmax(360px,1fr)] xl:items-start">
        {methodControl}
        {dateControl}
        {resultControl}
        {requestControl}
      </div>
      <div className="mt-1.5 h-4 truncate text-xs leading-4 text-slate-500">
        {hint}
      </div>
    </section>
  )
}
