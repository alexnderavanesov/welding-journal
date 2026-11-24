import { workClosureTypeGroups } from '@/lib/work-closures'
import { Select } from './ui/select'

type Props = {
  value: string
  onChange: (value: string) => void
  testTypes: string[]
  beforeHeatTreatment: boolean
  previous?: string[]
  placeholder: string
  disabled?: boolean
}

export function WorkClosureTypeSelect({ value, onChange, testTypes, beforeHeatTreatment, previous = [], placeholder, disabled }: Props) {
  const groups = workClosureTypeGroups(testTypes, beforeHeatTreatment)
  const current = new Set(groups.flatMap(group => group.options.map(option => option.value)))
  const historical = previous.filter(name => !current.has(name))
  if (historical.length) {
    const tests = groups.findIndex(group => group.label === 'Испытания')
    groups.splice(tests + 1, 0, { label: 'Ранее сохранённые', options: historical.map(name => ({ value: name, label: name })) })
  }
  return <Select aria-label="Вид работы" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
    <option value="">{placeholder}</option>
    {groups.filter(group => group.options.length).map(group => <optgroup key={group.label} label={group.label}>
      {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </optgroup>)}
  </Select>
}
