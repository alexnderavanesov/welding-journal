import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Plus, Trash2, X } from 'lucide-react'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { OfficialityBadge } from '@/components/joint-meta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { RkExposureEditingState } from '@/lib/home-state'
import { useOtherSettings } from '@/lib/other-settings'
import {
  RK_EXPOSURE_CUSTOM_SCHEME_LABEL,
  buildRkExposureLines,
  getRkEffectiveDiameter,
  getRkExposureDiameterEntry,
  getRkExposureSchemeState,
  parseRkExposureDescription,
  type RkExposureLine,
} from '@/lib/rk-exposure'
import { getJointTitle } from '@/lib/report-ui-state'
import { useConfirmAction } from '@/lib/confirm-action-context'

export type RkExposureEditDialogProps = {
  editing: RkExposureEditingState
  isSaving: boolean
  onClose: () => void
  onSave: (value: { lines: RkExposureLine[]; confirmedDiameter: number | null }) => void
}

export function RkExposureEditDialog({ editing, isSaving, onClose, onSave }: RkExposureEditDialogProps) {
  const settings = useOtherSettings()
  const confirmAction = useConfirmAction()
  const [lines, setLines] = useState<RkExposureLine[]>(() => parseRkExposureDescription(editing.record.lnkDefectDescription))
  const [isConfirmingScheme, setIsConfirmingScheme] = useState(false)
  const diameter = getRkEffectiveDiameter(editing.record)
  const entry = getRkExposureDiameterEntry(settings.rkExposureTable, diameter)
  const state = getRkExposureSchemeState(editing.record, settings.rkExposureTable)
  const selectedOptionIndex = useMemo(() => {
    const coordinates = lines.map((line) => line.coordinate.trim())
    return entry?.options.findIndex((option) => areListsEqual(option.values, coordinates)) ?? -1
  }, [entry, lines])
  const selectedValue = selectedOptionIndex >= 0 ? String(selectedOptionIndex) : 'custom'

  async function selectScheme(value: string) {
    if (value === 'custom') return
    const option = entry?.options[Number(value)]
    if (!option) return
    const currentCoordinates = lines.map((line) => line.coordinate.trim()).filter(Boolean)
    if (!areListsEqual(currentCoordinates, option.values) && currentCoordinates.length > 0) {
      setIsConfirmingScheme(true)
      const confirmed = await confirmAction({
        title: 'Сменить схему снимков?',
        itemName: option.label,
        description: 'Текущие координаты и их описания будут заменены строками выбранной схемы.',
        warning: 'После смены схемы проверьте сформированные описания перед сохранением.',
        confirmLabel: 'Сменить схему',
        tone: 'warning',
      })
      setIsConfirmingScheme(false)
      if (!confirmed) return
    }
    setLines(buildRkExposureLines(option.values, editing.record.rkResult))
  }

  function updateLine(index: number, patch: Partial<RkExposureLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  function moveLine(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= lines.length) return
    setLines((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-4xl"
      maxHeightClassName="max-h-[88vh]"
      returnPageScrollPosition={editing.returnPageScrollPosition}
    >
      <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Снимки и описание дефектов РК</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
            <span>{getJointTitle(editing.record)}</span>
            <OfficialityBadge row={editing.record} compact />
            <span>· расчетный D: {diameter ?? 'не указан'}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {!settings.rkExposureTable ? (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            В настройках не заполнен справочник «Экспозиции по диаметрам». Можно сохранить пользовательскую схему вручную.
          </div>
        ) : state.kind === 'review' ? (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Расчетный диаметр или тип соединения изменился. Проверьте схему и сохраните её заново.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Схема снимков / координат</span>
            <Select value={selectedValue} onChange={(event) => void selectScheme(event.target.value)}>
              {entry?.options.map((option, index) => (
                <option key={`${option.label}-${index}`} value={index}>{option.label}{option.isDefault ? ' · по умолчанию' : ''}</option>
              ))}
              <option value="custom">{RK_EXPOSURE_CUSTOM_SCHEME_LABEL}</option>
            </Select>
          </label>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <div className="text-xs font-semibold uppercase text-slate-400">Результат РК</div>
            <div className="mt-1 font-semibold text-slate-800">{String(editing.record.rkResult ?? '—')}</div>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
          <div className="grid grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.4fr)_112px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
            <span>Снимок / координаты</span><span>Описание после «:»</span><span className="text-center">Порядок</span>
          </div>
          <div className="divide-y divide-slate-200 bg-white">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.4fr)_112px] items-center gap-2 px-3 py-2">
                <Input value={line.coordinate} onChange={(event) => updateLine(index, { coordinate: event.target.value })} placeholder="Например, 0-250" />
                <Input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Например, ДНО или описание дефекта" />
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => moveLine(index, -1)} disabled={index === 0} title="Поднять">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => moveLine(index, 1)} disabled={index === lines.length - 1} title="Опустить">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} title="Удалить">
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              </div>
            ))}
            {lines.length === 0 ? <div className="px-3 py-6 text-center text-sm text-slate-500">Добавьте первый снимок или диапазон координат.</div> : null}
          </div>
        </div>
        <Button variant="outline" className="mt-3" onClick={() => setLines((current) => [...current, { coordinate: '', description: '' }])}>
          <Plus className="mr-2 h-4 w-4" />Добавить строку
        </Button>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button onClick={() => onSave({ lines, confirmedDiameter: diameter })} disabled={isSaving}>
          <Check className="mr-2 h-4 w-4" />Сохранить
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function areListsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value.trim() === right[index]?.trim())
}
