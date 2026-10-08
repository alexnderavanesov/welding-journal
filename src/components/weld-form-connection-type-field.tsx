import type { Ref } from 'react'
import { Select } from '@/components/ui/select'
import { type DataListSettings, useDataListSettings } from '@/lib/data-list-settings'

type WeldFormDataListFieldProps = {
  listKey: Extract<keyof DataListSettings, 'connectionTypes'>
  value?: string | null
  inputRef?: Ref<HTMLSelectElement>
  onChange: (value: string | null) => void
}

export function WeldFormDataListField({ listKey, value, inputRef, onChange }: WeldFormDataListFieldProps) {
  const settings = useDataListSettings()
  const options = settings[listKey]
  const currentValue = String(value ?? '').trim()
  const hasCurrentValueOutsideList = currentValue && !options.includes(currentValue)

  return (
    <Select
      ref={inputRef}
      aria-label="Тип соединения"
      className="h-12"
      value={currentValue}
      disabled={options.length === 0 && !hasCurrentValueOutsideList}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{options.length > 0 ? 'Пусто' : 'Добавьте значения в Настройки -> Данные'}</option>
      {hasCurrentValueOutsideList ? <option value={currentValue}>Текущее: {currentValue}</option> : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}

export function WeldFormConnectionTypeField(props: Omit<WeldFormDataListFieldProps, 'listKey'>) {
  return <WeldFormDataListField {...props} listKey="connectionTypes" />
}
