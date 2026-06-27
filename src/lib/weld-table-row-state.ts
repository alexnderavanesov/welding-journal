export function getWeldTableRowClassName({
  readOnly,
  isHighlighted,
  isSelected,
  isDuplicate,
}: {
  readOnly: boolean
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
}) {
  const baseClass = `${readOnly ? '' : 'cursor-pointer'} transition-[background-color,box-shadow] duration-300`
  if (isHighlighted) {
    return `${baseClass} bg-emerald-100/90 shadow-[inset_4px_0_0_rgb(16,185,129)] hover:bg-emerald-100`
  }
  if (isSelected) {
    return `${baseClass} bg-sky-50/90 shadow-[inset_4px_0_0_rgb(14,165,233)] hover:bg-sky-50`
  }
  if (isDuplicate) {
    return `${baseClass} bg-amber-100/90 shadow-[inset_4px_0_0_rgb(245,158,11)] hover:bg-amber-100`
  }
  return `${baseClass} hover:bg-slate-50/70`
}

export function getWeldTableRowTitle({
  isHighlighted,
  isDuplicate,
}: {
  isHighlighted: boolean
  isDuplicate: boolean
}) {
  if (isHighlighted) return 'Строка недавно изменена'
  if (isDuplicate) return 'Возможный дубль: совпадают ключевые поля стыка'
  return undefined
}
