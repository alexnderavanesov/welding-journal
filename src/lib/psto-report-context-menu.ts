import { History } from 'lucide-react'

import type { ContextActionMenuItem } from '@/components/context-action-menu'
import type { WeldRow } from '@/lib/dispatcher-types'
import { hasAnyPstoCycle } from '@/lib/psto-cycle'

export function buildPstoCycleHistoryContextMenuItem({
  rows,
  onOpen,
}: {
  rows: readonly WeldRow[]
  onOpen: (rows: readonly WeldRow[]) => void
}) {
  const hasHistory = rows.some((row) => hasAnyPstoCycle(row, row.pstoRepeatCycles ?? []))
  const isGroupAction = rows.length > 1

  return {
    id: 'psto-cycle-history',
    label: isGroupAction
      ? `История циклов ПСТО/ТВМТ выбранных (${rows.length})`
      : 'История циклов ПСТО/ТВМТ',
    description: 'Полная последовательность заявок, результатов и заключений по каждому циклу.',
    icon: History,
    disabled: !hasHistory,
    title: hasHistory ? undefined : 'Для выбранных стыков история ПСТО и ТВМТ пока пуста',
    onSelect: () => onOpen(rows),
  } satisfies ContextActionMenuItem
}
