import type { KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import { OfficialityBadge } from '@/components/joint-meta'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { HeatTreatmentFieldEditingState } from '@/lib/home-state'
import { withCurrentOption } from '@/lib/report-naming'
import { getJointTitle } from '@/lib/report-ui-state'
import { RESULT_STATUS_OPTIONS } from '@/lib/weld-fields'

type ReportFieldEditDialogProps = {
  editing: HeatTreatmentFieldEditingState
  requestOptions: string[]
  isSaving: boolean
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}

export function ReportFieldEditDialog({
  editing,
  requestOptions,
  isSaving,
  onChange,
  onClose,
  onSave,
}: ReportFieldEditDialogProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === 'Escape') onClose()
    if (event.key === 'Enter') onSave()
  }

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-xl"
      maxHeightClassName=""
      overlayClassName="z-50 bg-slate-950/20"
      panelShadowClassName="shadow-slate-950/10"
    >
      <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold">{editing.label}</h2>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>{getJointTitle(editing.record)}</span>
            <OfficialityBadge row={editing.record} compact />
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2 px-5 py-5">
        <label className="space-y-1.5 text-sm">
          <span className="text-[13px] font-medium leading-none text-slate-700">{editing.label}</span>
          {editing.mode === 'result' ? (
            <Select autoFocus value={editing.value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown}>
              <option value="">пусто</option>
              {RESULT_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : editing.mode === 'request' ? (
            <Select autoFocus value={editing.value} onChange={(event) => onChange(event.target.value)} onKeyDown={handleKeyDown}>
              <option value="">пусто</option>
              {withCurrentOption(requestOptions, editing.value).map((requestName) => (
                <option key={requestName} value={requestName}>
                  {requestName}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              autoFocus
              type={editing.kind}
              value={editing.value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
            />
          )}
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200/80 px-5 py-4">
        <Button variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={onSave} disabled={isSaving}>
          <Check className="mr-2 h-4 w-4" />
          Сохранить
        </Button>
      </div>
    </LargeDialogShell>
  )
}
