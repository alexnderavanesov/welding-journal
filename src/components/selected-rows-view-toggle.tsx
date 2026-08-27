export type SelectedRowsViewMode = 'all' | 'selected'

type SelectedRowsViewToggleProps = {
  mode: SelectedRowsViewMode
  selectedCount: number
  onChange: (mode: SelectedRowsViewMode) => void
}

export function SelectedRowsViewToggle({ mode, selectedCount, onChange }: SelectedRowsViewToggleProps) {
  return (
    <div
      className="inline-flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5"
      role="group"
      aria-label="Показать стыки"
    >
      <button
        type="button"
        aria-pressed={mode === 'all'}
        onClick={() => onChange('all')}
        className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${
          mode === 'all' ? 'bg-slate-100 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
        }`}
      >
        Все стыки
      </button>
      <button
        type="button"
        aria-pressed={mode === 'selected'}
        onClick={() => onChange('selected')}
        disabled={selectedCount === 0}
        className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${
          mode === 'selected' ? 'bg-sky-50 text-sky-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        Выбрано: {selectedCount}
      </button>
    </div>
  )
}
