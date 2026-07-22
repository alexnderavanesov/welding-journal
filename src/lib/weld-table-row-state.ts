export function getWeldTableRowClassName({
  readOnly,
  isHighlighted,
  isSelected,
  isDuplicate,
  hasDispatcherTask,
}: {
  readOnly: boolean
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
  hasDispatcherTask: boolean
}) {
  const baseClass = `group ${readOnly ? '' : 'cursor-pointer'} transition-colors duration-[25ms] ease-out motion-reduce:transition-none`
  if (isHighlighted) {
    return `${baseClass} bg-emerald-100/90 shadow-[inset_4px_0_0_rgb(16,185,129)] hover:bg-emerald-100`
  }
  if (isSelected) {
    return `${baseClass} bg-[#dff3ff] shadow-[inset_4px_0_0_rgb(14,165,233)] hover:bg-[#dff3ff]`
  }
  if (isDuplicate || hasDispatcherTask) {
    return `${baseClass} bg-amber-100/90 shadow-[inset_4px_0_0_rgb(245,158,11)] hover:bg-amber-100`
  }
  return `${baseClass} odd:bg-white even:bg-[#f8fafc] hover:bg-[#cfeeff]`
}

export function getWeldTableStickyCellBackgroundClassName({
  rowIndex,
  isHighlighted,
  isSelected,
  isDuplicate,
  hasDispatcherTask,
}: {
  rowIndex: number
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
  hasDispatcherTask: boolean
}) {
  if (isHighlighted) return 'bg-emerald-100 group-hover:bg-emerald-100'
  if (isSelected) return 'bg-[#dff3ff] group-hover:bg-[#dff3ff]'
  if (isDuplicate || hasDispatcherTask) return 'bg-amber-100 group-hover:bg-amber-100'
  return rowIndex % 2 === 0 ? 'bg-white group-hover:bg-[#cfeeff]' : 'bg-[#f8fafc] group-hover:bg-[#cfeeff]'
}

export function getWeldTableRowTitle({
  isHighlighted,
  isDuplicate,
  hasDispatcherTask,
}: {
  isHighlighted: boolean
  isDuplicate: boolean
  hasDispatcherTask: boolean
}) {
  if (isHighlighted) return 'Строка недавно изменена'
  if (isDuplicate) return 'Возможный дубль: совпадают ключевые поля стыка'
  if (hasDispatcherTask) return 'По этому стыку есть активная задача диспетчера'
  return undefined
}
