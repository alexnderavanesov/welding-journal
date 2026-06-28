export function getTableLabel(fieldKey: string, label: string) {
  const tableLabel = fieldKey === 'orderCode1' ? 'ID материала 1' : fieldKey === 'orderCode2' ? 'ID материала 2' : label
  if (tableLabel.endsWith(' - факт')) {
    return (
      <span className="inline-flex flex-col items-center leading-tight">
        <span>{capitalizeFirstLetter(tableLabel.replace(' - факт', ''))}</span>
        <span className="text-[12px] font-medium text-slate-500">факт</span>
      </span>
    )
  }
  return capitalizeFirstLetter(tableLabel)
}

function capitalizeFirstLetter(value: string) {
  const firstLetterIndex = value.search(/\S/)
  if (firstLetterIndex === -1) return value
  return `${value.slice(0, firstLetterIndex)}${value[firstLetterIndex].toLocaleUpperCase('ru-RU')}${value.slice(firstLetterIndex + 1)}`
}
