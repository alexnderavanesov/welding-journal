import * as React from 'react'
import { cn } from '@/lib/utils'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, value, ...props }, ref) => {
    const isEmptyValue = value === '' || value === null || value === undefined

    return (
      <select
        ref={ref}
        value={value}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm shadow-slate-200/40 outline-none hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-70',
          isEmptyValue ? 'text-slate-400' : 'text-slate-800',
          className,
        )}
        {...props}
      />
    )
  },
)
Select.displayName = 'Select'
