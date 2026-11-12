import { lazy, Suspense, useMemo, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ReadOnlyGrid } from './read-only-grid'
import { Button } from './ui/button'
import { RefreshCw, Archive } from 'lucide-react'
import { SchemeFilterContext, SCHEME_SERVER_FILTER } from './line-scheme-grid-filter'
import './line-schemes-registry.css'
import { useSchemeRegistryHeader } from './line-scheme-registry-header'
import { getLineSchemes } from '@/server/line-schemes-api'
import { SCHEME_PAGE_SIZE, schemeFilterLabel, schemeFilterValue, type SchemeLine, type SchemeFilters, type SchemeFilterField } from '@/lib/line-schemes'
import { useAccess } from '@/lib/security-context'
import { LineSchemeOpening } from './line-scheme-navigation-guard'

const SchemeWorkspace = lazy(() => import('./line-scheme-workspace').then(module => ({ default: module.LineSchemeWorkspace })))
const registryDefaults = { sortable: false, filter: SCHEME_SERVER_FILTER, filterParams: { buttons: [] } }
const rowId = ({ data }: { data: SchemeLine }) => String(data.lineId)
export function SchemePagination({ page, total, onChange, busy = false }: { page: number; total: number; onChange: (page: number) => void; busy?: boolean }) {
  if (page === 0 && total <= SCHEME_PAGE_SIZE) return null
  return <div className="flex items-center justify-between gap-2 py-2 text-xs text-slate-500">
    <Button variant="outline" size="sm" disabled={!page || busy} onClick={() => onChange(page - 1)}>Назад</Button>
    <span>{total ? `${page * SCHEME_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * SCHEME_PAGE_SIZE)} из ${total}` : 'Нет записей'}</span>
    <Button variant="outline" size="sm" disabled={(page + 1) * SCHEME_PAGE_SIZE >= total || busy} onClick={() => onChange(page + 1)}>Далее</Button>
  </div>
}
export function LineSchemesPage({ onOpenJoint }: { onOpenJoint?: (id: number) => void }) {
  const root = useRef<HTMLElement>(null)
  useSchemeRegistryHeader(root)
  const { can } = useAccess()
  const canEdit = can('schemes.edit')
  const [page, setPage] = useState(0), [selected, setSelected] = useState<{ line: SchemeLine; mode: 'drawing' | 'files'; file?: File } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null), uploadLine = useRef<SchemeLine | null>(null)
  const choosePdf = (line: SchemeLine) => { uploadLine.current = line; fileInput.current?.click() }
  const [filters, setFilters] = useState<SchemeFilters>({}), [filterRevision, setFilterRevision] = useState(0)
  const changeFilter = useCallback((field: SchemeFilterField, values: string[]) => { setFilters(previous => { const next = { ...previous }; if (values.length) next[field] = values; else delete next[field]; return next }); setPage(0) }, [])
  const query = useQuery({ queryKey: ['line-schemes', page, filters], queryFn: ({ signal }) => getLineSchemes({ data: { page, filters }, signal }), refetchOnWindowFocus: false, retry: false })
  const filterContext = useMemo(() => ({ filters, change: changeFilter, sourceRevision: filterRevision }), [filters, changeFilter, filterRevision])
  const refresh = () => { void query.refetch(); setFilterRevision(value => value + 1) }
  const hasFilters = Object.keys(filters).length > 0
  const columns = useMemo<ColDef<SchemeLine>[]>(() => [
    { field: 'projectTitle', headerName: 'Проект', flex: 1.1, minWidth: 90 },
    { field: 'subtitleCode', headerName: 'Шифр', flex: .8, minWidth: 100 },
    { field: 'line', headerName: 'Линия', flex: 1, minWidth: 100, cellRenderer: ({ data }: ICellRendererParams<SchemeLine>) => data && <span>{data.line}{data.deleted && <span className="ml-2 text-slate-400">Линия удалена</span>}</span> },
    { field: 'total', headerName: 'Физических стыков', width: 120, cellClass: 'statistics-number' },
    { field: 'welded', headerName: 'Сварено', width: 90, cellClass: 'statistics-number' },
    { field: 'placedCount', headerName: 'На схеме', headerTooltip: 'Количество сохранённых точек на всех листах основного PDF, включая серые. Архивные редакции не учитываются.', width: 90, cellClass: 'statistics-number' },
    { field: 'placedPercent', headerName: '% на схеме', headerTooltip: 'Действующие физические стыки на основном PDF / все действующие физические стыки линии. Аннулированные и исторические точки исключены.', width: 100, cellClass: 'statistics-number', valueFormatter: ({ data }) => data ? schemeFilterLabel('placedPercent', schemeFilterValue(data, 'placedPercent')) : '' },
    { colId: 'pdf', headerName: 'Рабочая документация', flex: 1.5, minWidth: 140, cellRenderer: ({ data }: ICellRendererParams<SchemeLine>) => data && <div className="flex h-full min-w-0 items-center gap-3">{data.fileName ? <button className="truncate text-sky-600 hover:text-sky-700 hover:underline" title={data.fileName} onClick={() => setSelected({ line: data, mode: 'drawing' })}>{data.fileName.replace(/\.pdf$/i, '')}</button> : canEdit && !data.deleted ? <button className="text-slate-500 hover:text-slate-700 hover:underline" onClick={() => choosePdf(data)}>Загрузить PDF</button> : <span className="text-slate-400">Нет основного PDF</span>}</div> },
    { colId: 'files', headerName: 'Файлы и архив', headerTooltip: 'Количество всех файлов линии, включая основной PDF и архивные редакции.', width: 135, minWidth: 120, cellRenderer: ({ data }: ICellRendererParams<SchemeLine>) => data && <button className="flex h-full items-center gap-2 text-slate-600 hover:text-sky-700" aria-label={`Файлы и архив: ${data.line}`} onClick={() => setSelected({ line: data, mode: 'files' })}><Archive size={14} /><span>Файлы</span><span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">{data.revisionCount}</span></button> },
  ], [canEdit])
  return <section ref={root} className="line-schemes-registry w-full min-w-0 space-y-3" aria-label="Схемы линий">
    <input ref={fileInput} className="hidden" type="file" accept="application/pdf,.pdf" aria-label="Загрузить PDF линии" onChange={event => { const file = event.target.files?.[0], line = uploadLine.current; event.target.value = ''; if (file && line) setSelected({ line, mode: 'files', file }) }} />
    <div className="flex flex-wrap items-center gap-3">
      {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setPage(0) }}>Сбросить фильтры ({Object.keys(filters).length})</Button>}
      <span className="mr-auto text-xs text-slate-400" aria-live="polite">Линий: {query.data?.total ?? 0}</span>
      <Button className="gap-2" variant="outline" onClick={refresh} disabled={query.isFetching}><RefreshCw size={15} className={query.isFetching ? 'animate-spin' : undefined} />Обновить список</Button>
    </div>
    {query.error && <p role="alert" className="text-sm text-red-700">{query.error.message}</p>}
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <SchemeFilterContext.Provider value={filterContext}>
        <ReadOnlyGrid<SchemeLine> label="Схемы линий" domLayout="autoHeight" columnFilters enableFilterHandlers defaultColDef={registryDefaults} rowData={query.data?.rows ?? []} columnDefs={columns} getRowId={rowId} loading={query.isFetching} />
      </SchemeFilterContext.Provider>
      {(page > 0 || (query.data?.total ?? 0) > SCHEME_PAGE_SIZE) && <div className="border-t border-slate-200 px-3"><SchemePagination page={page} total={query.data?.total ?? 0} onChange={next => { setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }) }} busy={query.isFetching} /></div>}
    </div>
    {selected && <Suspense fallback={<LineSchemeOpening hasSelectedFile={!!selected.file} />}><SchemeWorkspace key={selected.line.lineId} line={selected.line} initialMode={selected.mode} initialFile={selected.file} onOpenJoint={onOpenJoint} onClose={() => { setSelected(null); refresh() }} /></Suspense>}
  </section>
}
