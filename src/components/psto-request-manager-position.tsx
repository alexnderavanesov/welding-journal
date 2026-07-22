import { Trash2 } from 'lucide-react'

import { ManagerRowJointHeading } from '@/components/manager-row-joint-heading'
import { MetaSeparator } from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { formatDisplayDate } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getPstoResultLabel } from '@/lib/report-badges'

type PstoRequestManagerPositionProps = {
  row: WeldRow
  isCorrectionPending: boolean
  onClearPosition: (row: WeldRow) => void
}

export function PstoRequestManagerPosition({
  row,
  isCorrectionPending,
  onClearPosition,
}: PstoRequestManagerPositionProps) {
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_auto] items-center gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <ManagerRowJointHeading row={row} metaClassName="text-xs leading-5 text-slate-500" truncate>
          <MetaSeparator />
          Дата заявки: {formatDisplayDate(row.pstoRequestDate) || '-'}
          <MetaSeparator />
          Результат: {getPstoResultLabel(row.pstoResult)}
        </ManagerRowJointHeading>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onClearPosition(row)}
        disabled={isCorrectionPending}
        className="border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Очистить
      </Button>
    </div>
  )
}
