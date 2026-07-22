import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type WeldFormFooterProps = {
  busy?: boolean
  autoClearHint?: string | null
  saveBlockReason?: string | null
  onCancel: () => void
  onSave: () => void
}

export function WeldFormFooter({ busy = false, autoClearHint, saveBlockReason, onCancel, onSave }: WeldFormFooterProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-slate-200/80 bg-white px-6 py-4">
      <div className="min-h-10 min-w-0 flex-1 text-sm text-slate-500">
        {saveBlockReason ? (
          <span className="inline-flex max-h-24 max-w-full overflow-y-auto rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-800 shadow-sm">
            <span className="whitespace-normal break-words leading-5">{saveBlockReason}</span>
          </span>
        ) : autoClearHint ? (
          <span className="inline-flex max-h-24 max-w-full overflow-y-auto rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-800 shadow-sm">
            <span className="whitespace-normal break-words leading-5">При сохранении: {autoClearHint}</span>
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 pt-0.5">
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
