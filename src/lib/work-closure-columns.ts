// The first column keeps the original ID so saved column locations still apply.
export const closureColumns = {
  workType: { key: 'workClosureSummary', label: 'Вид работ', summary: 'Сводка по видам работ' },
  rateCode: { key: 'workClosureRateCode', label: 'Код работ', summary: 'Сводка по кодам работ' },
  actNumber: { key: 'workClosureActNumber', label: 'КС3', summary: 'Сводка по КС3' },
} as const
export type ClosureDimension = keyof typeof closureColumns
export const closureDimensions = ['workType', 'rateCode', 'actNumber'] as const
export const closureFieldKeys = closureDimensions.map(key => closureColumns[key].key)
export function closureDimension(fieldKey: string) {
  return closureDimensions.find(key => closureColumns[key].key === fieldKey)
}

export function closureListText(values: string[]) {
  return values.length < 2 ? values[0] ?? '' : values.map((value, i) => (i + 1) + '. ' + value).join(', ')
}
