import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

type WeldFormFooterProps = {
  busy?: boolean
  autoClearHint?: string | null
  saveBlockReason?: string | null
  fieldStatusCount?: number
  fieldStatusLabel?: string
  onCancel: () => void
  onSave: () => void
}

export function WeldFormFooter({
  busy = false,
  autoClearHint,
  saveBlockReason,
  fieldStatusCount = 0,
  fieldStatusLabel = 'Изменено',
  onCancel,
  onSave,
}: WeldFormFooterProps) {
  return (
    <div className="flex min-h-[72px] items-center justify-between gap-4 border-t border-slate-200/80 bg-white px-6 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 text-sm text-slate-500">
        <span className={`shrink-0 rounded border px-2.5 py-1 text-xs font-semibold ${
          fieldStatusCount > 0
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-slate-200 bg-slate-50 text-slate-500'
        }`}>
          {fieldStatusCount > 0 ? `${fieldStatusLabel}: ${fieldStatusCount}` : 'Без изменений'}
        </span>
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
