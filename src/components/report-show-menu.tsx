import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ReportShowMenuItem = {
  label: string
  onClick: () => void
  disabled?: boolean
}

export type ReportShowMenuProps = {
  label?: string
  isOpen: boolean
  onToggle: () => void
  items: ReportShowMenuItem[]
  widthClassName?: string
  buttonClassName?: string
  disabled?: boolean
}

export function ReportShowMenu({
  label = 'Показать',
  isOpen,
  onToggle,
  items,
  widthClassName = 'w-52',
  buttonClassName,
  disabled,
}: ReportShowMenuProps) {
  return (
    <div className="relative" data-report-show-menu>
      <Button variant="outline" onClick={onToggle} className={buttonClassName} disabled={disabled} aria-expanded={isOpen}>
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
              onClick={event => {
                // Safari does not focus buttons on mouse click. Capture the
                // menu as the return target before opening a report dialog.
                event.currentTarget.focus({ preventScroll: true })
                item.onClick()
              }}
              disabled={item.disabled}
              title={item.disabled ? 'Дождитесь загрузки строк текущей выборки.' : undefined}
              className="flex min-h-10 w-full items-center rounded px-3 py-2 text-left text-sm font-normal leading-5 text-slate-800 hover:bg-sky-50 hover:text-sky-900 disabled:cursor-wait disabled:text-slate-400 disabled:hover:bg-transparent"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
