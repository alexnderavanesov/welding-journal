import { Input } from '@/components/ui/input'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampPermitFieldsProps = {
  draft: WelderStampRecord
  requiresPermitFields: boolean
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
}

export function WelderStampPermitFields({
  draft,
  requiresPermitFields,
  onDraftChange,
}: WelderStampPermitFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Диаметр от</span>
          <Input
            type="number"
            min="0"
            inputMode="decimal"
            value={draft.diameterFrom}
            onChange={(event) => onDraftChange('diameterFrom', event.target.value)}
            placeholder="от"
            required={requiresPermitFields}
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Диаметр до</span>
          <Input
            type="number"
            min="0"
            inputMode="decimal"
            value={draft.diameterTo}
            onChange={(event) => onDraftChange('diameterTo', event.target.value)}
            placeholder="без ограничения"
            title="Если поле пустое, верхнего ограничения по диаметру нет"
          />
        </label>
      </div>
      <label className="space-y-1.5 text-sm font-medium text-slate-700">
        <span>Срок действия от</span>
        <Input
          type="date"
          value={draft.validFrom}
          onChange={(event) => onDraftChange('validFrom', event.target.value)}
          required={requiresPermitFields}
        />
      </label>
      <label className="space-y-1.5 text-sm font-medium text-slate-700">
        <span>Срок действия до</span>
        <Input
          type="date"
          value={draft.validTo}
          onChange={(event) => onDraftChange('validTo', event.target.value)}
          required={requiresPermitFields}
        />
      </label>
    </>
  )
}
