import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ReportShowMenuItem = {
  label: string
  onClick: () => void
}

export type ReportShowMenuProps = {
  label?: string
  isOpen: boolean
  onToggle: () => void
  items: ReportShowMenuItem[]
  widthClassName?: string
}

export function ReportShowMenu({ label = 'Показать', isOpen, onToggle, items, widthClassName = 'w-52' }: ReportShowMenuProps) {
  return (
    <div className="relative">
      <Button variant="outline" onClick={onToggle}>
        {label}
        <ChevronDown className="ml-2 h-4 w-4" />
      </Button>
      {isOpen ? (
        <div
          className={`absolute right-0 z-50 mt-2 rounded-md border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10 ${widthClassName}`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-normal leading-5 text-slate-800 hover:bg-sky-50 hover:text-sky-900"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
