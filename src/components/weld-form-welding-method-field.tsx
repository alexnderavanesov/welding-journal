import type { Ref } from 'react'
import { useDataListSettings } from '@/lib/data-list-settings'
import { getSelectedWeldingMethods, toggleWeldingMethodValue } from '@/lib/weld-form-utils'

type WeldFormWeldingMethodFieldProps = {
  value?: string | null
  inputRef?: Ref<HTMLButtonElement>
  onChange: (value: string | null) => void
}

export function WeldFormWeldingMethodField({ value, inputRef, onChange }: WeldFormWeldingMethodFieldProps) {
  const { weldingTypes } = useDataListSettings()
  const selectedMethods = getSelectedWeldingMethods(value, weldingTypes)

  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5 shadow-sm"
      role="group"
      aria-label="Способ сварки"
    >
      {weldingTypes.map((option, index) => {
        const selected = selectedMethods.includes(option)
        return (
          <button
            key={option}
            ref={index === 0 ? inputRef : undefined}
            type="button"
            onClick={() => onChange(toggleWeldingMethodValue(value, option, weldingTypes))}
            className={[
              'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
              selected
                ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-200 hover:bg-sky-50',
            ].join(' ')}
            aria-pressed={selected}
          >
            {option}
          </button>
        )
      })}
      {selectedMethods.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
        >
          Очистить
        </button>
      ) : null}
    </div>
  )
}
