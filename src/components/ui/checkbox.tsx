import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

/** Native input semantics keep labels, Space, focus and indeterminate selection intact. */
export const Checkbox = forwardRef<HTMLInputElement, Omit<ComponentPropsWithoutRef<'input'>, 'type'>>(
  ({ className, ...props }, ref) => <input {...props} ref={ref} type="checkbox"
    className={cn('h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-[5px] border-slate-300 bg-white text-sky-600 shadow-sm shadow-slate-200/40 focus:ring-2 focus:ring-sky-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', className)} />,
)
Checkbox.displayName = 'Checkbox'
