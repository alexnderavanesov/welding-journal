import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OfficialityBadge, getJointTitle } from '@/lib/weld-form-utils'
import type { WeldInput } from '@/lib/weld-fields'

type WeldFormHeaderProps = {
  draft: WeldInput
  isEditing: boolean
  onCancel: () => void
}

export function WeldFormHeader({ draft, isEditing, onCancel }: WeldFormHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
      <div>
        <h2 className="text-lg font-semibold">{isEditing ? 'Редактирование стыка' : 'Новый стык'}</h2>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <span>{getJointTitle(draft)}</span>
          <OfficialityBadge value={draft} />
        </p>
      </div>
      <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Закрыть">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
