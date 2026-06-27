import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type WeldFormFooterProps = {
  busy?: boolean
  saveBlockReason?: string | null
  autoFillMessage?: string | null
  onCancel: () => void
  onSave: () => void
}

export function WeldFormFooter({ busy = false, saveBlockReason, autoFillMessage, onCancel, onSave }: WeldFormFooterProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 bg-white px-6 py-4">
      <div className="min-h-6 min-w-0 flex-1 text-sm text-slate-500">
        {saveBlockReason ? (
          <span className="inline-flex max-w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-800 shadow-sm">
            <span className="truncate">Чтобы сохранить: {saveBlockReason}</span>
          </span>
        ) : autoFillMessage ? (
          <span className="inline-flex max-w-full rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-800 shadow-sm">
            <span className="truncate">{autoFillMessage}</span>
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={onSave} disabled={busy || Boolean(saveBlockReason)} title={saveBlockReason ?? undefined}>
          <Check className="mr-2 h-4 w-4" />
          Сохранить
        </Button>
      </div>
    </div>
  )
}
