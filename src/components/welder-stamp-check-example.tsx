import { useState } from 'react'
import { ChevronDown, FlaskConical } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { StampCheckBadge } from './welder-stamp-check-visual'
import { useDataListSettings } from '@/lib/data-list-settings'
import { DEFAULT_STAMP_CHECK_EXAMPLE, explainStampCheckExample, type ExampleWeldingMethod, type StampCheckExample } from '@/lib/welder-stamp-check-explanation'

export function WelderStampCheckExample() {
  const [example, setExample] = useState<StampCheckExample>(DEFAULT_STAMP_CHECK_EXAMPLE)
  const settings = useDataListSettings()
  const explanation = explainStampCheckExample(example)
  function update<K extends keyof StampCheckExample>(field: K, value: StampCheckExample[K]) {
    setExample(current => ({ ...current, [field]: value }))
  }
  const methods = <><option value="РАД">РАД</option><option value="РД">РД</option><option value="РАД+РД">РАД + РД</option></>
  return (
    <details className="group rounded-lg border border-sky-200 bg-white" data-stamp-check-example>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 [&::-webkit-details-marker]:hidden">
        <FlaskConical aria-hidden="true" className="h-5 w-5 shrink-0 text-sky-700" />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">Разобрать свой пример</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Задайте стык — увидите, какие параметры проверяются у каждого сварщика.</span></span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-sky-100 p-4">
        <p className="text-xs leading-5 text-slate-500">Учебный разбор: не выбирает реальные клейма, не проверяет их удостоверения и ничего не сохраняет в журнал.</p>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3" data-stamp-check-inputs>
        <section aria-label="Стык">
          <h3 className="mb-2 text-xs font-semibold text-slate-900">Стык</h3>
          <div className="grid max-w-lg gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-700">Тип соединения<Select className="h-8 py-1" aria-label="Тип соединения" value={example.connectionType} onChange={event => update('connectionType', event.target.value as StampCheckExample['connectionType'])}><option value="С17">С17 — С-стык</option><option value="У19">У19 — У-стык</option></Select></label>
            <label className="grid gap-1 text-xs text-slate-700">Способ сварки стыка<Select className="h-8 py-1" aria-label="Способ сварки стыка" value={example.weldingMethod} onChange={event => update('weldingMethod', event.target.value as ExampleWeldingMethod)}>{methods}</Select></label>
          </div>
        </section>
        <section aria-label="Стороны стыка" className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-900">Стороны стыка</h3>
          <div className="grid gap-2 2xl:grid-cols-2">
          {([1, 2] as const).map(side => (
            <fieldset key={side} aria-label={`Сторона ${side}`} className="min-w-0 rounded-md border border-slate-200 px-2 pb-2">
              <legend className="px-1 text-xs font-medium text-slate-700">Сторона {side} · мм</legend>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="col-span-2 grid gap-1 text-xs text-slate-600 sm:col-span-1">Группа<Select className="h-8 px-2 py-1" aria-label={`Группа ${side}`} value={example[`group${side}`]} onChange={event => update(`group${side}`, event.target.value)}>{settings.materialGroups.map(group => <option key={group} value={group}>{group}</option>)}</Select></label>
                {(['d', 't'] as const).map(dimension => {
                  const field = `${dimension}${side}` as const
                  const label = `${dimension === 'd' ? 'Диаметр' : 'Толщина'} ${field.toUpperCase()}, мм`
                  return <label key={field} className="grid min-w-0 gap-1 text-xs text-slate-600">{label.replace(', мм', '')}<Input className="h-8 min-w-0 px-2 py-1" aria-label={label} inputMode="decimal" value={example[field]} onChange={event => update(field, event.target.value)} aria-invalid={explanation.errors.some(error => error.startsWith(field.toUpperCase()))} /></label>
                })}
              </div>
            </fieldset>
          ))}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">1/2 — стороны, не сварщики. Одинаковые группы — однородный стык, разные — разнородный.</p>
        </section>
        <section aria-label="Сварщики" className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-xs font-semibold text-slate-900">Сварщики</h3>
          <div className="grid items-start gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-xs text-slate-700">Количество клейм<Select className="h-8 py-1" aria-label="Количество клейм" value={example.stampCount} onChange={event => update('stampCount', Number(event.target.value) as 1 | 2)}><option value={1}>1 — А</option><option value={2}>2 — А и Б</option></Select></label>
            {explanation.welders.map((welder, index) => {
              const name = index === 0 ? 'A' : 'B'
              return <div key={name} className="grid gap-1">
                <p className="text-xs text-slate-700">{welder.name} — способ</p>
                {example.weldingMethod === 'РАД+РД' && example.stampCount === 2 ? <Select className="h-8 py-1" aria-label={`${welder.name} — способ`} value={example[`method${name}`]} onChange={event => update(`method${name}`, event.target.value as ExampleWeldingMethod)}>{methods}</Select> : <div className="flex h-8 items-center"><StampCheckBadge owner={index === 0 ? 'a' : 'b'}>{index === 0 ? 'А' : 'Б'} · {welder.methods.replace('+', ' + ')}</StampCheckBadge></div>}
              </div>
            })}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">Способы здесь — для примера. В журнале они определяются по допускам, не по порядку клейм.</p>
        </section>
        </div>
        <div aria-live="polite" aria-atomic="true" className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3" aria-label="Результат разбора примера" role="region">
          <h3 className="text-sm font-semibold text-slate-900">Что проверяется</h3>
          {explanation.errors.length ? <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Дополните параметры примера</p><ul className="mt-1 list-disc pl-5">{explanation.errors.map(error => <li key={error}>{error}</li>)}</ul></div> : <>
            {explanation.teamWarning ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{explanation.teamWarning}</p> : null}
            <div className="space-y-2">
              {explanation.welders.map((welder, index) => <article key={welder.name} aria-label={welder.name} className="rounded-md border border-slate-200 bg-white p-2.5">
                <h3><StampCheckBadge owner={index === 0 ? 'a' : 'b'}>{welder.name} · {welder.methods.replace('+', ' + ')}</StampCheckBadge></h3>
                {explanation.scopes.map(scope => <div key={scope.group} className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <p className="font-semibold text-slate-800">{scope.group}</p><span aria-hidden="true" className="text-slate-400">→</span>
                  <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><div><dt className="sr-only">Диаметр</dt><dd className="font-medium text-slate-900">{scope.diameter}</dd></div><div className="flex items-baseline gap-2"><dt className="text-xs font-semibold text-slate-500"><span aria-hidden="true">И</span><span className="sr-only">Толщина</span></dt><dd className="font-medium text-slate-900">{scope.thickness}</dd></div></dl>
                </div>)}
              </article>)}
            </div>
            <div className="space-y-1 text-xs leading-5 text-slate-600">
              <p>У каждого — только собственные подходящие допуски указанных способов. {explanation.scopes.length === 2 ? 'Обе группы нужны по каждому из этих способов.' : 'Группа нужна по каждому из этих способов.'} Собственные допуски можно объединять по размерам.</p>
              {explanation.scopes.map(scope => <p key={scope.group}>{explanation.scopes.length === 2 ? `${scope.group}: ` : ''}{scope.note}</p>)}
            </div>
            <p className="text-xs leading-5 text-slate-500">Это список параметров, а не решение «допущен». НАКС/ДЛС, сроки, архив и отстранения проверяются по реальным данным на дату сварки.</p>
          </>}
        </div>
        </div>
      </div>
    </details>
  )
}
