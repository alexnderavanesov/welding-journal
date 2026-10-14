import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, UserRound, X } from 'lucide-react'
import { Input } from './ui/input'
import { SpecialistPicker } from './specialist-picker'
import { Button } from './ui/button'
import { listSpecialists } from '@/server/specialists'
import { specialistMatches, type SpecialistDocumentProfile, type SpecialistRecord } from '@/lib/document-specialists'

export function useSpecialistOptions(profile?: SpecialistDocumentProfile | null, initialRecords?: SpecialistRecord[]) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const timer = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(timer) }, [search])
  const kind = profile?.kind, methods = [...profile?.methods ?? []].sort()
  const query = useQuery({ queryKey: ['specialists', 'options', debounced, kind, methods], queryFn: () => listSpecialists({ data: { search: debounced, kind, methods } }), enabled: Boolean(profile), staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false })
  const [known, setKnown] = useState<Map<number, SpecialistRecord>>(() => new Map(initialRecords?.map(record => [record.id, record])))
  useEffect(() => { if (initialRecords) setKnown(previous => new Map([...previous, ...initialRecords.map(record => [record.id, record] as const)])) }, [initialRecords])
  useEffect(() => { if (query.data) setKnown(previous => new Map([...previous, ...query.data.records.map(record => [record.id, record] as const)])) }, [query.data])
  return { search, setSearch, query, known, records: query.data?.records ?? [] }
}

export function SpecialistSearch({ options, autoFocus = false }: { options: ReturnType<typeof useSpecialistOptions>; autoFocus?: boolean }) {
  return <div className="space-y-1.5"><div className="relative">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
    <Input type="search" autoFocus={autoFocus} aria-label="Поиск специалиста" placeholder="ФИО или удостоверение" className="pl-9 pr-10" value={options.search} onChange={event => options.setSearch(event.target.value)} />
    {options.search ? <Button size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8" aria-label="Очистить поиск специалиста" onClick={() => options.setSearch('')}><X aria-hidden="true" className="h-4 w-4" /></Button> : null}
    </div>
    {options.query.isPending ? <p className="text-xs text-slate-500">Загрузка специалистов…</p> : null}
    {options.query.isError ? <button type="button" className="text-sm text-rose-700" onClick={() => void options.query.refetch()}>Не удалось загрузить специалистов. Повторить</button> : null}
    {options.query.data?.hasMore ? <p className="text-xs text-slate-500">Показаны первые 100 специалистов. Уточните поиск.</p> : null}
  </div>
}

export function SpecialistSelect({ label, value, onChange, profile, options, allowKeep = false, disabled = false, currentLabel, density = 'card' }: {
  label: string; value: number | null | undefined; onChange: (value: number | null | undefined) => void
  profile: SpecialistDocumentProfile; options: ReturnType<typeof useSpecialistOptions>; allowKeep?: boolean; disabled?: boolean; currentLabel?: string
  density?: 'card' | 'compact' | 'cell'
}) {
  const records = options.records.filter(record => specialistMatches(record, profile))
  const selected = value ? options.known.get(value) ?? records.find(record => record.id === value) : undefined
  return <div className={density === 'card' ? 'min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100/50' : 'min-w-0'}>
    {density !== 'cell' ? <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-600"><UserRound aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />{label}</div> : null}
    <div className="flex min-w-0 items-center gap-1">
      <SpecialistPicker label={label} value={value} onChange={onChange} records={records} selected={selected} allowKeep={allowKeep} disabled={disabled} currentLabel={currentLabel} compact={density !== 'card'} search={<SpecialistSearch options={options} />} />
      <Button type="button" variant="ghost" size="icon" className="h-8 w-7 shrink-0 text-slate-400 hover:bg-rose-50 hover:text-rose-700" aria-label={`Очистить роль «${label}»`} title="Очистить назначение" disabled={disabled || value === null || (!allowKeep && value === undefined)} onClick={() => onChange(null)}><X aria-hidden="true" className="h-3.5 w-3.5" /></Button>
    </div>
    {density === 'card' ? <p className={`mt-2 min-h-4 break-words text-xs ${allowKeep && value === null ? 'text-rose-600' : 'text-slate-400'}`}>{selected ? `Удостоверение № ${selected.certificate}` : allowKeep ? value === null ? 'ФИО и удостоверение будут убраны' : value === undefined ? 'Текущее назначение сохранится' : 'Выбран специалист' : 'Назначение необязательно'}</p> : null}
  </div>
}
