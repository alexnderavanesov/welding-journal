import { useEffect, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WelderStampPermitFields } from '@/components/welder-stamp-permit-fields'
import { WelderStampWeldTypeSelector } from '@/components/welder-stamp-weld-type-selector'
import { WELDER_STAMP_WELD_TYPE_OPTIONS as welderStampWeldTypeOptions } from '@/lib/report-config'
import { splitWelderStampWeldTypes } from '@/lib/welder-stamp-format'
import { getWelderStampFormHint } from '@/lib/welder-stamp-registry'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsCreatePanelProps = {
  draft: WelderStampRecord
  editingId: number | null
  onDraftChange: (field: keyof WelderStampRecord, value: string) => void
  onSave: () => void
  onReset: () => void
}

export function WelderStampsCreatePanel({
  draft,
  editingId,
  onDraftChange,
  onSave,
  onReset,
}: WelderStampsCreatePanelProps) {
  const selectedWeldTypes = splitWelderStampWeldTypes(draft.weldType)
  const requiresPermitFields = Boolean(draft.naksStamp.trim())
  const [isOpen, setIsOpen] = useState(true)
  const formHint = getWelderStampFormHint(draft)

  useEffect(() => {
    if (editingId !== null) setIsOpen(true)
  }, [editingId])

  function toggleWeldType(type: (typeof welderStampWeldTypeOptions)[number]) {
    const nextTypes = selectedWeldTypes.includes(type)
      ? selectedWeldTypes.filter((value) => value !== type)
      : [...selectedWeldTypes, type]
    onDraftChange('weldType', nextTypes.join(', '))
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50/70">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Создание клейм</span>
          {editingId !== null ? (
            <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
              редактирование
            </span>
          ) : null}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <div className="border-t border-slate-200 p-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5 text-sm font-medium text-slate-700">
              <span>Клеймо НАКС</span>
              <Input
                value={draft.naksStamp}
                onChange={(event) => onDraftChange('naksStamp', event.target.value)}
                maxLength={4}
                placeholder="A123"
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div
              className={`rounded-md border px-3 py-2 text-xs leading-5 ${
                formHint.kind === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-sky-100 bg-sky-50 text-sky-800'
              }`}
            >
              {formHint.text}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
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
        </div>
      ) : null}
    </div>
  )
}
