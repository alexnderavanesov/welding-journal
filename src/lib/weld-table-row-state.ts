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
  const baseClass = `group ${readOnly ? '' : 'cursor-pointer'} transition-colors duration-[25ms] ease-out motion-reduce:transition-none`
  if (isHighlighted) {
    return `${baseClass} bg-emerald-100/90 shadow-[inset_4px_0_0_rgb(16,185,129)] hover:bg-emerald-100`
  }
  if (isSelected) {
    return `${baseClass} bg-sky-50/90 shadow-[inset_4px_0_0_rgb(14,165,233)] hover:bg-sky-50`
  }
  if (isDuplicate) {
    return `${baseClass} bg-amber-100/90 shadow-[inset_4px_0_0_rgb(245,158,11)] hover:bg-amber-100`
  }
  return `${baseClass} odd:bg-white even:bg-[#f8fafc] hover:bg-[#dff1fb]`
}

export function getWeldTableStickyCellBackgroundClassName({
  rowIndex,
  isHighlighted,
  isSelected,
  isDuplicate,
}: {
  rowIndex: number
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
}) {
  if (isHighlighted) return 'bg-emerald-100 group-hover:bg-emerald-100'
  if (isSelected) return 'bg-sky-50 group-hover:bg-[#dff1fb]'
  if (isDuplicate) return 'bg-amber-100 group-hover:bg-amber-100'
  return rowIndex % 2 === 0 ? 'bg-white group-hover:bg-[#dff1fb]' : 'bg-[#f8fafc] group-hover:bg-[#dff1fb]'
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
