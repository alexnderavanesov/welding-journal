import { useState } from 'react'
import { FileText, RotateCcw, UsersRound } from 'lucide-react'
import { getDraftSpecialists, getSpecialistDocumentProfile, type SpecialistSelection } from '@/lib/document-specialists'
import type { RequestNamingState } from '@/lib/request-naming-state'
import type { SystemDocumentCreationPlan } from '@/lib/system-document-creation-plan'
import { SpecialistSelect, useSpecialistOptions } from './specialist-select'
import { FieldHelp } from './field-help'
import { Button } from './ui/button'

export function DocumentSpecialistsPanel({ plan, naming, onChange, disabled }: { plan: SystemDocumentCreationPlan; naming: RequestNamingState; onChange: (naming: RequestNamingState) => void; disabled?: boolean }) {
  const profile = getSpecialistDocumentProfile(plan.type, plan.methodCode)
  const options = useSpecialistOptions(profile, naming.specialistDefaultRecords)
  const [page, setPage] = useState(0)
  const draft = naming.specialists ?? {}
  if (!profile) return null
  const pages = Math.max(1, Math.ceil(plan.groups.length / 50))
  const currentPage = Math.min(page, pages - 1)
  const change = (role: keyof SpecialistSelection, value: number | null | undefined, membership?: string) => onChange({ ...naming, specialists: membership === undefined
    ? { ...draft, common: { ...draft.common, [role]: value } }
    : { ...draft, documents: { ...draft.documents, [membership]: { ...draft.documents?.[membership], [role]: value } } } })
  return <div className="min-h-0 flex-1 overflow-auto bg-slate-50/40 px-4 py-4 sm:px-6">
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700"><UsersRound aria-hidden="true" className="h-4 w-4 text-sky-600" />Подписанты заключений
          <FieldHelp label="Как назначить общую пару и специалистов отдельных документов">Назначения необязательны. Общая пара применяется ко всем документам, кроме отдельно исправленных ролей. После сохранения изменить ФИО можно только в «Документах».</FieldHelp>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Необязательно</span>
      </div>
      <fieldset disabled={disabled} className="min-w-0 rounded-xl border border-sky-100 bg-sky-50/50 px-3 pb-3 pt-2">
        <legend className="px-1 text-sm font-semibold text-sky-900">Общая пара</legend>
        <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <p className="text-xs leading-5 text-slate-500">Для всех документов ниже.<br className="hidden md:block" /> Отдельные роли можно поправить в строке.</p>
          {(['first', 'second'] as const).map((role, index) => <SpecialistSelect key={role} density="compact" label={profile.labels[index]} profile={profile} options={options} value={draft.common?.[role]} disabled={disabled} onChange={value => change(role, value)} />)}
        </div>
      </fieldset>
      <section aria-label="Индивидуальные назначения" className="space-y-2">
        <div className="flex items-center gap-2 px-1"><h3 className="text-sm font-medium text-slate-700">По документам</h3><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{plan.groups.length}</span></div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm" aria-label="Специалисты создаваемых документов">
            <colgroup><col className="w-[37.5%]" /><col className="w-[31.25%]" /><col className="w-[31.25%]" /></colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 font-medium">Документ</th>{profile.labels.map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody>{plan.groups.slice(currentPage * 50, currentPage * 50 + 50).map(group => {
              const membership = group.membership ?? group.key
              const selection = getDraftSpecialists(draft, membership)
              const custom = Object.keys(draft.documents?.[membership] ?? {}).length > 0
              const title = group.name || group.label
              return <tr key={group.key} className="h-14 border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-3 py-2"><div className="flex min-w-0 items-center gap-2"><FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0"><span className="block truncate font-medium text-slate-700" title={title}>{title}</span><span className={`mt-0.5 inline-block rounded px-1.5 text-[11px] leading-4 ${custom ? 'bg-amber-50 text-amber-800' : 'text-slate-400'}`}>{custom ? 'Свои назначения' : 'Общая пара'}</span></div></div></td>
                {(['first', 'second'] as const).map((role, index) => <td key={role} className="px-3 py-2"><div className="flex min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1"><SpecialistSelect density="cell" label={profile.labels[index]} profile={profile} options={options} value={selection[role]} disabled={disabled} onChange={value => change(role, value, membership)} /></div>
                  <Button variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-sky-600 disabled:opacity-20" disabled={disabled || !Object.hasOwn(draft.documents?.[membership] ?? {}, role)} aria-label={`Вернуть общую пару: ${profile.labels[index]} — ${title}`} title="Вернуть общую пару для этой роли" onClick={() => {
                    const individual = { ...draft.documents?.[membership] }; delete individual[role]
                    onChange({ ...naming, specialists: { ...draft, documents: { ...draft.documents, [membership]: individual } } })
                  }}><RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /></Button>
                </div></td>)}
              </tr>
            })}</tbody>
          </table>
          {!plan.groups.length ? <p className="p-5 text-sm text-slate-500">Выберите стыки и результаты для создания заключений.</p> : null}
        </div>
      </section>
      {pages > 1 ? <div className="flex items-center justify-end gap-3 text-xs text-slate-500"><Button variant="ghost" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</Button><span>{currentPage + 1} / {pages}</span><Button variant="ghost" size="sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</Button></div> : null}
    </div>
  </div>
}
