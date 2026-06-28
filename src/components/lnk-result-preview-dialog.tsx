import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { LnkResultPreviewRow } from '@/components/lnk-result-preview-row'
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
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[86vh]"
      overlayClassName="z-[65] bg-slate-950/25"
    >
      <DialogHeader
        title="Предпросмотр выбранных стыков"
        subtitle={`Метод: ${method?.code || '-'} · Выбрано: ${rows.length}`}
        onClose={onClose}
        closeLabel="Закрыть предпросмотр"
      />
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
      <DialogCloseFooter onClose={onClose} />
    </LargeDialogShell>
  )
}
