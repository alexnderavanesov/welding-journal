import { X } from 'lucide-react'
import { LnkResultPreviewRow } from '@/components/lnk-result-preview-row'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { LnkResultDraftLike } from '@/lib/lnk-result-draft'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'

export type LnkResultPreviewDialogProps = {
  rows: WeldRow[]
  draft: LnkResultDraftLike
  onClose: () => void
}

export function LnkResultPreviewDialog({ rows, draft, onClose }: LnkResultPreviewDialogProps) {
  const method = getLnkMethodByRequestKey(draft.methodKey)

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[1px]">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col rounded-md border border-slate-200 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Предпросмотр выбранных стыков</h2>
            <p className="text-sm text-muted-foreground">
              Метод: {method?.code || '-'} · Выбрано: {rows.length}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть предпросмотр">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {rows.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Нет выбранных стыков.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {rows.map((row) => (
                <LnkResultPreviewRow key={row.id} row={row} method={method} draft={draft} />
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  )
}
