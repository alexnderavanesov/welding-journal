import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { getActivityDetails } from '@/server/activity-api'
import { activityKindLabels, activityPositionSummary, activityRecordFields, activityRecordTitle, presentActivityChanges, splitActivityOrigins, type ActivityRecord, type PresentedChange } from '@/lib/activity-presentation'
import { ActivityValue } from './activity-value'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function ActivityDetails({ operationId, jointId }: { operationId: string; jointId?: number }) {
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined])
  const [page, setPage] = useState(0)
  const afterId = cursors[page]
  const details = useQuery({
    queryKey: ['activity-details', operationId, jointId, afterId],
    queryFn: () => getActivityDetails({ data: { operationId, jointId, afterId } }),
    // Committed audit events are immutable. Release large pages as soon as the
    // user moves on or closes the dialog; no background refresh of old history.
    staleTime: Infinity, gcTime: 0,
  })
  return <div className="space-y-4">
    {details.isPending ? <p role="status" className="text-sm text-slate-500">Загружаем подробности…</p> : null}
    {details.error ? <p role="alert" className="text-sm text-rose-700">Не удалось загрузить подробности. <button className="underline" onClick={() => void details.refetch()}>Повторить</button></p> : null}
    {details.data ? <ActivityDetailPage key={afterId ?? 'first'} rows={details.data.rows} page={page + 1} hasNext={!!details.data.nextCursor} /> : null}
    {page || details.data?.nextCursor ? <nav aria-label="Страницы операции" className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
      {page ? <><Button variant="ghost" size="sm" disabled={details.isFetching} onClick={() => setPage(0)}>К началу операции</Button>
        <Button variant="outline" size="sm" disabled={details.isFetching} onClick={() => setPage(page - 1)}>Предыдущие записи</Button></> : null}
      {details.data?.nextCursor ? <Button variant="outline" size="sm" disabled={details.isFetching} onClick={() => {
        setCursors(previous => [...previous.slice(0, page + 1), details.data!.nextCursor!]); setPage(page + 1)
      }}>Следующие записи операции</Button> : null}
    </nav> : null}
  </div>
}

