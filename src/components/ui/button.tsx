import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg.lucide]:shrink-0 [&_svg.lucide]:[stroke-width:1.5]',
  {
    variants: {
      variant: {
        default: 'bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800 active:bg-sky-200/70 disabled:bg-slate-100 disabled:text-slate-500',
        secondary: 'bg-slate-100 text-slate-600 hover:bg-sky-50 hover:text-sky-700 active:bg-sky-100',
        outline: 'border border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 active:bg-sky-100',
        ghost: 'text-slate-500 hover:bg-sky-50 hover:text-sky-700 active:bg-sky-100',
        destructive: 'bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 active:bg-rose-200/70 focus-visible:ring-rose-300',
        warning: 'bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 active:bg-amber-200/70 focus-visible:ring-amber-300',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export function buttonVariants(options?: Parameters<typeof buttonStyles>[0]) {
  return cn(buttonStyles(options))
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
)
Button.displayName = 'Button'
