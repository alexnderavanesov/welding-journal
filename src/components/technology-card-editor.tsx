import { useEffect, useId, useState } from 'react'
import { ArrowRight, Check, History, Layers, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DialogHeader } from '@/components/dialog-header'
import { FieldHelp } from '@/components/field-help'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { useDataListSettings } from '@/lib/data-list-settings'
import { isTConnectionType } from '@/lib/connection-type'
import { createEmptyTechnologyCardDraft, validateTechnologyCard } from '@/lib/technology-card-validation'
import { TECHNOLOGY_CARD_PSTO_OPTIONS, type TechnologyCardDraft, type TechnologyCardIssue, type TechnologyCardRecord } from '@/lib/technology-card-types'

export function TechnologyCardEditor({ card, busy, message, onClose, onSave }: {
  card: TechnologyCardRecord | null; busy: boolean; message: string; onClose: () => void; onSave: (draft: TechnologyCardDraft) => Promise<void>
}) {
  const settings = useDataListSettings()
  const id = useId()
  const [draft, setDraft] = useState<TechnologyCardDraft>(() => card ? { ...card,
    diameterFrom: String(card.diameterFrom), diameterTo: String(card.diameterTo), thicknessFrom: String(card.thicknessFrom), thicknessTo: String(card.thicknessTo),
  } : createEmptyTechnologyCardDraft())
  const [issues, setIssues] = useState<TechnologyCardIssue[]>([])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const update = <K extends keyof TechnologyCardDraft>(field: K, value: TechnologyCardDraft[K]) => setDraft(current => ({ ...current, [field]: value }))
  const invalid = (field: keyof TechnologyCardDraft) => issues.some(issue => issue.field === field)

  return <LargeDialogShell ariaLabel={card ? 'Редактирование ТК' : 'Новая технологическая карта'} maxWidthClassName="max-w-2xl" panelRadiusClassName="rounded-xl" panelClassName="overflow-hidden">
    <DialogHeader title={card ? 'Редактирование ТК' : 'Новая технологическая карта'} onClose={onClose} closeDisabled={busy} />
    <form className="flex min-h-0 flex-col" onSubmit={event => {
      event.preventDefault()
      if (busy) return
      const result = validateTechnologyCard(draft, settings)
      setIssues(result.issues)
      if (result.card) void onSave(draft)
    }}>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">Название ТК
            <Input autoFocus value={draft.name} onChange={event => update('name', event.target.value)} placeholder="Например, ТК №12" aria-invalid={invalid('name')} />
          </label>
          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4" aria-label="Параметры сварки">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Layers className="h-4 w-4" aria-hidden="true" />Параметры сварки</h2>
            <div className="space-y-4">
              {(['weldingMethods', 'materialGroups'] as const).map(field => <fieldset key={field} className="min-w-0" aria-invalid={invalid(field)}>
                <legend className="mb-2 w-full text-sm font-medium text-slate-700">
                  <span className="flex items-center justify-between gap-2"><span>{field === 'weldingMethods' ? 'Способы сварки' : 'Группы материалов'}</span><span className={`text-xs font-normal ${draft[field].length > 2 ? 'text-red-700' : 'text-slate-500'}`}>{draft[field].length} из 2</span></span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...(field === 'weldingMethods' ? settings.weldingTypes : settings.materialGroups), ...draft[field]])].map(value => {
                    const checked = draft[field].includes(value)
                    const disabled = !checked && draft[field].length >= 2
                    return <label key={value} className="relative">
                      <input type="checkbox" className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" checked={checked} disabled={disabled} aria-describedby={`${id}-${field}-hint`}
                        onChange={event => setDraft(current => ({ ...current, [field]: event.target.checked
                          ? current[field].length < 2 ? [...current[field], value] : current[field]
                          : current[field].filter(item => item !== value) }))} />
                      <span className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400 ${checked
                        ? 'border-sky-300 bg-sky-50 font-medium text-sky-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200'} ${disabled || busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                        <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300'}`}>{checked && <Check className="h-3 w-3" />}</span>{value}
                      </span>
                    </label>
                  })}
                </div>
                <p id={`${id}-${field}-hint`} className="mt-1.5 text-xs text-slate-500">{field === 'weldingMethods' ? 'Один или два способа. Набор должен совпадать со стыком.' : 'Одна группа — однородный стык; две — разнородная пара.'}</p>
              </fieldset>)}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">Тип соединения
                  <Select aria-label="Тип соединения" value={draft.connectionType} aria-invalid={invalid('connectionType')} onChange={event => update('connectionType', event.target.value)}>
                    <option value="">Выберите тип</option>{[...new Set([...settings.connectionTypes, ...(draft.connectionType ? [draft.connectionType] : [])])].filter(value => !isTConnectionType(value)).map(value => <option key={value}>{value}</option>)}
                  </Select>
                </label>
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">Назначение ПСТО
                  <Select aria-label="Назначение ПСТО" value={draft.psto} aria-invalid={invalid('psto')} onChange={event => update('psto', event.target.value as TechnologyCardDraft['psto'])}>
                    {TECHNOLOGY_CARD_PSTO_OPTIONS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </Select>
                </label>
              </div>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 p-3 sm:p-4" aria-label="Диапазоны размеров">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Ruler className="h-4 w-4" aria-hidden="true" />Размеры, мм</h2>
              <FieldHelp label="Как проверяются размеры ТК"><p>Границы включены. Проверяются независимо меньший D и меньшая T: для 57×6 + 159×3 — D57 и T3.</p></FieldHelp>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {([['diameter', 'Диаметр'], ['thickness', 'Толщина']] as const).map(([prefix, label]) => <fieldset key={prefix} className="min-w-0">
                <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
                <div className="flex items-center gap-2">
                  <Input className="min-w-0" aria-label={`${label} от`} placeholder="От" inputMode="decimal" value={draft[`${prefix}From`]} onChange={event => update(`${prefix}From`, event.target.value)} aria-invalid={invalid(`${prefix}From`)} />
                  <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                  <Input className="min-w-0" aria-label={`${label} до`} placeholder="До" inputMode="decimal" value={draft[`${prefix}To`]} onChange={event => update(`${prefix}To`, event.target.value)} aria-invalid={invalid(`${prefix}To`)} />
                </div>
              </fieldset>)}
            </div>
            <p className="mt-2 text-xs text-slate-500">От и до включительно · меньшие D и T стыка</p>
          </section>
          {card && <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><History aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />После переименования нажмите «Проверить и назначить ТК» в реестре, чтобы обновить название в подходящих заваренных стыках.</p>}
          {!!issues.length && <ul role="alert" className="list-disc space-y-1 rounded-lg bg-rose-50 py-3 pl-8 pr-3 text-sm text-red-700">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
          {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
        </fieldset>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить ТК'}</Button>
      </div>
    </form>
  </LargeDialogShell>
}
