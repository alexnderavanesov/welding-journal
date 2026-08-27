import { MoreHorizontal } from 'lucide-react'
import type { MouseEvent } from 'react'

type DialogRowMenuButtonProps = {
  label: string
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
}

export function DialogRowMenuButton({ label, onOpen }: DialogRowMenuButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 group-hover/dialog-row:opacity-100"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(event)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(event)
      }}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  )
}
