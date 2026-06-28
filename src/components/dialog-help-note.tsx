import type { ReactNode } from 'react'

type DialogHelpNoteProps = {
  children: ReactNode
}

export function DialogHelpNote({ children }: DialogHelpNoteProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
      {children}
    </div>
  )
}
