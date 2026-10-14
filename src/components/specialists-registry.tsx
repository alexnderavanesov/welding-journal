import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, BadgeCheck, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, ShieldCheck, Thermometer, UsersRound, X } from 'lucide-react'
import { archiveSpecialist, listSpecialists, saveSpecialist } from '@/server/specialists'
import { SPECIALIST_METHODS, type SpecialistRecord } from '@/lib/document-specialists'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSecurityGuard } from '@/lib/security-context'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { DialogHeader } from './dialog-header'
import { FieldHelp } from './field-help'
import { SpecialistDialogShell } from './specialist-dialog-shell'

type Draft = Omit<SpecialistRecord, 'id' | 'revision'> & { id?: number; revision?: number }

export function SpecialistsRegistry() {
  const client = useQueryClient()
  const { requireSettingsChangePassword } = useSecurityGuard()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 250)
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState<'all' | 'active' | 'archived'>('all')
  const [archiveTarget, setArchiveTarget] = useState<SpecialistRecord | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const query = useQuery({ queryKey: ['specialists', 'registry', debounced, offset, status], queryFn: () => listSpecialists({ data: { search: debounced, offset, status, includeCounts: true } }), staleTime: 30000, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const close = () => { if (!saving.current) { setDraft(null); setError('') } }
  async function save() {
    if (!draft || saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      if (!await requireSettingsChangePassword()) return
      await saveSpecialist({ data: draft })
      setDraft(null)
      void client.invalidateQueries({ queryKey: ['specialists'], refetchType: 'active' })
    } catch (error) { setError((error as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }
  async function changeArchive() {
    if (!archiveTarget || saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      if (!await requireSettingsChangePassword()) return
      await archiveSpecialist({ data: { id: archiveTarget.id, revision: archiveTarget.revision, archived: !archiveTarget.archived } })
      setArchiveTarget(null); setOffset(0)
      void client.invalidateQueries({ queryKey: ['specialists'], refetchType: 'active' })
    } catch (error) { setError((error as Error).message) }
    finally { saving.current = false; setBusy(false) }
  }
  return <section className="space-y-4" aria-label="Реестр специалистов">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-slate-900">Специалисты</h1><p className="mt-1 text-sm text-slate-500">Дефектоскописты и термисты для заключений НК, ТВМТ и ПСТО.</p></div>
      <Button onClick={() => { setError(''); setDraft({ name: '', certificate: '', kind: 'inspector', methods: [] }) }} disabled={busy}><Plus aria-hidden="true" className="h-4 w-4" />Добавить специалиста</Button>
    </div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="relative min-w-0 flex-1 basis-64">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <Input type="search" aria-label="Поиск специалистов в справочнике" placeholder="ФИО или № удостоверения" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} className="pl-9 pr-10" />
        {search ? <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-8 w-8" aria-label="Очистить поиск специалистов" onClick={() => { setSearch(''); setOffset(0) }}><X aria-hidden="true" className="h-4 w-4" /></Button> : null}
      </div>
      <span className="flex items-center gap-1.5 px-1 text-xs text-slate-500"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-slate-400" />История документов сохраняется<FieldHelp label="Как изменения карточки влияют на документы">Правка ФИО, удостоверения или методов не изменяет уже сохранённые назначения. Новые реквизиты попадут в документ только после явного переназначения специалиста.</FieldHelp></span>
    </div>
    <div className="grid gap-2 sm:grid-cols-3" aria-label="Сводка по состоянию специалистов">
      {([{ id: 'all', label: 'Все специалисты', tone: 'border-sky-200 bg-sky-50 text-sky-800' }, { id: 'active', label: 'Действующие', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' }, { id: 'archived', label: 'В архиве', tone: 'border-slate-300 bg-slate-100 text-slate-700' }] as const).map(item => <button key={item.id} type="button" aria-pressed={status === item.id} onClick={() => { setStatus(item.id); setOffset(0) }} className={`flex min-h-14 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${status === item.id ? item.tone : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'}`}><span className="text-xs font-semibold">{item.label}</span><span className="text-lg font-semibold tabular-nums">{query.data?.counts?.[item.id] ?? '—'}</span></button>)}
    </div>
    {query.isError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Не удалось загрузить справочник. <Button variant="ghost" onClick={() => void query.refetch()}>Повторить</Button></div>
      : query.isPending ? <p className="p-6 text-sm text-slate-500">Загрузка специалистов…</p>
      : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50/80 text-xs text-slate-500"><tr>{['Специалист', 'Тип', 'Удостоверение', 'Виды контроля', ''].map((label, index) => <th className="px-4 py-3 font-medium" key={index}>{label}</th>)}</tr></thead>
          <tbody>{query.data.records.map(record => <tr key={record.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
            <td className="min-w-48 px-4 py-3 font-medium text-slate-800">{record.name}{record.archived ? <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500"><Archive aria-hidden="true" className="h-3 w-3" />В архиве</span> : null}</td>
            <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs ${record.kind === 'inspector' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-800'}`}>{record.kind === 'inspector' ? <UsersRound aria-hidden="true" className="h-3.5 w-3.5" /> : <Thermometer aria-hidden="true" className="h-3.5 w-3.5" />}{record.kind === 'inspector' ? 'Дефектоскопист' : 'Термист'}</span></td>
            <td className="px-4 py-3 text-slate-600">{record.certificate}</td>
            <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(record.kind === 'thermist' ? ['ПСТО'] : record.methods).map(method => <span key={method} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{method}</span>)}</div></td>
            <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(record); setError('') }}><Pencil aria-hidden="true" className="h-3.5 w-3.5" />Изменить</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setArchiveTarget(record); setError('') }}>{record.archived ? <ArchiveRestore aria-hidden="true" className="h-3.5 w-3.5" /> : <Archive aria-hidden="true" className="h-3.5 w-3.5" />}{record.archived ? 'Восстановить' : 'В архив'}</Button></div></td>
          </tr>)}</tbody>
        </table>
        {!query.data.records.length ? <div className="flex flex-col items-center gap-2 px-5 py-12 text-center"><span className="mb-1 rounded-2xl bg-slate-50 p-3 text-slate-400"><UsersRound aria-hidden="true" className="h-6 w-6" /></span><p className="text-sm font-medium text-slate-700">{search ? 'Специалисты не найдены' : 'Добавьте первого специалиста'}</p><p className="max-w-sm text-sm text-slate-500">{search ? 'Попробуйте другое ФИО или номер удостоверения.' : 'Укажите ФИО, удостоверение и доступные методы контроля.'}</p></div> : null}
      </div>}
    {(offset > 0 || query.data?.hasMore) ? <div className="flex items-center justify-end gap-2"><Button size="sm" variant="ghost" disabled={!offset || query.isFetching} onClick={() => setOffset(Math.max(0, offset - 100))}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Назад</Button><span className="text-xs text-slate-500">Страница {offset / 100 + 1}</span><Button size="sm" variant="ghost" disabled={!query.data?.hasMore || query.isFetching} onClick={() => setOffset(offset + 100)}>Далее<ChevronRight aria-hidden="true" className="h-4 w-4" /></Button></div> : null}
    {draft ? <SpecialistDialogShell label={draft.id ? 'Редактирование специалиста' : 'Добавление специалиста'} busy={busy} onClose={close}>
      <DialogHeader title={draft.id ? 'Редактирование специалиста' : 'Добавление специалиста'} subtitle="Карточка в общем справочнике" onClose={close} closeDisabled={busy} />
      <form className="flex min-h-0 flex-col" onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="min-h-0 overflow-y-auto p-5"><fieldset disabled={busy} className="space-y-5">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">ФИО<Input autoFocus required maxLength={300} placeholder="Иванов Иван Иванович" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">Тип специалиста<Select aria-label="Тип специалиста" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as Draft['kind'], methods: [] })}><option value="inspector">Дефектоскопист</option><option value="thermist">Термист</option></Select></label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">№ квалификационного удостоверения<Input required maxLength={200} placeholder="Номер удостоверения" value={draft.certificate} onChange={event => setDraft({ ...draft, certificate: event.target.value })} /></label>
          <fieldset className="h-44 rounded-xl bg-slate-50 p-4 sm:h-32"><legend className="px-1 text-sm font-medium text-slate-700">Виды контроля</legend>
            {draft.kind === 'inspector' ? <><p className="mb-3 text-xs text-slate-500">Выберите все методы, по которым есть допуск.</p><div className="flex flex-wrap gap-2">{SPECIALIST_METHODS.map(method => <label key={method} className={`relative inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-300 ${draft.methods.includes(method) ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
              <input className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" type="checkbox" checked={draft.methods.includes(method)} onChange={event => setDraft({ ...draft, methods: event.target.checked ? [...draft.methods, method] : draft.methods.filter(value => value !== method) })} />
              <Check aria-hidden="true" className={`h-3.5 w-3.5 ${draft.methods.includes(method) ? '' : 'opacity-20'}`} />{method}
            </label>)}</div></> : <p className="flex flex-wrap items-center gap-2 text-sm text-amber-800"><Thermometer aria-hidden="true" className="h-4 w-4" />ПСТО<span className="ml-auto text-xs text-slate-500">Назначено автоматически</span></p>}
          </fieldset>
          <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><BadgeCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Сохранённые ФИО и удостоверения в документах не изменятся.</p>
        </fieldset>{error ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}</div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end"><Button variant="outline" type="button" disabled={busy} onClick={close}>Отмена</Button><Button type="submit" disabled={busy}><Check aria-hidden="true" className="h-4 w-4" />{busy ? 'Сохраняем…' : 'Сохранить специалиста'}</Button></div>
      </form>
    </SpecialistDialogShell> : null}
    {archiveTarget ? <SpecialistDialogShell label={archiveTarget.archived ? 'Восстановить специалиста' : 'Архивировать специалиста'} busy={busy} onClose={() => { if (!saving.current) { setArchiveTarget(null); setError('') } }}>
      <DialogHeader title={archiveTarget.archived ? 'Вернуть специалиста из архива?' : 'Переместить специалиста в архив?'} onClose={() => { if (!saving.current) setArchiveTarget(null) }} closeDisabled={busy} />
      <div className="space-y-3 p-5 text-sm text-slate-600"><p className="font-medium text-slate-800">{archiveTarget.name}</p><p>{archiveTarget.archived ? 'Специалист снова будет доступен для новых назначений.' : 'Специалист исчезнет из списков выбора. ФИО и удостоверение в сохранённых заключениях останутся без изменений.'}</p>{error ? <p role="alert" className="text-rose-700">{error}</p> : null}</div>
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4"><Button variant="outline" disabled={busy} onClick={() => setArchiveTarget(null)}>Отмена</Button><Button disabled={busy} onClick={() => void changeArchive()}>{busy ? 'Сохраняем…' : archiveTarget.archived ? 'Восстановить' : 'В архив'}</Button></div>
    </SpecialistDialogShell> : null}
  </section>
}
