import { BadgeCheck, CalendarDays, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { SPECIALIST_METHODS, type SpecialistCertificate, type SpecialistKind } from '@/lib/document-specialists'
import { formatDisplayDate } from '@/lib/date-format'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Checkbox } from './ui/checkbox'

export const emptySpecialistCertificate = (): SpecialistCertificate => ({ number: '', validFrom: null, validTo: null, methods: [] })

export function SpecialistCertificatesEditor({ value, kind, onChange }: { value: SpecialistCertificate[]; kind: SpecialistKind; onChange: (value: SpecialistCertificate[]) => void }) {
  const update = (index: number, patch: Partial<SpecialistCertificate>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item))
  return <section className="space-y-3" aria-label="Удостоверения специалиста">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-700">Удостоверения</h3><Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, emptySpecialistCertificate()])}><Plus className="h-4 w-4" aria-hidden="true" />Добавить удостоверение</Button></div>
    <p className="text-xs leading-5 text-slate-500">Выбираются по дате заключения. Обе даты можно оставить пустыми: такое удостоверение используется, если нет подходящего по сроку.</p>
    {value.map((certificate, index) => <details key={index} open className="group/certificate overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-100/60">
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-slate-50/70 px-4 py-3 outline-none transition-colors hover:bg-slate-100/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-600"><BadgeCheck className="h-4 w-4" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-slate-700">{certificate.number ? `№ ${certificate.number}` : `Новое удостоверение ${index + 1}`}</span><span className="mt-1 block text-xs text-slate-500">{kind === 'thermist' ? 'ПСТО' : certificate.methods.join(' · ') || 'Виды контроля не выбраны'}</span></span>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${certificate.validFrom && certificate.validTo ? 'bg-sky-50 text-sky-700' : certificate.validFrom || certificate.validTo ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{certificate.validFrom && certificate.validTo ? 'По сроку' : certificate.validFrom || certificate.validTo ? 'Укажите обе даты' : 'Без дат'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open/certificate:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4">
        <label className="block space-y-1.5 text-xs font-medium text-slate-600">№ квалификационного удостоверения<Input required maxLength={200} placeholder="Введите номер удостоверения" value={certificate.number} onChange={event => update(index, { number: event.target.value })} /></label>
        <div className="space-y-2 rounded-lg bg-slate-50/70 p-3"><p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />Срок действия</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0 space-y-1.5 text-xs text-slate-500">Действует с<Input type="date" value={certificate.validFrom ?? ''} onChange={event => update(index, { validFrom: event.target.value || null })} /></label>
          <label className="block min-w-0 space-y-1.5 text-xs text-slate-500">Действует по<Input type="date" value={certificate.validTo ?? ''} onChange={event => update(index, { validTo: event.target.value || null })} /></label>
        </div>
        <p className="text-[11px] leading-4 text-slate-400">{certificate.validFrom && certificate.validTo ? `${formatDisplayDate(certificate.validFrom)} — ${formatDisplayDate(certificate.validTo)}, включительно` : 'Оставьте обе даты пустыми для удостоверения без срока.'}</p></div>
        <fieldset className="min-w-0 h-28 sm:h-20"><legend className="mb-2 text-xs font-medium text-slate-600">Виды контроля</legend>{kind === 'thermist' ? <span className="inline-block rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">ПСТО</span> : <div className="flex flex-wrap gap-2">{SPECIALIST_METHODS.map(method => <label key={method} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${certificate.methods.includes(method) ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}><Checkbox checked={certificate.methods.includes(method)} onChange={event => update(index, { methods: event.target.checked ? [...certificate.methods, method] : certificate.methods.filter(item => item !== method) })} />{method}</label>)}</div>}</fieldset>
        {value.length > 1 ? <Button type="button" variant="ghost" size="sm" className="text-rose-700" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" aria-hidden="true" />Удалить удостоверение</Button> : null}
      </div>
    </details>)}
  </section>
}
