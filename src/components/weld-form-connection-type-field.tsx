import type { Ref } from 'react'
import { Select } from '@/components/ui/select'
import { useDataListSettings } from '@/lib/data-list-settings'

type WeldFormConnectionTypeFieldProps = {
  value?: string | null
  inputRef?: Ref<HTMLSelectElement>
  onChange: (value: string | null) => void
}

export function WeldFormConnectionTypeField({ value, inputRef, onChange }: WeldFormConnectionTypeFieldProps) {
  const { connectionTypes } = useDataListSettings()
  const currentValue = String(value ?? '').trim()
  const hasCurrentValueOutsideList = currentValue && !connectionTypes.includes(currentValue)

  return (
    <Select
      ref={inputRef}
      value={currentValue}
      disabled={connectionTypes.length === 0 && !hasCurrentValueOutsideList}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{connectionTypes.length > 0 ? 'Пусто' : 'Добавьте значения в Настройки -> Данные'}</option>
      {hasCurrentValueOutsideList ? <option value={currentValue}>Текущее: {currentValue}</option> : null}
      {connectionTypes.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}
