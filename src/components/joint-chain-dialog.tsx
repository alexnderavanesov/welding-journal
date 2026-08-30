import { useEffect, useState } from 'react'
import { LoaderCircle, RotateCcw, X } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogInlineEmptyState } from '@/components/dialog-inline-empty-state'
import { JointChainCard } from '@/components/joint-chain-card'
import { JointHistoryOverview } from '@/components/joint-history-overview'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type { RepeatedJointTask, WeldRow } from '@/lib/dispatcher-types'
import { getJointChainSubtitle } from '@/lib/joint-display'
import type { JointNextAction } from '@/lib/joint-next-actions'
import type { WeldFieldKey } from '@/lib/weld-fields'

type JointChainDialogProps = {
  record: WeldRow
  rows: WeldRow[]
  dispatcherTasks: RepeatedJointTask[]
  errorMessage: string | null
  isLoading: boolean
  onClose: () => void
  onOpenBase: (row: WeldRow) => void
  onOpenRow: (row: WeldRow) => void
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenReport: (row: WeldRow, report: 'weldingJournal' | 'lnk' | 'heatTreatment') => void
  onRunNextAction: (row: WeldRow, action: JointNextAction) => void
  onRetry: () => void
}

export function JointChainDialog({
  record,
  rows,
  dispatcherTasks,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onOpenDocument,
  onOpenReport,
  onRunNextAction,
  onRetry,
}: JointChainDialogProps) {
  const [selectedRowId, setSelectedRowId] = useState(record.id)
  const selectedRow = rows.find((row) => row.id === selectedRowId)
    ?? rows.find((row) => row.id === record.id)
    ?? rows[0]
    ?? record

  useEffect(() => {
    setSelectedRowId(record.id)
  }, [record.id])

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1480px]"
      maxHeightClassName="h-[92vh]"
      overlayClassName="z-[70] bg-slate-950/25"
      panelRadiusClassName="rounded-lg"
      panelShadowClassName="shadow-slate-950/15"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">История и цепочка стыка {String(record.joint ?? '-')}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenBase(record)}
              className="h-7 border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            >
              Показать цепочку в отчете
            </Button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{getJointChainSubtitle(record)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть цепочку стыка">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <DialogInlineEmptyState>
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Загружаем историю и цепочку стыка...
              </span>
            </DialogInlineEmptyState>
          </div>
        ) : errorMessage ? (
          <div className="p-5">
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-5 text-center">
              <p className="text-sm font-medium text-rose-800">Не удалось загрузить историю и цепочку стыка.</p>
              <p className="mt-1 text-xs text-rose-700">{errorMessage}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-2 bg-white" onClick={onRetry}>
                <RotateCcw className="h-4 w-4" />
                Повторить
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <DialogInlineEmptyState>По этому стыку история не найдена.</DialogInlineEmptyState>
          </div>
        ) : (
          <div className="grid h-full min-h-0 lg:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Цепочка ремонта и выреза</div>
              <div className="space-y-2">
                {rows.map((row, index) => (
                  <JointChainCard
                    key={row.id}
                    row={row}
                    index={index}
                    isCurrent={row.id === selectedRow.id}
                    onOpenRow={onOpenRow}
                    onSelect={(nextRow) => setSelectedRowId(nextRow.id)}
                  />
                ))}
              </div>
            </aside>
            <main className="min-h-0 overflow-y-auto px-5 py-4">
              <JointHistoryOverview
                row={selectedRow}
                dispatcherTasks={dispatcherTasks}
                onOpenDocument={onOpenDocument}
                onOpenReport={onOpenReport}
                onRunNextAction={onRunNextAction}
              />
            </main>
          </div>
        )}
      </div>

      <DialogCloseFooter onClose={onClose} borderClassName="border-slate-200" />
    </LargeDialogShell>
  )
}
