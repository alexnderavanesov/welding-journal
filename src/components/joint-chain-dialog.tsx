import { LoaderCircle, RotateCcw, X } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogInlineEmptyState } from '@/components/dialog-inline-empty-state'
import { JointChainCard } from '@/components/joint-chain-card'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import { getJointChainSubtitle } from '@/lib/joint-display'

type JointChainDialogProps = {
  record: WeldRow
  rows: WeldRow[]
  errorMessage: string | null
  isLoading: boolean
  onClose: () => void
  onOpenBase: (row: WeldRow) => void
  onOpenRow: (row: WeldRow) => void
  onRetry: () => void
}

export function JointChainDialog({
  record,
  rows,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onRetry,
}: JointChainDialogProps) {
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
        {isLoading ? (
          <DialogInlineEmptyState>
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Загружаем цепочку стыка...
            </span>
          </DialogInlineEmptyState>
        ) : errorMessage ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-5 text-center">
            <p className="text-sm font-medium text-rose-800">Не удалось загрузить цепочку стыка.</p>
            <p className="mt-1 text-xs text-rose-700">{errorMessage}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 gap-2 bg-white" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
              Повторить
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <DialogInlineEmptyState>
            По этому стыку цепочка не найдена.
          </DialogInlineEmptyState>
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <JointChainCard key={row.id} row={row} index={index} isCurrent={row.id === record.id} onOpenRow={onOpenRow} />
            ))}
          </div>
        )}
      </div>

      <DialogCloseFooter onClose={onClose} borderClassName="border-slate-200" />
    </LargeDialogShell>
  )
}
