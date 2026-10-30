import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGridFilterDisplay, type CustomFilterDisplayProps } from 'ag-grid-react'
import { Search, X } from 'lucide-react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { getActivityFilters } from '@/server/activity-api'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { activityActionLabel } from '@/lib/activity-labels'
import type { HistoryRequest } from '@/server/activity-history'

export type ActivityFilterField = 'createdAt' | 'actorName' | 'action'
export const ActivityFilterContext = createContext<{
  filters: HistoryRequest; change: (field: ActivityFilterField, value: Partial<HistoryRequest>) => void
}>({ filters: {}, change: () => undefined })
export const ACTIVITY_SERVER_FILTER = { component: ActivityColumnFilter, doesFilterPass: () => true }
const moscowInput = (value?: string) => value ? new Date(new Date(value).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16) : ''

function ActivityColumnFilter({ column, api, model, onModelChange }: CustomFilterDisplayProps) {
  const { filters, change } = useContext(ActivityFilterContext)
  const field = column.getColId() as ActivityFilterField
  const [visible, setVisible] = useState(false), [search, setSearch] = useState(''), [error, setError] = useState('')
  const [from, setFrom] = useState(moscowInput(filters.from)), [until, setUntil] = useState(moscowInput(filters.until))
  const input = useRef<HTMLInputElement>(null), hide = useRef<(() => void) | undefined>(undefined)
  const match = useDebouncedValue(search.trim(), 250)
  const value = field === 'createdAt' ? filters.from || filters.until ? { from: filters.from, until: filters.until } : null : field === 'actorName' ? filters.actorId ?? null : filters.action ?? null
  // AG owns popup/keyboard presentation; the server applies every filter over the entire history.
  useEffect(() => { if (JSON.stringify(model) !== JSON.stringify(value)) onModelChange(value) }, [model, value, onModelChange])
  useGridFilterDisplay({ afterGuiAttached: params => {
    hide.current = params?.hidePopup; setVisible(true); setError(''); setSearch('')
    setFrom(moscowInput(filters.from)); setUntil(moscowInput(filters.until)); input.current?.focus({ preventScroll: true })
  }, afterGuiDetached: () => setVisible(false) })
  const choices = useQuery({ queryKey: ['activity-filters', filters.jointId, field === 'actorName' ? match : ''], enabled: visible && field !== 'createdAt',
    queryFn: () => getActivityFilters({ data: { jointId: filters.jointId, search: field === 'actorName' ? match : undefined } }), staleTime: 15000 })
  const close = () => { hide.current?.(); api.setFocusedHeader(column) }
  const apply = (next: Partial<HistoryRequest>) => { change(field, next); close() }
  const reset = () => apply(field === 'createdAt' ? { from: undefined, until: undefined } : field === 'actorName' ? { actorId: undefined } : { action: undefined })
  const options = field === 'actorName' ? choices.data?.authors.map(item => ({ value: item.id ?? '@operator', label: item.name, detail: item.id ? item.id.slice(0, 8) : 'Оператор сервера' })) ?? []
    : choices.data?.actions.map(action => ({ value: action, label: activityActionLabel(action), detail: '' })).filter(item => item.label.toLocaleLowerCase().includes(match.toLocaleLowerCase())) ?? []
  const pending = search.trim() !== match || choices.isFetching
  return <div role="dialog" aria-label={`Фильтр: ${column.getColDef().headerName}`} className="activity-column-filter min-w-0 w-full whitespace-normal text-sm [overflow-wrap:anywhere]" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><strong className="min-w-0 font-medium text-slate-700">{field === 'action' ? 'Тип изменения' : column.getColDef().headerName}</strong><button type="button" aria-label="Закрыть фильтр" onClick={close} className="shrink-0 rounded p-1 text-slate-400 hover:text-sky-700"><X className="h-4 w-4" /></button></div>
    {field === 'createdAt' ? <form className="space-y-4 p-4" onSubmit={event => {
      event.preventDefault()
      const start = from ? new Date(`${from}${from.length === 16 ? ':00' : ''}+03:00`) : undefined
      const end = until ? new Date(`${until}${until.length === 16 ? ':00' : ''}+03:00`) : undefined
      if (start && !Number.isFinite(start.getTime()) || end && !Number.isFinite(end.getTime())) { setError('Проверьте дату и время.'); return }
      if (start && start > (end ?? new Date())) { setError('Начало периода должно быть не позже его окончания.'); return }
      apply({ from: start?.toISOString(), until: end?.toISOString() })
    }}>
      <p className="text-xs text-slate-500">Период по московскому времени (МСК).</p>
      <label className="grid min-w-0 gap-2 text-slate-600">С даты и времени<Input ref={input} className="min-w-0 max-w-full" type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label className="grid min-w-0 gap-2 text-slate-600">До даты и времени<Input className="min-w-0 max-w-full" type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label>
      {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
      <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost" size="sm" onClick={reset}>Сбросить фильтр</Button><Button type="submit" size="sm">Применить</Button></div>
    </form> : <>
      <div className="p-3"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input ref={input} aria-label={field === 'actorName' ? 'Поиск автора' : 'Поиск типа изменения'} placeholder={field === 'actorName' ? 'Найти по ФИО…' : 'Найти тип изменения…'} className="pl-9" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="max-h-64 overflow-x-hidden overflow-y-auto px-2 pb-2" aria-busy={pending}>
        {choices.error ? <p role="alert" className="p-3 text-xs text-rose-700">Не удалось загрузить значения. <button className="underline" onClick={() => void choices.refetch()}>Повторить</button></p> : pending ? <p className="p-3 text-slate-400">Поиск…</p> : options.length ? options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-sky-50 ${value === option.value ? 'bg-sky-50 text-sky-700' : 'text-slate-600'}`} onClick={() => apply(field === 'actorName' ? { actorId: option.value } : { action: option.value })}><span className="min-w-0 break-words">{option.label}{option.detail ? <span className="block text-xs text-slate-400">{option.detail}</span> : null}</span>{value === option.value ? <span className="ml-auto">✓</span> : null}</button>) : <p className="p-3 text-slate-400">Совпадений нет.</p>}
      </div>
      <div className="border-t border-slate-200 p-3"><Button type="button" variant="ghost" size="sm" onClick={reset}>Сбросить фильтр</Button><p className="mt-2 text-xs leading-5 text-slate-400">Фильтр действует по всей доступной истории.{field === 'actorName' && options.length >= 50 ? ' Показаны первые 50 авторов — уточните поиск.' : ''}</p></div>
    </>}
  </div>
}
