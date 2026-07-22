import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ResultManagerDocumentEditorProps = {
  value: string
  placeholder: string
  hint?: string
  disabled: boolean
  canRename: boolean
  onChange: (value: string) => void
  onRename: () => void
}

export function ResultManagerDocumentEditor({
  value,
  placeholder,
  hint,
  disabled,
  canRename,
  onChange,
  onRename,
}: ResultManagerDocumentEditorProps) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 min-w-72 max-w-xl flex-1 bg-white text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={onRename} disabled={!canRename} className="h-8">
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Переименовать
        </Button>
      </div>
      {hint ? <p className="text-[11px] leading-4 text-slate-500">{hint}</p> : null}
    </div>
  )
}
