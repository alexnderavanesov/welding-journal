import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, Files, Plus, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TechnologyCardEditor } from '@/components/technology-card-editor'
import { TechnologyCardAssignmentDialog } from '@/components/technology-card-assignment-dialog'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { useSecurityGuard } from '@/lib/security-context'
import { DISPATCHER_TASK_SNAPSHOT_QUERY_KEY, invalidateWeldPageQueries } from '@/lib/weld-query-utils'
import { TECHNOLOGY_CARD_PSTO_OPTIONS, type TechnologyCardRecord } from '@/lib/technology-card-types'
import { changeTechnologyCard, getTechnologyCardPage, type TechnologyCardChange } from '@/server/technology-cards-api'
import { TECHNOLOGY_CARDS_QUERY_KEY } from '@/lib/technology-card-query'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все карты', description: 'Весь реестр', icon: Files, color: 'border-sky-300 bg-sky-50 text-sky-800' },
  { value: 'active', label: 'Действующие', description: 'Участвуют в подборе', icon: CheckCircle2, color: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  { value: 'archived', label: 'Архивные', description: 'Сохраняют историю', icon: Archive, color: 'border-slate-400 bg-slate-100 text-slate-800' },
] as const

export function TechnologyCardsRegistry({ active }: { active: boolean }) {
  const client = useQueryClient()
  const confirm = useConfirmAction()
  const { requireSettingsChangePassword } = useSecurityGuard()
  const [search, setSearch] = useState('')
  const querySearch = useDebouncedValue(search.trim(), 300)
  const [archive, setArchive] = useState<'active' | 'archived' | 'all'>('active')
  const [cursors, setCursors] = useState([0])
  const [editor, setEditor] = useState<{ card: TechnologyCardRecord | null } | null>(null)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const cursor = cursors.at(-1)!
  const query = useQuery({
    queryKey: [...TECHNOLOGY_CARDS_QUERY_KEY, 'page', archive, querySearch, cursor],
    queryFn: () => getTechnologyCardPage({ data: { archive, search: querySearch, afterId: cursor, limit: 50 } }),
    enabled: active, staleTime: 30_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })

  async function change(input: TechnologyCardChange) {
    if (busyRef.current) return false
    busyRef.current = true; setBusy(true); setMessage('')
    try {
      if (!await requireSettingsChangePassword()) return false
      await changeTechnologyCard({ data: input })
      await client.invalidateQueries({ queryKey: TECHNOLOGY_CARDS_QUERY_KEY, refetchType: 'active' })
      void client.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY })
      void invalidateWeldPageQueries(client)
      setMessage(input.action === 'delete' ? 'Технологическая карта удалена.' : 'Технологическая карта сохранена.')
      return true
    } catch (error) {
      setMessage((error as Error).message)
      // Refresh available revisions without overwriting the open editor draft.
      void client.invalidateQueries({ queryKey: TECHNOLOGY_CARDS_QUERY_KEY, refetchType: 'active' })
      return false
    } finally { busyRef.current = false; setBusy(false) }
  }

  async function remove(card: TechnologyCardRecord) {
    if (busyRef.current) return
    if (!await confirm({ title: 'Удалить технологическую карту?', itemName: card.name,
      description: 'Карта будет удалена из реестра. Использованную в стыках карту можно только архивировать.', confirmLabel: 'Удалить ТК' })) return
    await change({ action: 'delete', id: card.id, expectedRevision: card.revision, confirmed: true })
  }

  return <section className="space-y-3" aria-label="Реестр технологических карт">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Технологические карты</h1><p className="mt-1 text-sm text-slate-500">Общий реестр проверенных заказчиком карт для всего журнала.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setAssignmentOpen(true)}>Проверить и назначить ТК</Button><Button disabled={busy} onClick={() => { setMessage(''); setEditor({ card: null }) }}><Plus className="h-4 w-4" aria-hidden="true" />Добавить ТК</Button></div>
    </div>
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <Input type="search" aria-label="Поиск технологических карт" placeholder="Поиск по названию ТК" className="pl-9 pr-9" value={search} onChange={event => { setSearch(event.target.value); setCursors([0]) }} />
        {search && <Button size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8" aria-label="Очистить поиск ТК" onClick={() => { setSearch(''); setCursors([0]) }}><X aria-hidden="true" className="h-4 w-4" /></Button>}
      </div>
      <Button variant="outline" className="shrink-0 px-3" aria-label="Обновить реестр ТК" title="Обновить реестр ТК" disabled={query.isFetching || busy} onClick={() => void query.refetch()}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Обновить</span></Button>
    </div>
    <div role="group" className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Состояние технологических карт">
      {STATUS_OPTIONS.map(option => <button key={option.value} type="button" aria-label={option.label} aria-pressed={archive === option.value}
        onClick={() => { setArchive(option.value); setCursors([0]) }}
        className={`flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${archive === option.value ? option.color : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white'}`}>
        <span><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-xs opacity-75">{option.description}</span></span><option.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
      </button>)}
    </div>
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    {query.isError ? <p role="alert" className="text-sm text-red-700">{(query.error as Error).message}</p> : query.isPending ? <p className="text-sm text-slate-500">Загрузка ТК…</p> : <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{['Название', 'Способы / соединение', 'Группы', 'D / T, мм', 'ПСТО', 'Действия'].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
        <tbody>{query.data.items.map(card => <tr key={card.id} className="border-t border-slate-100">
          <td className="px-3 py-2 font-medium">{card.name}{card.archived && <span className="ml-2 text-xs text-slate-500">Архив</span>}</td>
          <td className="px-3 py-2">{card.weldingMethods.join(' + ')} · {card.connectionType}</td><td className="px-3 py-2">{card.materialGroups.join(' + ')}</td>
          <td className="whitespace-nowrap px-3 py-2">D {card.diameterFrom}–{card.diameterTo}<br />T {card.thicknessFrom}–{card.thicknessTo}</td>
          <td className="px-3 py-2">{TECHNOLOGY_CARD_PSTO_OPTIONS.find(option => option.value === card.psto)?.label}</td>
          <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setMessage(''); setEditor({ card }) }}>Изменить</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void change({ action: 'archive', id: card.id, expectedRevision: card.revision, archived: !card.archived })}>{card.archived ? 'Вернуть' : 'В архив'}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(card)}>Удалить</Button></div></td>
        </tr>)}</tbody></table>
      {!query.data.items.length && <p className="p-4 text-sm text-slate-500">Технологические карты не найдены.</p>}
    </div>}
    <div className="flex items-center gap-2"><Button variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(value => value.slice(0, -1))}>Назад</Button><span className="text-sm text-slate-500">Страница {cursors.length}</span><Button variant="outline" disabled={!query.data?.nextCursor || query.isFetching} onClick={() => setCursors(value => [...value, query.data!.nextCursor!])}>Далее</Button></div>
    {editor && <TechnologyCardEditor card={editor.card} busy={busy} message={message} onClose={() => { if (!busyRef.current) setEditor(null) }} onSave={async draft => {
      const ok = await change(editor.card ? { action: 'update', id: editor.card.id, expectedRevision: editor.card.revision, card: draft } : { action: 'create', card: draft })
      if (ok) setEditor(null)
    }} />}
    {assignmentOpen && <TechnologyCardAssignmentDialog onClose={() => setAssignmentOpen(false)} />}
  </section>
}
