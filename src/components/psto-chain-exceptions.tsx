import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ArrowLeft, ArrowRight, Check, Loader2, Pencil, Plus, Undo2 } from 'lucide-react'
import { closeEmptyPstoChainException, getPstoChainExceptionPreview, getPstoExceptionRowId, listPstoChainExceptions, savePstoChainException, searchPstoExceptionJoints } from '@/server/psto-chain-exceptions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { journalReadErrorMessage } from '@/lib/journal-read-error'
import { PstoProgramGrid, PstoProgramStatus } from './psto-program-grid'
import { Button } from './ui/button'
import { DialogRowPagination } from './dialog-row-pagination'
import { PstoStageCorrectionChoice } from './psto-weld-line-move-dialog'
import { useSpecialistTransferConfirmation } from './specialist-transfer-confirmation'

type Entry = Awaited<ReturnType<typeof listPstoChainExceptions>>['rows'][number]
type Candidate = Awaited<ReturnType<typeof searchPstoExceptionJoints>>['rows'][number]
const QUERY_KEY = ['psto-chain-exceptions']


export function PstoChainExceptions({ onBusyChange, onRunProtectedEdit, onRunProtectedDelete, onSaved }: {
  onBusyChange: (busy: boolean) => void
  onRunProtectedEdit: (label: string, action: () => void | Promise<void>) => void
  onRunProtectedDelete: (label: string, action: () => void | Promise<void>) => void
  onSaved: (rows: WeldRow[], message: string) => void
}) {
  const client = useQueryClient()
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(50)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false), [required, setRequired] = useState<boolean | null>(true)
  const [basis, setBasis] = useState(''), [transfers, setTransfers] = useState<Set<number>>(new Set())
  const [emptyEntry, setEmptyEntry] = useState<Entry | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const request = { page, pageSize, filters }
  const queryOptions = { staleTime: 10_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const
  const list = useQuery({ ...queryOptions, queryKey: [...QUERY_KEY, 'list', request],
    queryFn: ({ signal }) => listPstoChainExceptions({ signal, data: request }), enabled: !adding && !previewOpen })
  const candidates = useQuery({ ...queryOptions, queryKey: [...QUERY_KEY, 'candidates', request],
    queryFn: ({ signal }) => searchPstoExceptionJoints({ signal, data: request }), enabled: adding && !previewOpen })
  const current = adding ? candidates : list
  useEffect(() => { if (!current.isFetching && current.data && current.data.page !== page) setPage(current.data.page) }, [current.data, current.isFetching, page])
  const changeFilter = (field: string, value: string) => {
    setFilters(old => { const next = { ...old }; if (value) next[field] = value; else delete next[field]; return next }); setPage(0)
  }
  const preview = useMutation({ mutationFn: (data: { rowId: number; required: boolean | null | 'auto' }) => getPstoChainExceptionPreview({ data }),
    onSuccess: (result, request) => { setRequired(request.required === null ? null : result.required); setBasis(result.exception?.basis ?? ''); setTransfers(new Set()); setPreviewOpen(true) } })
  const resolve = useMutation({ mutationFn: async ({ entry, remove }: { entry: Entry; remove: boolean }) => {
    const rowId = await getPstoExceptionRowId({ data: entry.id })
    if (rowId === null) { setEmptyEntry(entry); return }
    const next = remove ? null : entry.required
    setRequired(next)
    await preview.mutateAsync({ rowId, required: next })
  } })
  const target = preview.data?.required ? 'beforeHeatTreatment' : 'primary'
  const effectiveTransfers = preview.data?.rows.filter(row => transfers.has(row.rowId) && !row.stageCorrection?.disabledReason && row.stageCorrection?.targetStage === target).map(row => row.rowId) ?? []
  const specialists = useSpecialistTransferConfirmation(effectiveTransfers, target)
  const save = useMutation({ mutationFn: (data: Parameters<typeof savePstoChainException>[0]['data']) => savePstoChainException({ data }),
    onSuccess: async rows => {
      scheduleWeldDataRefresh(client, { upsertRows: rows as WeldRow[] })
      await client.invalidateQueries({ queryKey: QUERY_KEY })
      await client.invalidateQueries({ queryKey: ['psto-line-assignments'] })
      onSaved(rows as WeldRow[], required === null ? 'Исключение снято для всей цепочки.' : 'Исключение ПСТО сохранено для всей цепочки.')
      preview.reset(); setPreviewOpen(false); setAdding(false); setFilters({}); setPage(0)
    } })
  const closeEmpty = useMutation({ mutationFn: (id: number) => closeEmptyPstoChainException({ data: id }),
    onSuccess: async () => { setEmptyEntry(null); await client.invalidateQueries({ queryKey: QUERY_KEY }); await client.invalidateQueries({ queryKey: ['psto-line-assignments'] }) } })
  const busy = save.isPending || resolve.isPending || preview.isPending || closeEmpty.isPending
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])
  const openCandidate = (row: Candidate) => { save.reset(); preview.mutate({ rowId: row.id, required: 'auto' }) }
  const columns = useMemo<ColDef<Entry>[]>(() => [
    { headerName: 'Проект', field: 'projectTitle', initialWidth: 140, tooltipField: 'projectTitle' }, { headerName: 'Шифр', field: 'subtitleCode', initialWidth: 120 },
    { headerName: 'Линия', field: 'line', initialWidth: 110 },
    { headerName: 'ПСТО линии', field: 'linePsto', initialWidth: 145, cellRenderer: PstoProgramStatus },
    { headerName: 'Цепочка', field: 'rootJoint', initialWidth: 120, valueFormatter: ({ value }) => String(value ?? '').toUpperCase() },
    { headerName: 'ПСТО цепочки', field: 'required', initialWidth: 155, cellRenderer: ({ value }: ICellRendererParams<Entry>) => <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${value ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{value ? 'Да' : 'Нет'}</span> },
    { headerName: 'Основание', field: 'basis', initialFlex: 1, minWidth: 180, tooltipField: 'basis' },
    { headerName: 'Действия', colId: 'actions', filter: false, initialPinned: 'right', initialWidth: 225, cellRenderer: ({ data }: ICellRendererParams<Entry>) => data ? <div className="flex h-full items-center gap-1">
      <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" disabled={busy} onClick={() => { save.reset(); resolve.mutate({ entry: data, remove: false }) }}><Pencil className="h-3.5 w-3.5" />Изменить</Button>
      <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" aria-label="Убрать исключение" title="Убрать исключение" disabled={busy} onClick={() => { save.reset(); resolve.mutate({ entry: data, remove: true }) }}><Undo2 className="h-3.5 w-3.5" />Убрать</Button>
    </div> : null },
  ], [busy])
  const candidateColumns = useMemo<ColDef<Candidate>[]>(() => [
    { headerName: 'Проект', field: 'projectTitle', initialFlex: 1 }, { headerName: 'Шифр', field: 'subtitleCode', initialFlex: 1 },
    { headerName: 'Линия', field: 'line', initialFlex: 1 },
    { headerName: 'ПСТО линии', field: 'linePsto', initialWidth: 145, cellRenderer: PstoProgramStatus }, { headerName: 'Стык', field: 'joint', initialFlex: 1 },
    { headerName: 'Действие', colId: 'actions', filter: false, initialPinned: 'right', initialWidth: 190, cellRenderer: ({ data }: ICellRendererParams<Candidate>) => data ? <Button size="sm" className="h-7 px-2 text-xs" variant="ghost" disabled={busy || current.isFetching} onClick={() => openCandidate(data)}>Выбрать цепочку<ArrowRight className="h-3.5 w-3.5" /></Button> : null },
  ], [busy, current.isFetching])
  const error = save.error ?? preview.error ?? resolve.error ?? closeEmpty.error ?? (adding ? candidates.error : list.error)
  const submit = () => {
    const data = preview.data
    if (!data || busy || !specialists.ready) return
    const run = required === null ? onRunProtectedDelete : onRunProtectedEdit
    run(required === null ? 'снятие исключения ПСТО со всей цепочки' : 'изменение назначения ПСТО всей цепочки', async () => {
      await save.mutateAsync({ rowId: data.rowId, required, basis, expectedExceptionId: data.exception?.id ?? null,
        expectedProgramState: data.programState, expectedVersions: data.expectedVersions,
        decisions: effectiveTransfers.map(rowId => ({ rowId, disposition: target === 'primary' ? 'movePreHeatTreatmentToPrimary' : 'movePrimaryToPreHeatTreatment',
          ...(specialists.confirmation ? { specialistTransferConfirmation: specialists.confirmation } : {}) })),
      })
    })
  }
  const correctionRows = preview.data?.rows.filter(row => row.stageCorrection) ?? []
  const resetPreview = () => { preview.reset(); setPreviewOpen(false); save.reset(); resolve.reset() }
  const changeList = (nextAdding: boolean) => { resetPreview(); setEmptyEntry(null); setAdding(nextAdding); setFilters({}); setPage(0) }
  const total = current.data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  return <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sky-100 bg-sky-50/50 px-5">
      {(previewOpen || adding) && <Button size="sm" variant="ghost" disabled={busy} onClick={previewOpen ? resetPreview : () => changeList(false)}><ArrowLeft className="h-4 w-4" />Назад</Button>}
      <span className="text-sm font-semibold text-slate-800">{previewOpen ? 'Назначение цепочки' : adding ? 'Выбор цепочки' : 'Действующие исключения'}</span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {!previewOpen && <Button size="sm" variant="ghost" disabled={!Object.keys(filters).length} onClick={() => { setFilters({}); setPage(0) }}>Сбросить фильтры</Button>}
        {!adding && !previewOpen && <Button size="sm" disabled={busy} onClick={() => changeList(true)}><Plus className="h-4 w-4" />Добавить исключение</Button>}
      </div>
    </div>
    {error && <p role="alert" className="mx-5 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{journalReadErrorMessage(error)}{current.isError && <button type="button" className="ml-2 underline" onClick={() => { void current.refetch() }}>Повторить</button>}</p>}
    {emptyEntry && <div className="mx-5 mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium text-slate-800">{emptyEntry.line} · цепочка {emptyEntry.rootJoint.toUpperCase()}</p>
      <p className="mt-1 text-slate-500">Стыки удалены, исключение сохранено. {emptyEntry.basis}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} variant="destructive" onClick={() => onRunProtectedDelete('снятие исключения ПСТО для удалённой цепочки', async () => { await closeEmpty.mutateAsync(emptyEntry.id) })}>Убрать сохранённое исключение</Button><Button size="sm" disabled={busy} variant="outline" onClick={() => setEmptyEntry(null)}>Оставить</Button></div>
    </div>}
    {preview.isPending ? <div role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Проверяем цепочку…</div> : preview.data && previewOpen ? <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">{[preview.data.identity.projectTitle, preview.data.identity.subtitleCode, preview.data.identity.line].filter(Boolean).join(' · ')}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><strong className="text-base text-slate-900">Цепочка {preview.data.rootJoint.toUpperCase()}</strong><span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">Стыков: {preview.data.rowCount}</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-4 px-4 py-4 text-sm">
            <div><p className="text-xs text-slate-500">Программа линии</p><p className="mt-1 font-medium text-slate-700">ПСТО {preview.data.programState === 'assigned' ? 'да' : 'нет'}</p></div>
            <ArrowRight className="h-4 w-4 text-slate-400" />
            <div><p className="text-xs text-slate-500">{required === null ? 'После снятия исключения' : 'Исключение для всей цепочки'}</p><p className="mt-1 font-semibold text-sky-700">ПСТО {preview.data.required ? 'да' : 'нет'}</p></div>
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">Решение применяется ко всей цепочке, включая неофициальные записи и будущие звенья. Данные ПСТО, ТВМТ и документы сохраняются.</p>
        </div>
        {required !== null && <label className="mt-4 block text-sm font-medium text-slate-700">Основание исключения
          <textarea className="mt-2 block min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100" aria-label="Основание исключения" placeholder="Техническая причина или реквизиты решения" maxLength={2000} value={basis} onChange={e => setBasis(e.target.value)} disabled={busy} />
        </label>}
        {correctionRows.length > 0 && <details className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">Этапы записанного НК · {correctionRows.length}</summary>
          <p className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">По умолчанию этапы сохраняются. Откройте этот раздел, если нужно перенести уже записанный комплект НК.</p>
          <div className="divide-y divide-slate-100">{correctionRows.map(row => <div key={row.rowId} className="px-4 py-3 text-sm"><strong className="text-slate-800">{row.joint}</strong>
            <PstoStageCorrectionChoice row={row} moveSelected={transfers.has(row.rowId)} disabled={busy} onChange={move => setTransfers(old => { const next = new Set(old); if (move) next.add(row.rowId); else next.delete(row.rowId); return next })} />
          </div>)}</div>
        </details>}
        {specialists.notice}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
        <Button variant="outline" disabled={busy} onClick={resetPreview}>Отмена</Button>
        <Button variant={required === null ? 'destructive' : 'default'} disabled={busy || !specialists.ready || (required !== null && !basis.trim())} onClick={submit}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : required === null ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}{required === null ? 'Убрать исключение' : 'Сохранить исключение'}
        </Button>
      </div>
    </> : <>
      {adding && <p className="px-5 pt-3 text-xs text-slate-500">Выберите любое звено цепочки. Найти его можно через фильтры в заголовках столбцов.</p>}
      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 [&_.read-only-grid]:h-full [&_.read-only-grid]:min-h-0">

          {adding ? <PstoProgramGrid<Candidate> key="candidates" label="Выбор цепочки для исключения ПСТО" rowData={candidates.data?.rows ?? []} columnDefs={candidateColumns} loading={candidates.isFetching} getRowId={p => String(p.data.id)}
            filters={filters} onFilterChange={changeFilter} candidates /> :
            <PstoProgramGrid<Entry> key="exceptions" label="Исключения ПСТО" rowData={list.data?.rows ?? []} columnDefs={columns} loading={list.isFetching} getRowId={p => String(p.data.id)}
              filters={filters} onFilterChange={changeFilter} />}

      </div>
      <DialogRowPagination totalCount={total} firstItemNumber={total ? page * pageSize + 1 : 0} lastItemNumber={Math.min((page + 1) * pageSize, total)}
        page={page + 1} pageCount={pageCount} pageSize={pageSize} itemLabel={adding ? 'стыков' : 'исключений'}
        onPreviousPage={() => setPage(p => Math.max(0, p - 1))} onNextPage={() => setPage(p => Math.min(pageCount - 1, p + 1))} onPageSizeChange={size => { setPageSize(size); setPage(0) }} />

    </>}
  </div>
}
