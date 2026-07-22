import { Input } from '@/components/ui/input'
import type { RequestNamingState } from '@/lib/request-naming-state'
import { formatCustomRequestName } from '@/lib/report-naming'

export function RequestNamingControls({
  naming,
  systemName,
  label,
  placeholder = 'Введите наименование заявки',
  customDate,
  disabled = false,
  onChange,
}: {
  naming: RequestNamingState
  systemName: string
  label: string
  placeholder?: string
  customDate?: unknown
  disabled?: boolean
  onChange: (value: RequestNamingState) => void
}) {
  const customPreview = formatCustomRequestName(naming.customName, customDate)

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
        {(['system', 'custom'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...naming, mode })}
            disabled={disabled}
            className={`h-8 rounded px-3 text-sm font-medium transition-colors ${
              naming.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {mode === 'system' ? 'Системное' : 'Пользовательское'}
          </button>
        ))}
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-[13px] font-medium leading-none text-slate-700">{label}</span>
        {naming.mode === 'system' ? (
          <Input value={systemName} readOnly disabled={disabled} className="bg-slate-50 text-slate-600" />
        ) : (
          <>
            <Input
              autoFocus
              value={naming.customName}
              onChange={(event) => onChange({ ...naming, customName: event.target.value })}
              placeholder={placeholder}
              disabled={disabled}
            />
            {customPreview ? (
              <span className="block text-xs leading-4 text-slate-500">Будет сохранено: {customPreview}</span>
            ) : null}
          </>
        )}
      </label>
    </div>
  )
}
