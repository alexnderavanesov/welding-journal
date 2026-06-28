import { X } from 'lucide-react'

import { JointChainCard } from '@/components/joint-chain-card'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainSubtitle } from '@/lib/joint-display'

type JointChainDialogProps = {
  record: WeldRow
  rows: WeldRow[]
  onClose: () => void
  onOpenBase: (row: WeldRow) => void
  onOpenRow: (row: WeldRow) => void
}

export function JointChainDialog({ record, rows, onClose, onOpenBase, onOpenRow }: JointChainDialogProps) {
  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[82vh]"
      overlayClassName="z-[70] bg-slate-950/25"
      panelRadiusClassName="rounded-lg"
      panelShadowClassName="shadow-slate-950/15"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Цепочка стыка {String(record.joint ?? '-')}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenBase(record)}
              className="h-7 border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            >
              Показать всю цепочку
            </Button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{getJointChainSubtitle(record)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть цепочку стыка">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            По этому стыку цепочка не найдена.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <JointChainCard key={row.id} row={row} index={index} isCurrent={row.id === record.id} onOpenRow={onOpenRow} />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-slate-200 px-5 py-4">
        <Button variant="outline" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </LargeDialogShell>
  )
}
