import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, RotateCcw, RefreshCw } from 'lucide-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { activityActionLabel, activityFieldLabel, activityValueLabel } from '@/lib/activity-labels'
import { AccessDialog } from './access-dialog'
import { ReadOnlyGrid } from './read-only-grid'
import { Button } from './ui/button'
import { FieldHelp } from './field-help'
import { useAccess } from '@/lib/security-context'
import { getActivityDetails, listActivityHistory } from '@/server/activity-api'
import { ACTIVITY_SERVER_FILTER, ActivityFilterContext, type ActivityFilterField } from './activity-column-filter'
import type { HistoryRequest } from '@/server/activity-history'

const formatTime = (time: string | Date) => new Date(time).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
type ActivityRow = Awaited<ReturnType<typeof listActivityHistory>>['rows'][number]
const EMPTY_ROWS: ActivityRow[] = []
const DEFAULT_COLUMN: ColDef<ActivityRow> = { sortable: false, filter: false, resizable: true, suppressHeaderMenuButton: true, minWidth: 160 }
const rowId = ({ data }: { data: ActivityRow }) => data.id
export function ActivityPanel({ embedded = false }: { embedded?: boolean }) {
  const { can } = useAccess()
  const jointId = Number(new URLSearchParams(window.location.search).get('jointId')) || undefined
  const [filters, setFilters] = useState<HistoryRequest>({ jointId })
  const [snapshot, setSnapshot] = useState(() => new Date().toISOString())
  const [cursors, setCursors] = useState<Array<HistoryRequest['cursor']>>([undefined]), [page, setPage] = useState(0), [opened, setOpened] = useState<ActivityRow | null>(null)
  const allowed = can(jointId ? 'history.joint' : 'history.view')
  const history = useQuery({ queryKey: ['activity', filters, snapshot, cursors[page]], enabled: allowed, queryFn: () => listActivityHistory({ data: { ...filters, until: filters.until ?? snapshot, cursor: cursors[page] } }) })
  const columns = useMemo<ColDef<ActivityRow>[]>(() => [
    { field: 'createdAt', filter: ACTIVITY_SERVER_FILTER, filterParams: { buttons: [] }, headerName: 'Дата и время · МСК', width: 205, valueFormatter: ({ value }) => formatTime(value) },
    { field: 'actorName', filter: ACTIVITY_SERVER_FILTER, filterParams: { buttons: [] }, headerName: 'Автор', flex: 1, minWidth: 220, cellClass: 'font-medium' },
    { field: 'action', filter: ACTIVITY_SERVER_FILTER, filterParams: { buttons: [] }, headerName: 'Действие', flex: 1.4, minWidth: 260, valueGetter: ({ data }) => data ? activityActionLabel(data.action, data.area) : '' },
    { colId: 'details', headerName: 'Подробности', width: 145, minWidth: 145, resizable: false,
      cellRenderer: ({ data }: ICellRendererParams<ActivityRow>) => data ? <Button variant="ghost" size="sm" onClick={() => setOpened(data)}>Подробности</Button> : null },
  ], [])
  function changeFilters(_field: ActivityFilterField, value: Partial<HistoryRequest>) {
    setFilters(previous => ({ ...previous, ...value })); setSnapshot(new Date().toISOString()); setPage(0); setCursors([undefined]); setOpened(null)
  }
  function refresh(reset = false) {
    if (reset) setFilters({ jointId })
    setSnapshot(new Date().toISOString()); setPage(0); setCursors([undefined]); setOpened(null)
  }
  if (!allowed) return <p>Доступ к истории не предоставлен администратором.</p>
  return <section className="space-y-4">
    {!embedded || jointId ? <h2 className="text-lg font-semibold text-slate-900">{jointId ? `История стыка · ID ${jointId}` : 'Журнал действий'}</h2> : null}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-xs text-slate-500"><Clock3 className="h-4 w-4" />Сначала новые события · время МСК<FieldHelp label="С какого момента ведётся история">История начинается с включения персонального доступа. Прежним изменениям авторы не назначаются. Поиск и фильтры в заголовках столбцов действуют по всей доступной истории.</FieldHelp><div className="ml-auto flex gap-2">{filters.from || filters.until || filters.actorId || filters.action ? <Button variant="ghost" size="sm" onClick={() => refresh(true)}><RotateCcw className="h-4 w-4" />Сбросить фильтры</Button> : null}<Button variant="ghost" size="sm" disabled={history.isFetching} onClick={() => refresh()}><RefreshCw className="h-4 w-4" />Обновить журнал</Button></div></div>
      {history.error ? <p role="alert" className="p-4 text-sm text-rose-700">{history.error.message} <button type="button" className="underline" onClick={() => void history.refetch()}>Повторить загрузку</button></p> : null}
      <ActivityFilterContext.Provider value={{ filters, change: changeFilters }}>
        <ReadOnlyGrid<ActivityRow> label="Журнал действий" columnFilters enableFilterHandlers rowData={history.data?.rows ?? EMPTY_ROWS} columnDefs={columns} defaultColDef={DEFAULT_COLUMN} getRowId={rowId}
          loading={history.isPending} rowHeight={46} headerHeight={42} onRowDoubleClicked={event => { if (event.data) setOpened(event.data) }}
          onCellKeyDown={event => { if ((event.event as KeyboardEvent)?.key === 'Enter' && event.data && !(event.event?.target instanceof Element && event.event.target.closest('button'))) setOpened(event.data) }} />
      </ActivityFilterContext.Provider>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
        <p className="text-xs text-slate-500" role="status">{history.isFetching ? 'Обновление…' : `На странице: ${history.data?.rows.length ?? 0} · до 50 событий`}</p>
        <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page === 0 || history.isFetching} onClick={() => { setPage(page - 1); setOpened(null) }}>Назад</Button><span className="text-sm text-slate-600">Страница {page + 1}</span><Button variant="outline" size="sm" disabled={!history.data?.nextCursor || history.isFetching} onClick={() => { setCursors(previous => [...previous.slice(0, page + 1), history.data!.nextCursor!]); setSnapshot(history.data!.until); setPage(page + 1); setOpened(null) }}>Далее</Button></div>
      </div>
    </div>
    {opened ? <AccessDialog title={activityActionLabel(opened.action, opened.area)} description={`${formatTime(opened.createdAt)} МСК · ${opened.actorName}`} wide onClose={() => setOpened(null)} footer={<Button variant="outline" onClick={() => setOpened(null)}>Закрыть</Button>}><ActivityDetails key={opened.id} operationId={opened.id} jointId={jointId} /></AccessDialog> : null}
  </section>
}
function ActivityDetails({ operationId, jointId }: { operationId: string; jointId?: number }) {
  const [afterId, setAfterId] = useState<number | undefined>()
  const details = useQuery({ queryKey: ['activity-details', operationId, jointId, afterId], queryFn: () => getActivityDetails({ data: { operationId, jointId, afterId } }) })
  return <div className="space-y-4">
    {details.isPending ? <p className="text-sm text-slate-500">Загружаем подробности…</p> : null}
    {details.error ? <p role="alert" className="text-sm text-rose-700">Не удалось загрузить подробности. <button className="underline" onClick={() => void details.refetch()}>Повторить</button></p> : null}
    {details.data && !details.data.rows.length ? <p className="text-sm text-slate-500">Доступных подробностей нет.</p> : null}
    {details.data?.rows.map(row => <section key={row.id} className="overflow-hidden rounded-xl border border-slate-200"><h3 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{row.label} · {row.kind === 'create' ? 'Создание' : row.kind === 'delete' ? 'Удаление' : 'Изменение'}{row.jointId ? ` · стык ID ${row.jointId}` : ''}</h3><table className="w-full table-fixed text-left text-sm"><thead><tr className="text-xs text-slate-500"><th className="w-1/4 px-4 py-3">Поле</th><th className="px-4 py-3">Было</th><th className="px-4 py-3">Стало</th></tr></thead><tbody>{Object.entries(row.changes).map(([key, value]) => <tr key={key} className="border-t border-slate-100 align-top"><td className="break-words px-4 py-3 font-medium text-slate-600">{activityFieldLabel(row.entity, key)}</td><td className="whitespace-pre-wrap break-words px-4 py-3 text-slate-500">{activityValueLabel(row.entity, key, value.before)}</td><td className="whitespace-pre-wrap break-words bg-sky-50/40 px-4 py-3 text-slate-800">{activityValueLabel(row.entity, key, value.after)}</td></tr>)}</tbody></table></section>)}
    <div className="flex gap-3">{afterId ? <Button variant="outline" disabled={details.isFetching} onClick={() => setAfterId(undefined)}>К началу операции</Button> : null}{details.data?.nextCursor ? <Button variant="outline" disabled={details.isFetching} onClick={() => setAfterId(details.data!.nextCursor!)}>Следующие записи операции</Button> : null}</div>
  </div>
}
