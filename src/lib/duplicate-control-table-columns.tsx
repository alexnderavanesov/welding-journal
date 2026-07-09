import { DuplicateControlTableCell } from '@/components/duplicate-control-table-cell'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ActiveReport } from '@/lib/home-state'
import type { WeldTableExtraColumn } from '@/lib/weld-table-extra-columns'

const DUPLICATE_CONTROL_COLUMN_WIDTH = 260

export function getDuplicateControlTableColumns({
  activeReport,
  onOpenDuplicateControl,
}: {
  activeReport: ActiveReport
  onOpenDuplicateControl?: (row: WeldRow) => void
}): WeldTableExtraColumn[] {
  if (!onOpenDuplicateControl || activeReport !== 'lnk') return []

  return [
    {
      key: 'duplicateControl',
      section: 'Дубль контроль',
      label: 'Результаты дубля',
      width: DUPLICATE_CONTROL_COLUMN_WIDTH,
      insertBeforeSection: 'Прочее',
      renderCell: (row) => <DuplicateControlTableCell row={row} onOpen={onOpenDuplicateControl} />,
    },
  ]
}
