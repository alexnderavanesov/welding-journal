import { ListFilter } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type LnkRequestSubmitMode = 'create' | 'extend'

type LnkRequestModeToolbarProps = {
  mode: LnkRequestSubmitMode
  disabled?: boolean
  onModeChange: (mode: LnkRequestSubmitMode) => void
  onOpenRegistry: () => void
}

export function LnkRequestModeToolbar({
  mode,
  disabled = false,
  onModeChange,
  onOpenRegistry,
}: LnkRequestModeToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-1.5">
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Режим заявки ЛНК">
        <button
          type="button"
          aria-pressed={mode === 'create'}
          disabled={disabled}
          onClick={() => onModeChange('create')}
          className={`rounded px-4 py-1.5 text-sm font-medium transition ${
            mode === 'create' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Новая заявка
        </button>
        <button
          type="button"
          aria-pressed={mode === 'extend'}
          disabled={disabled}
          onClick={() => onModeChange('extend')}
          className={`rounded px-4 py-1.5 text-sm font-medium transition ${
            mode === 'extend' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Добавить в существующую
        </button>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onOpenRegistry}>
        <ListFilter className="mr-2 h-4 w-4" />
        Все заявки
      </Button>
    </div>
  )
}