export function ActivityDetailPage({ rows, page, hasNext }: { rows: ActivityRecord[]; page: number; hasNext: boolean }) {
  const [search, setSearch] = useState('')
  const [automaticOpen, setAutomaticOpen] = useState(false)
  const automaticId = useId()
  const groups = useMemo(() => splitActivityOrigins(rows), [rows])
  const classified = groups.user.length > 0 || groups.automatic.length > 0
  const needle = search.trim().toLocaleLowerCase('ru')
  const matches = (row: ActivityRecord) => !needle || (row.entity === 'generated_document_weld_joints'
    ? 'обновлён состав связанных документов'.includes(needle)
    : `${activityRecordTitle(row)} ${activityRecordFields(row).join(' ')}`.toLocaleLowerCase('ru').includes(needle))
  const user = groups.user.filter(matches), automatic = groups.automatic.filter(matches), unknown = groups.unknown.filter(matches)
  return <div className="space-y-4">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium text-slate-800">{rows.length ? `Записей на странице: ${rows.length}` : 'Доступных подробностей нет.'}</p>
        <p className="text-xs text-slate-500">Страница {page}{hasNext ? ' · есть продолжение' : ''}</p>
      </div>
      {rows.length > 1 ? <><label className="relative block"><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input aria-label="Найти запись на этой странице" placeholder="Название, стык или поле на этой странице" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} />
      </label><p className="text-xs text-slate-500">Выберите запись, чтобы увидеть изменения. Поиск действует на текущей странице операции.</p></> : null}
    </div>
    {!user.length && !automatic.length && !unknown.length && rows.length ? <p role="status" className="text-sm text-slate-500">{needle ? 'На этой странице совпадений нет.' : 'На этой странице нет изменений рабочих полей.'}</p> : null}
    {user.length ? <section aria-label="Изменения пользователя" className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800">Изменения пользователя</h3>
      <ActivityRecordList rows={user} initiallyOpen />
    </section> : null}
    {automatic.length ? <section className="overflow-hidden rounded-lg border border-slate-200">
      <button type="button" aria-expanded={automaticOpen} aria-controls={automaticId} onClick={() => setAutomaticOpen(open => !open)}
        className="flex w-full items-center gap-2 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300">
        {automaticOpen ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
        <span>Автоматические изменения · записей на странице: {automatic.length}</span>
      </button>
      {automaticOpen ? <div id={automaticId} className="space-y-3 border-t border-slate-200 p-3">
        <p className="text-xs text-slate-500">Система выполнила эти изменения вследствие действия пользователя.</p>
        <ActivityRecordList rows={automatic} />
      </div> : null}
    </section> : null}
    {unknown.length ? <section className="space-y-2">
      {classified ? <><h3 className="text-sm font-semibold text-slate-700">Другие изменения</h3><p className="text-xs text-slate-500">Для этих записей источник отдельных изменений не указан.</p></> : null}
      <ActivityRecordList rows={unknown} />
    </section> : null}
  </div>
}
function ActivityRecordList({ rows, initiallyOpen = false }: { rows: ActivityRecord[]; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(initiallyOpen || rows.length === 1 ? rows.find(row => row.entity !== 'generated_document_weld_joints')?.id ?? null : null)
  const instance = useId()
  // Formatting large snapshots stays lazy: at most one record per visible section.
  const entries = useMemo(() => rows.filter(row => row.entity !== 'generated_document_weld_joints')
    .map(row => ({ row, title: activityRecordTitle(row), fields: activityRecordFields(row) })), [rows])
  const relationCount = rows.filter(row => row.entity === 'generated_document_weld_joints').length
  return <div className="space-y-2">
    {entries.map(({ row, title, fields }) => {
      const open = expanded === row.id, Icon = open ? ChevronDown : ChevronRight
      const id = `${instance}-change-${row.id}`
      return <section key={row.id} className={`overflow-hidden rounded-lg border ${open ? 'border-sky-200' : 'border-slate-200'}`}>
        <h4><button type="button" aria-label={`${title} · ${activityKindLabels[row.kind]}`} aria-expanded={open} aria-controls={id} onClick={() => setExpanded(open ? null : row.id)}
          className="flex w-full items-start gap-3 bg-slate-50/70 px-4 py-3 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300">
          <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-800">{title}</span>
            <span className="mt-1 block truncate text-xs font-normal text-slate-500">{fields.slice(0, 3).join(' · ')}{fields.length > 3 ? ` · ещё ${fields.length - 3}` : ''}</span></span>
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${row.kind === 'delete' ? 'bg-rose-50 text-rose-700' : row.kind === 'create' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{activityKindLabels[row.kind]}</span>
        </button></h4>
        {open ? <div id={id} className="border-t border-slate-100"><ActivityRecordChanges row={row} /></div> : null}
      </section>
    })}
    {relationCount > 0 ? <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">Обновлён состав связанных документов.</p> : null}
  </div>
}

function ActivityRecordChanges({ row }: { row: ActivityRecord }) {
  const changes = useMemo(() => presentActivityChanges(row), [row])
  const positions = changes.find(change => change.valueKey === 'sourcePositions')
  const fields = changes.filter(change => change !== positions)
  const positionCountShown = fields.some(change => change.valueKey === 'positionCount' || change.label === 'Количество стыков и позиций')
  return <>
    {fields.length ? <ChangeTable row={row} changes={fields} /> : null}
    {positions && (!positionCountShown || row.kind === 'update') ? <p className="px-4 py-3 text-sm text-slate-600">{activityPositionSummary(positions, row.kind, !positionCountShown)}</p> : null}
    {!changes.length ? <p className="px-4 py-3 text-sm text-slate-500">{row.kind === 'create' ? 'Дополнительные сведения сохранены.' : row.kind === 'delete' ? 'Дополнительные сведения удалены.' : 'Обновлены дополнительные сведения.'}</p> : null}
  </>
}
function ChangeTable({ row, changes }: { row: ActivityRecord; changes: PresentedChange[] }) {
  const comparison = row.kind === 'update'
  return <div className="activity-change-table" role="table" aria-label="Изменения записи">
    <div role="row" className={`hidden gap-4 bg-slate-50/40 px-4 py-2 text-xs font-medium text-slate-500 sm:grid ${comparison ? 'grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,3fr)]'}`}>
      <span role="columnheader">Поле</span>{comparison ? <><span role="columnheader">Было</span><span role="columnheader">Стало</span></> : <span role="columnheader">{row.kind === 'create' ? 'Сохранено' : 'До удаления'}</span>}
    </div>
    {changes.map(change => <div key={change.key} role="row" className={`grid gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:gap-4 ${comparison ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)]' : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]'}`}>
      <div role="rowheader" className="break-words font-medium text-slate-600">{change.label}</div>
      {(comparison ? ['before', 'after'] as const : [row.kind === 'create' ? 'after' : 'before'] as const).map(side => <div key={side} role="cell" className={`min-w-0 ${side === 'before' && comparison ? 'text-slate-500' : 'text-slate-800'}`}>
        <span className="mb-1 block text-xs text-slate-400 sm:hidden">{comparison ? side === 'before' ? 'Было' : 'Стало' : row.kind === 'create' ? 'Сохранено' : 'До удаления'}</span>
        <ActivityValue entity={row.entity} field={change.valueKey} value={change[side]} />
      </div>)}
    </div>)}
  </div>
}
