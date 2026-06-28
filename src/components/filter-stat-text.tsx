import type { ReactNode } from 'react'

type FilterStatTextProps = {
  children: ReactNode
}

export function FilterStatText({ children }: FilterStatTextProps) {
  return <span className="whitespace-nowrap px-2 text-xs text-slate-500">{children}</span>
}
