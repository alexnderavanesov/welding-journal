export function getTableLabel(fieldKey: string, label: string) {
  if (label.endsWith(' - факт')) {
    return (
      <span className="inline-flex flex-col items-center leading-tight">
        <span>{capitalizeFirstLetter(label.replace(' - факт', ''))}</span>
        <span className="text-[12px] font-medium text-slate-500">факт</span>
      </span>
    )
  }
  return capitalizeFirstLetter(label)
}

function capitalizeFirstLetter(value: string) {
  const firstLetterIndex = value.search(/\S/)
  if (firstLetterIndex === -1) return value
  return `${value.slice(0, firstLetterIndex)}${value[firstLetterIndex].toLocaleUpperCase('ru-RU')}${value.slice(firstLetterIndex + 1)}`
}
