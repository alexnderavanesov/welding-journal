export function getWeldTableRowClassName({
  rowIndex,
  readOnly,
  isHighlighted,
  isSelected,
  isDuplicate,
  hasDispatcherTask,
  isContextMenuAnchor,
}: {
  rowIndex: number
  readOnly: boolean
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
  hasDispatcherTask: boolean
  isContextMenuAnchor?: boolean
}) {
  const baseClass = `weld-table-row h-[52px] ${readOnly ? '' : 'cursor-pointer'} transition-none`
  if (isHighlighted) {
    return `${baseClass} bg-emerald-100/90 shadow-[inset_4px_0_0_rgb(16,185,129)]`
  }
  if (isSelected) {
    return `${baseClass} bg-[#dff3ff] shadow-[inset_4px_0_0_rgb(14,165,233)]`
  }
  if (isDuplicate || hasDispatcherTask) {
    return `${baseClass} bg-amber-100/90 shadow-[inset_4px_0_0_rgb(245,158,11)]`
  }
  if (isContextMenuAnchor) {
    return `${baseClass} bg-[#cfeeff]`
  }
  return `${baseClass} weld-table-row--hoverable ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}`
}

export function getWeldTableStickyCellBackgroundClassName({
  rowIndex,
  isHighlighted,
  isSelected,
  isDuplicate,
  hasDispatcherTask,
  isContextMenuAnchor,
}: {
  rowIndex: number
  isHighlighted: boolean
  isSelected: boolean
  isDuplicate: boolean
  hasDispatcherTask: boolean
  isContextMenuAnchor?: boolean
}) {
  if (isHighlighted) return 'bg-emerald-100'
  if (isSelected) return 'bg-[#dff3ff]'
  if (isDuplicate || hasDispatcherTask) return 'bg-amber-100'
  if (isContextMenuAnchor) return 'bg-[#cfeeff]'
  return rowIndex % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'
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
  if (isHighlighted) return 'Строка временно выделена системой'
  if (isDuplicate) return 'Возможный дубль: совпадают ключевые поля стыка'
  if (hasDispatcherTask) return 'По этому стыку есть активная задача диспетчера'
  return undefined
}
