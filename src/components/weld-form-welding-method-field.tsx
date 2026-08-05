import type { Ref } from 'react'
import { type DataListSettings, useDataListSettings } from '@/lib/data-list-settings'

type WeldFormWeldingMethodFieldProps = {
  value?: string | null
  inputRef?: Ref<HTMLButtonElement>
  onChange: (value: string | null) => void
}

export function WeldFormWeldingMethodField({ value, inputRef, onChange }: WeldFormWeldingMethodFieldProps) {
  return (
    <WeldFormMultiDataListField
      listKey="weldingTypes"
      ariaLabel="Способ сварки"
      value={value}
      inputRef={inputRef}
      onChange={onChange}
    />
  )
}

export function WeldFormTestTypesField(props: WeldFormWeldingMethodFieldProps) {
  return <WeldFormMultiDataListField {...props} listKey="testTypes" ariaLabel="Вид испытаний" />
}

function WeldFormMultiDataListField({
  listKey,
  ariaLabel,
  value,
  inputRef,
  onChange,
}: WeldFormWeldingMethodFieldProps & {
  listKey: Extract<keyof DataListSettings, 'weldingTypes' | 'testTypes'>
  ariaLabel: string
}) {
  const settings = useDataListSettings()
  const options = settings[listKey]
  const separator = listKey === 'weldingTypes' ? '+' : ', '
  const selectedMethods = getSelectedMultiValues(value, options, listKey)

  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5 shadow-sm"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => {
        const selected = selectedMethods.includes(option)
        return (
          <button
            key={option}
            ref={index === 0 ? inputRef : undefined}
            type="button"
            onClick={() => onChange(toggleMultiValue(value, option, options, listKey, separator))}
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
      {options.length === 0 ? <span className="px-1 text-xs text-slate-500">Добавьте значения в Настройки → Данные</span> : null}
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

function getSelectedMultiValues(
  value: string | null | undefined,
  options: readonly string[],
  listKey: 'weldingTypes' | 'testTypes',
) {
  const parts = String(value ?? '')
    .split(listKey === 'weldingTypes' ? /[+,;]+/ : /[,;+]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const selected = new Set(parts)
  return options.filter((option) => selected.has(option))
}

function toggleMultiValue(
  value: string | null | undefined,
  option: string,
  options: readonly string[],
  listKey: 'weldingTypes' | 'testTypes',
  separator: string,
) {
  const selected = new Set(getSelectedMultiValues(value, options, listKey))
  if (selected.has(option)) selected.delete(option)
  else selected.add(option)
  return options.filter((item) => selected.has(item)).join(separator) || null
}
