import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Select } from './ui/select'
import { cn } from '@/lib/utils'

/** Native keyboard behaviour, with a reserved arrow gutter and shared dialog styling. */
export function ProgramCalculationSelect({ label, ariaLabel, value, title, onChange, children, className }: {
  label: string; ariaLabel: string; value: string; title?: string
  onChange: (value: string) => void; children: ReactNode; className?: string
}) {
  return <label className={cn('block min-w-0 space-y-1.5', className)}>
    <span className="block text-xs font-medium leading-4 text-slate-500">{label}</span>
    <span className="relative block min-w-0">
      <Select aria-label={ariaLabel} title={title} value={value} onChange={event => onChange(event.target.value)}
        className="h-10 min-w-0 appearance-none truncate rounded-xl border-slate-200 bg-none pl-3 pr-10 text-sm font-medium text-slate-700 shadow-sm shadow-slate-200/30 hover:border-slate-300 focus-visible:border-sky-400 focus-visible:ring-sky-100">
        {children}
      </Select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </span>
  </label>
}
