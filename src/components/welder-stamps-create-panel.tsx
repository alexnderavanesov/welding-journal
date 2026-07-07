import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WelderStampPermitFields } from '@/components/welder-stamp-permit-fields'
import { WelderStampWeldTypeSelector } from '@/components/welder-stamp-weld-type-selector'
import { WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions } from '@/lib/report-config'
import { splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import {
  getWelderNameByNaks,
  getWelderStampFormHint,
  getWelderStampNameSyncHint,
  normalizeNaksStamp,
} from '@/lib/welder-stamp-registry'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsCreatePanelProps = {
  draft: WelderStampRecord
  editingId: number | null
  records: WelderStampRecord[]
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSave: () => boolean
  onReset: () => void
}

export function WelderStampsCreatePanel({
  draft,
  editingId,
  records,
  onDraftChange,
  onSave,
  onReset,
}: WelderStampsCreatePanelProps) {
  const selectedWeldTypes = splitWelderStampWeldTypes(draft.weldType)
  const requiresPermitFields = Boolean(draft.naksStamp.trim())
  const formHint = getWelderStampFormHint(draft)
  const nameSyncHint = getWelderStampNameSyncHint(records, draft, editingId)
  const naksStampOptions = Array.from(new Set(records.map((record) => normalizeNaksStamp(record.naksStamp)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, 'ru'),
  )
  const naksStampDatalistId = `welder-naks-stamps-${editingId ?? 'new'}`

  function handleNaksStampChange(value: string) {
    const normalizedStamp = normalizeNaksStamp(value)
    onDraftChange('naksStamp', value)

    const existingName = getWelderNameByNaks(records, normalizedStamp, editingId)
    if (existingName) onDraftChange('welderName', existingName)
  }

  function toggleWeldType(type: (typeof welderStampWeldTypeOptions)[number]) {
    const nextTypes = selectedWeldTypes.includes(type)
      ? selectedWeldTypes.filter((value) => value !== type)
      : [...selectedWeldTypes, type]
    onDraftChange('weldType', nextTypes.join(', '))
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Клеймо НАКС</span>
          <Input
            value={draft.naksStamp}
            onChange={(event) => handleNaksStampChange(event.target.value)}
            maxLength={4}
            list={naksStampDatalistId}
            placeholder="A123"
          />
          <datalist id={naksStampDatalistId}>
            {naksStampOptions.map((stamp) => (
              <option key={stamp} value={stamp} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>ФИО сварщика</span>
          <Input
            value={draft.welderName}
            onChange={(event) => onDraftChange('welderName', event.target.value)}
            placeholder="Например: Иванов И.И."
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Клеймо внутреннее</span>
          <Input
            value={draft.internalStamp}
            onChange={(event) => onDraftChange('internalStamp', event.target.value)}
            placeholder="Например: 45"
          />
        </label>
        <div className="space-y-1.5 text-sm font-medium text-slate-700">
          <span>Тип сварки</span>
          <WelderStampWeldTypeSelector selectedWeldTypes={selectedWeldTypes} onToggleWeldType={toggleWeldType} />
        </div>
        <WelderStampPermitFields draft={draft} requiresPermitFields={requiresPermitFields} onDraftChange={onDraftChange} />
      </div>
      {nameSyncHint ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {nameSyncHint}
        </div>
      ) : null}
      <div
        className={`rounded-md border px-3 py-2 text-xs leading-5 ${
          formHint.kind === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-sky-100 bg-sky-50 text-sky-800'
        }`}
      >
        {formHint.text}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="button" variant="outline" onClick={onReset}>
          <X className="mr-2 h-4 w-4" />
          Очистить
        </Button>
        <Button type="button" onClick={onSave}>
          <Check className="mr-2 h-4 w-4" />
          {editingId === null ? 'Добавить клеймо' : 'Сохранить клеймо'}
        </Button>
      </div>
    </div>
  )
}
