import { getPstoProgramState } from '@/lib/psto-chain-policy'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { PstoProgramGrid, PstoProgramStatus } from './psto-program-grid'
import { PSTO_PROGRAM_LABELS } from '@/lib/psto-line-assignment'
import { journalReadErrorMessage } from '@/lib/journal-read-error'
import { tracePstoProgram } from '@/lib/psto-program-diagnostics'
import { PstoProgramDiagnostics } from './psto-program-diagnostic-boundary'
import { PstoChainExceptions } from './psto-chain-exceptions'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleSlash2,
  ListChecks,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { PstoStageCorrectionChoice } from '@/components/psto-weld-line-move-dialog'
import { useSpecialistTransferConfirmation } from './specialist-transfer-confirmation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateInputValue } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  type PstoLineAssignmentSummary,
  type PstoLineIdentity,
  type PstoLineRemovalPreview,
} from '@/lib/psto-line-assignment'
import { usePagePagination } from '@/lib/use-page-pagination'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import {
  getPstoLineRemovalPreview,
  listPstoLineAssignmentPage,
  savePstoLineAssignment,
} from '@/server/psto-line-assignment'

export const PSTO_LINE_ASSIGNMENTS_QUERY_KEY = ['psto-line-assignments'] as const

type PstoLineProgramView =
  | { type: 'list' }
  | { type: 'assign'; line: PstoLineAssignmentSummary }
  | { type: 'reactivate'; line: PstoLineAssignmentSummary }
  | { type: 'remove'; line: PstoLineAssignmentSummary }
  | { type: 'cancel'; line: PstoLineAssignmentSummary }

export type PstoLineProgramDialogProps = {
  open: boolean
  onClose: () => void
  onRunProtectedEdit: (actionLabel: string, action: () => void | Promise<void>) => void
  onRunProtectedDelete: (actionLabel: string, action: () => void | Promise<void>) => void
  onSaved: (rows: WeldRow[], message: string) => void
}

export function PstoLineProgramDialog({
  open,
  onClose,
  onRunProtectedEdit,
  onRunProtectedDelete,
  onSaved,
}: PstoLineProgramDialogProps) {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [exceptionsBusy, setExceptionsBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [view, setView] = useState<PstoLineProgramView>({ type: 'list' })
  const [cancellationDate, setCancellationDate] = useState(() => formatDateInputValue(new Date()))
  const [cancellationBasis, setCancellationBasis] = useState('')
  const [transferRowIds, setTransferRowIds] = useState<Set<number>>(() => new Set())
  const linesQuery = useQuery({
    queryKey: [...PSTO_LINE_ASSIGNMENTS_QUERY_KEY, { filters, page, pageSize }],
    queryFn: async ({ signal }) => {
      tracePstoProgram('query-start')
      try {
        const result = await listPstoLineAssignmentPage({ signal, data: { filters, page, pageSize } })
        tracePstoProgram('query-ready')
        return result
      } catch (error) { tracePstoProgram('query-error', error); throw error }
    },
    enabled: open && !exceptionsOpen && view.type === 'list',
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const lineResultsTransitioning = linesQuery.isPlaceholderData
  const previewMutation = useMutation({
    mutationFn: (identity: PstoLineIdentity) => getPstoLineRemovalPreview({ data: identity }),
  })
  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof savePstoLineAssignment>[0]['data']) =>
      savePstoLineAssignment({ data: payload }),
    onSuccess: async (savedRows, payload) => {
      const rows = savedRows as WeldRow[]
      scheduleWeldDataRefresh(queryClient, { upsertRows: rows })
      await queryClient.invalidateQueries({ queryKey: PSTO_LINE_ASSIGNMENTS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: ['psto-chain-exceptions'] })
      onSaved(
        rows,
        payload.action === 'assign'
          ? `ПСТО назначена на всю линию · стыков: ${rows.length}`
          : payload.action === 'reactivate'
            ? `Программа ПСТО возобновлена · стыков: ${rows.length}`
            : payload.action === 'cancel'
              ? `ПСТО официально отменена для линии · стыков: ${rows.length}`
              : `Ошибочное назначение ПСТО удалено · стыков: ${rows.length}`,
      )
      setView({ type: 'list' })
      setCancellationDate(formatDateInputValue(new Date()))
      setCancellationBasis('')
      setTransferRowIds(new Set())
      previewMutation.reset()
    },
    onError: (error) => onSaved([], (error as Error).message),
  })

  useEffect(() => {
    if (!open) return
    tracePstoProgram('mounted')
    setFilters({})
    setExceptionsOpen(false)
    setPage(1)
    setPageSize(25)
    setView({ type: 'list' })
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setTransferRowIds(new Set())
    previewMutation.reset()
    saveMutation.reset()
  }, [open])

  useEffect(() => {
    const serverPage = linesQuery.data?.page
    if (!linesQuery.isPlaceholderData && serverPage && serverPage !== page) setPage(serverPage)
  }, [linesQuery.data?.page, linesQuery.isPlaceholderData, page])

  const transferTarget = view.type === 'cancel' ? 'primary' : 'beforeHeatTreatment'
  const effectiveTransfers = open && view.type !== 'list' && view.type !== 'remove'
    ? (previewMutation.data?.rows ?? []).filter(row => transferRowIds.has(row.rowId) && row.stageCorrection?.targetStage === transferTarget && !row.stageCorrection.disabledReason).map(row => row.rowId) : []
  const specialists = useSpecialistTransferConfirmation(effectiveTransfers, transferTarget)
  const effectiveTransferSet = new Set(effectiveTransfers)
  const onTransferChange = (rowId: number, move: boolean) => setTransferRowIds(current => {
    const next = new Set(current); if (move) next.add(rowId); else next.delete(rowId); return next
  })

  if (!open) return null

  const closeDisabled = previewMutation.isPending || saveMutation.isPending || exceptionsBusy
  const handleClose = () => {
    if (!closeDisabled) onClose()
  }
  const goBack = () => {
    if (closeDisabled) return
    setView({ type: 'list' })
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setTransferRowIds(new Set())
    previewMutation.reset()
    saveMutation.reset()
  }
  const openAssign = (line: PstoLineAssignmentSummary) => {
    setTransferRowIds(new Set())
    previewMutation.reset()
    setView({ type: 'assign', line })
    previewMutation.mutate(toIdentity(line))
  }
  const openReactivate = (line: PstoLineAssignmentSummary) => {
    setTransferRowIds(new Set())
    previewMutation.reset()
    setView({ type: 'reactivate', line })
    previewMutation.mutate(toIdentity(line))
  }
  const openRemove = (line: PstoLineAssignmentSummary, action: 'remove' | 'cancel') => {
    setTransferRowIds(new Set())
    previewMutation.reset()
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setView({ type: action, line })
    previewMutation.mutate(toIdentity(line))
  }
  const submitAssignment = () => {
    if (
      (view.type !== 'assign' && view.type !== 'reactivate') ||
      saveMutation.isPending ||
      previewMutation.isPending || previewMutation.isError ||
      !previewMutation.data || !specialists.ready
    ) return
    const reactivating = view.type === 'reactivate'
    const activationDecisions = previewMutation.data.rows
      .filter(row => row.stageCorrection?.targetStage === 'beforeHeatTreatment')
      .map(row => ({
        rowId: row.rowId,
        disposition: transferRowIds.has(row.rowId) && !row.stageCorrection?.disabledReason
          ? 'movePrimaryToPreHeatTreatment' as const : 'keepPrimary' as const,
        ...(specialists.confirmation ? { specialistTransferConfirmation: specialists.confirmation } : {}),
      }))
    onRunProtectedEdit(reactivating ? 'возобновление программы ПСТО' : 'назначение ПСТО на всю линию', async () => {
      await saveMutation.mutateAsync({
        identity: toIdentity(view.line),
        action: reactivating ? 'reactivate' : 'assign',
        expectedVersions: previewMutation.data.expectedVersions,
        ...(activationDecisions.length > 0 ? { activationDecisions } : {}),
      })
    })
  }
  const submitRemoval = () => {
    if ((view.type !== 'remove' && view.type !== 'cancel') || !previewMutation.data || saveMutation.isPending || !specialists.ready) return
    const cancelling = view.type === 'cancel'
    if (cancelling !== (previewMutation.data.historyRowCount > 0)) return
    onRunProtectedDelete(cancelling ? 'официальная отмена ПСТО на линии' : 'удаление ошибочного назначения ПСТО', async () => {
      await saveMutation.mutateAsync({
        identity: toIdentity(view.line),
        action: cancelling ? 'cancel' : 'remove',
        expectedVersions: previewMutation.data.expectedVersions,
        cancellationDate: cancelling ? cancellationDate : undefined,
        cancellationBasis: cancelling ? cancellationBasis : undefined,
        ...(cancelling ? { activationDecisions: previewMutation.data.rows.filter(row => row.stageCorrection?.targetStage === 'primary').map(row => ({
          rowId: row.rowId, disposition: effectiveTransferSet.has(row.rowId) ? 'movePreHeatTreatmentToPrimary' as const : 'keepPrimary' as const,
          ...(specialists.confirmation ? { specialistTransferConfirmation: specialists.confirmation } : {}),
        })) } : {}),
      })
    })
  }

  return (
    <LargeDialogShell maxWidthClassName="max-w-[1380px]" maxHeightClassName="h-[92vh]">
      <DialogHeader
        title={view.type === 'list'
          ? 'Программа ПСТО'
          : view.type === 'assign'
            ? 'Назначение ПСТО'
            : view.type === 'reactivate'
              ? 'Возобновление ПСТО'
              : view.type === 'cancel'
                ? 'Отмена ПСТО'
                : 'Снятие назначения ПСТО'}
        subtitle={view.type === 'list'
          ? 'Программа линии и индивидуальные исключения для цепочек стыков.'
          : <LineIdentityText line={view.line} />}
        actions={view.type !== 'list' ? (
          <Button variant="outline" size="sm" onClick={goBack} disabled={closeDisabled}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>
        ) : undefined}
        onClose={handleClose}
      />

      {specialists.notice}
      {linesQuery.isError ? <PstoProgramDiagnostics /> : null}
      {view.type === 'list' && <nav aria-label="Разделы программы ПСТО" className="flex h-14 shrink-0 items-center gap-1 border-b border-sky-100 bg-sky-50/70 px-5">
        {([false, true] as const).map(exceptions => <button key={String(exceptions)} type="button" disabled={closeDisabled} aria-pressed={exceptionsOpen === exceptions}
          className={`h-9 rounded-md px-4 text-sm font-medium ${exceptionsOpen === exceptions ? 'bg-white text-sky-800 shadow-sm ring-1 ring-sky-100' : 'text-slate-600 hover:bg-white/70'}`}
          onClick={() => setExceptionsOpen(exceptions)}>{exceptions ? 'Исключения' : 'Линии'}</button>)}
      </nav>}
      {view.type === 'list' && exceptionsOpen ? <PstoChainExceptions onBusyChange={setExceptionsBusy}
        onRunProtectedEdit={onRunProtectedEdit} onRunProtectedDelete={onRunProtectedDelete} onSaved={onSaved} /> : view.type === 'list' ? (
        <LineListView
          lines={linesQuery.data?.rows ?? []} totalCount={linesQuery.data?.totalCount ?? 0}
          page={linesQuery.data?.page ?? page} pageCount={linesQuery.data?.pageCount ?? 1} pageSize={pageSize}
          loading={linesQuery.isFetching || lineResultsTransitioning}
          error={linesQuery.error ? journalReadErrorMessage(linesQuery.error) : ''}
          filters={filters} onFilterChange={(field, value) => { setFilters(old => { const next = { ...old }; if (value) next[field] = value; else delete next[field]; return next }); setPage(1) }}
          onResetFilters={() => { setFilters({}); setPage(1) }}
          onPreviousPage={() => setPage(current => Math.max(1, current - 1))}
          onNextPage={() => setPage(current => Math.min(linesQuery.data?.pageCount ?? current, current + 1))}
          onPageSizeChange={value => { setPageSize(value); setPage(1) }} onRefresh={() => void linesQuery.refetch()}
          onAssign={openAssign} onReactivate={openReactivate} onRemove={line => openRemove(line, 'remove')} onCancelPsto={line => openRemove(line, 'cancel')}
        />
      ) : view.type === 'assign' || view.type === 'reactivate' ? (
        <AssignmentView
          line={view.line}
          reactivating={view.type === 'reactivate'}
          preview={previewMutation.data ?? null}
          previewLoading={previewMutation.isPending}
          previewError={(previewMutation.error as Error | null)?.message ?? ''}
          pending={saveMutation.isPending}
          transferBlocked={!specialists.ready}
          error={(saveMutation.error as Error | null)?.message ?? ''}
          transferRowIds={transferRowIds}
          onTransferChange={onTransferChange}
          onRetry={() => {
            setTransferRowIds(new Set())
            previewMutation.mutate(toIdentity(view.line))
          }}
          onCancel={goBack}
          onSubmit={submitAssignment}
        />
      ) : (
        <RemovalView
          preview={previewMutation.data ?? null}
          loading={previewMutation.isPending}
          previewError={(previewMutation.error as Error | null)?.message ?? ''}
          saveError={(saveMutation.error as Error | null)?.message ?? ''}
          pending={saveMutation.isPending}
          officialCancellation={view.type === 'cancel'}
          transferRowIds={transferRowIds}
          onTransferChange={onTransferChange}
          transferBlocked={!specialists.ready}
          cancellationDate={cancellationDate}
          cancellationBasis={cancellationBasis}
          onCancellationDateChange={setCancellationDate}
          onCancellationBasisChange={setCancellationBasis}
          onUseCurrentAction={() => setView({
            type: (previewMutation.data?.historyRowCount ?? 0) > 0 ? 'cancel' : 'remove',
            line: view.line,
          })}
          onRetry={() => previewMutation.mutate(toIdentity(view.line))}
          onCancel={goBack}
          onSubmit={submitRemoval}
        />
      )}
    </LargeDialogShell>
  )
}

type LineActions = {
  loading: boolean
  onAssign: (line: PstoLineAssignmentSummary) => void
  onReactivate: (line: PstoLineAssignmentSummary) => void
  onRemove: (line: PstoLineAssignmentSummary) => void
  onCancelPsto: (line: PstoLineAssignmentSummary) => void
}
const LineActionsContext = createContext<LineActions | null>(null)

function LineActionCell({ data }: ICellRendererParams<PstoLineAssignmentSummary>) {
  const { loading, onAssign, onReactivate, onRemove, onCancelPsto } = useContext(LineActionsContext)!
  if (!data) return null
  const state = getPstoProgramState(data), hasHistory = (data.removalHistoryRowCount ?? data.historyRowCount) > 0
  return <div className="flex h-full items-center gap-1">
    {state === 'assigned' ? <>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={loading || hasHistory} title={hasHistory ? 'Уже есть данные ПСТО, ТВМТ или НК до ТО — используйте отмену.' : 'Снять ошибочное назначение без оформления отмены.'} onClick={() => onRemove(data)}>Снять назначение</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={loading || !hasHistory} title={hasHistory ? 'Изменить решение с сохранением документов и результатов.' : 'Работы ещё не начаты — используйте снятие назначения.'} onClick={() => onCancelPsto(data)}>Отменить ПСТО</Button>
    </> : <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-sky-700" disabled={loading} onClick={() => state === 'cancelled' ? onReactivate(data) : onAssign(data)}>{state === 'cancelled' ? 'Возобновить' : state === 'mixed' ? 'На всю линию' : 'Назначить'}</Button>}
  </div>
}

function LineListView({ lines, totalCount, page, pageCount, pageSize, loading, error, filters, onFilterChange, onResetFilters,
  onPreviousPage, onNextPage, onPageSizeChange, onRefresh, onAssign, onReactivate, onRemove, onCancelPsto,
}: {
  lines: PstoLineAssignmentSummary[]; totalCount: number; page: number; pageCount: number; pageSize: number; loading: boolean; error: string
  filters: Record<string, string>; onFilterChange: (field: string, value: string) => void; onResetFilters: () => void
  onPreviousPage: () => void; onNextPage: () => void; onPageSizeChange: (value: number) => void; onRefresh: () => void
  onAssign: (line: PstoLineAssignmentSummary) => void; onReactivate: (line: PstoLineAssignmentSummary) => void
  onRemove: (line: PstoLineAssignmentSummary) => void; onCancelPsto: (line: PstoLineAssignmentSummary) => void
}) {
  const columns = useMemo<ColDef<PstoLineAssignmentSummary>[]>(() => [
    { headerName: 'Проект', field: 'projectTitle', initialFlex: 1, minWidth: 160 },
    { headerName: 'Шифр', field: 'subtitleCode', initialWidth: 150 },
    { headerName: 'Линия', field: 'line', initialWidth: 130 },
    { headerName: 'ПСТО линии', field: 'programState', initialWidth: 155, cellRenderer: ({ data }: ICellRendererParams<PstoLineAssignmentSummary>) => {
      if (!data) return null
      const state = getPstoProgramState(data)
      return <PstoProgramStatus value={PSTO_PROGRAM_LABELS[state]} />
    } },
    { headerName: 'Стыков', field: 'rowCount', initialWidth: 110 },
    { headerName: 'Исключений', field: 'exceptionCount', initialWidth: 140 },
    { headerName: 'Действия', colId: 'actions', filter: false, initialPinned: 'right', initialWidth: 300, cellRenderer: LineActionCell },
  ], [])
  return <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sky-100 bg-sky-50/50 px-5">
      <span className="text-sm font-semibold text-slate-800">Назначение ПСТО по линиям</span>
      <Button size="sm" variant="ghost" className="ml-auto" disabled={!Object.keys(filters).length} onClick={onResetFilters}>Сбросить фильтры</Button>
    </div>
    {error && <div role="alert" className="mx-5 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}<Button variant="outline" size="sm" className="ml-3" onClick={onRefresh} aria-label="Обновить список линий">Повторить</Button></div>}
    <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 [&_.read-only-grid]:h-full [&_.read-only-grid]:min-h-0">
      <LineActionsContext.Provider value={{ loading, onAssign, onReactivate, onRemove, onCancelPsto }}>
        <PstoProgramGrid<PstoLineAssignmentSummary> label="Линии программы ПСТО" lines filters={filters} onFilterChange={onFilterChange}
          rowData={lines} columnDefs={columns} loading={loading} getRowId={p => p.data.key} />
      </LineActionsContext.Provider>
    </div>
    <DialogRowPagination totalCount={totalCount} firstItemNumber={totalCount ? (page - 1) * pageSize + 1 : 0}
      lastItemNumber={Math.min(page * pageSize, totalCount)} page={page} pageCount={pageCount} pageSize={pageSize}
      onPreviousPage={onPreviousPage} onNextPage={onNextPage} onPageSizeChange={onPageSizeChange} itemLabel="линий" />
  </div>
}

function AssignmentView({
  line, reactivating, preview, previewLoading, previewError, pending, error, onRetry, onCancel, onSubmit,
  transferRowIds, onTransferChange, transferBlocked,
}: {
  line: PstoLineAssignmentSummary
  reactivating: boolean
  preview: PstoLineRemovalPreview | null
  previewLoading: boolean
  previewError: string
  pending: boolean
  error: string
  transferRowIds: ReadonlySet<number>
  transferBlocked: boolean
  onTransferChange: (rowId: number, move: boolean) => void
  onRetry: () => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const submitDisabled = pending || previewLoading || !preview || Boolean(previewError) || transferBlocked
  const correctionRows = (preview?.rows ?? []).filter(row => row.stageCorrection?.targetStage === 'beforeHeatTreatment')
  const pagination = usePagePagination({ items: correctionRows, defaultPageSize: 25, resetKeys: [preview] })
  const transferCount = correctionRows.filter(row => transferRowIds.has(row.rowId) && !row.stageCorrection?.disabledReason).length
  return <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <section className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
          <SummaryCell label="Стыков на линии" value={line.rowCount} />
          <SummaryCell label="Сейчас с ПСТО" value={line.assignedCount} />
          <SummaryCell label="Будет с ПСТО" value={line.rowCount} tone="sky" />
        </section>
        <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
          <ListChecks aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-sky-600" />
          <div>
            <p className="font-semibold">{reactivating ? 'Возобновление ПСТО' : 'Назначение ПСТО всей линии'}</p>
            <p>Назначение охватит всю линию. Стыков: {line.rowCount}.</p>
            <p>По умолчанию уже внесённый НК остаётся на своём этапе. Для стыков с основным НК ниже можно выбрать перенос всего комплекта в НК до ТО.</p>
            <p className="mt-1">Основной НК не заменяет НК до ТО. Требования к новым работам проверяются по настройкам проекта.</p>
            {reactivating ? <p className="mt-1">Дата и основание отмены очистятся. Сохранённые работы учитываются, повторно вводить их не нужно.</p> : null}
          </div>
        </div>
        {previewLoading ? <p role="status" className="flex items-center gap-2 rounded-lg bg-white p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Проверяем актуальный состав линии…</p>
          : previewError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{previewError}</p><Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Повторить проверку</Button></div>
          : preview ? <>
            <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4 shrink-0" />Проверено стыков: {preview.rowCount}. Перенести в НК до ТО: {transferCount} · сохранить этапы: {preview.rowCount - transferCount}.</p>
            {correctionRows.length > 0 ? <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Что сделать с основным НК</h3>
                <p className="mt-1 text-xs leading-5 text-slate-600">Выбор для каждого стыка. Переносится весь комплект: все методы, заявки, результаты и заключения вместе, с исходными датами и названиями. НК до ТО должен быть пустым; проверяются хронология и зависимости заявки ПСТО. Причина запрета показана у варианта переноса.</p>
              </div>
              <div className="divide-y divide-slate-100">
                {pagination.pageItems.map(row => <div key={row.rowId} className="px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{row.joint || `#${row.rowId}`}</p>
                  <p className="mt-1 text-xs text-slate-500">Спул: {row.spool || '—'} · Основной НК: <MethodList methods={row.primaryMethods} /></p>
                  <PstoStageCorrectionChoice row={row} moveSelected={transferRowIds.has(row.rowId) && !row.stageCorrection?.disabledReason} disabled={pending} onChange={move => onTransferChange(row.rowId, move)} />
                </div>)}
              </div>
              <DialogRowPagination totalCount={pagination.totalCount} firstItemNumber={pagination.firstItemNumber} lastItemNumber={pagination.lastItemNumber}
                page={pagination.page} pageCount={pagination.pageCount} pageSize={pagination.pageSize}
                onPreviousPage={pagination.goToPreviousPage} onNextPage={pagination.goToNextPage} onPageSizeChange={pagination.setPageSize} />
            </section> : null}
          </> : null}
        {error ? <p role="alert" className="text-sm font-medium text-rose-700">{error}</p> : null}
      </div>
    </div>
    <div className="flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
      <Button variant="outline" onClick={onCancel} disabled={pending}>Отмена</Button>
      <Button onClick={onSubmit} disabled={submitDisabled}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
        {reactivating ? 'Возобновить ПСТО' : 'Назначить ПСТО'}
      </Button>
    </div>
  </div>
}

function RemovalView({
  preview,
  loading,
  previewError,
  saveError,
  pending,
  officialCancellation,
  cancellationDate,
  cancellationBasis,
  onCancellationDateChange,
  onCancellationBasisChange,
  onUseCurrentAction,
  onRetry,
  onCancel,
  onSubmit,
  transferRowIds, onTransferChange, transferBlocked,
}: {
  preview: PstoLineRemovalPreview | null
  loading: boolean
  previewError: string
  saveError: string
  pending: boolean
  officialCancellation: boolean
  cancellationDate: string
  cancellationBasis: string
  onCancellationDateChange: (value: string) => void
  onCancellationBasisChange: (value: string) => void
  onUseCurrentAction: () => void
  onRetry: () => void
  onCancel: () => void
  onSubmit: () => void
  transferRowIds: ReadonlySet<number>
  onTransferChange: (rowId: number, move: boolean) => void
  transferBlocked: boolean
}) {
  const rows = preview?.rows ?? []
  const pagination = usePagePagination({ items: rows, defaultPageSize: 25, resetKeys: [preview] })
  const actionOutdated = Boolean(preview && officialCancellation !== (preview.historyRowCount > 0))

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Проверяю документы и стыки линии...
        </div>
      ) : previewError ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Не удалось подготовить предпросмотр</p>
            <p className="mt-1">{previewError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Повторить
            </Button>
          </div>
        </div>
      ) : preview ? (
        <>
          <div className="border-b border-slate-200 bg-white px-5 py-4">
            <div className="grid overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryCell label="Стыков" value={preview.rowCount} />
              <SummaryCell label="Заявок ПСТО без результата" value={preview.requestOnlyCount} tone="amber" />
              <SummaryCell label="Результатов ПСТО" value={preview.completedPstoCount} />
              <SummaryCell label="Завершено НК до ТО" value={preview.completedPreControlCount} tone="sky" />
              <SummaryCell label="Заявок НК до ТО без результата" value={preview.pendingPreControlCount} tone="amber" />
              <SummaryCell label="Повторных циклов" value={preview.repeatCycleCount} />
            </div>
            {officialCancellation ? (
              <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[220px_minmax(280px,1fr)]">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-slate-700">Дата решения об отмене ПСТО <span className="text-rose-600">*</span></span>
                  <Input
                    type="date"
                    value={cancellationDate}
                    onChange={(event) => onCancellationDateChange(event.target.value)}
                    className="bg-white"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-slate-700">Основание отмены ПСТО</span>
                  <Input
                    value={cancellationBasis}
                    onChange={(event) => onCancellationBasisChange(event.target.value)}
                    placeholder="Необязательно: техническое решение, письмо или примечание"
                    className="bg-white"
                  />
                </label>
              </div>
            ) : null}
            {actionOutdated ? (
              <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>{preview.historyRowCount > 0
                  ? 'История линии изменилась: появились данные ПСТО, ТВМТ или НК до ТО. Удалить только назначение уже нельзя. Можно официально отменить ПСТО с сохранением всей истории.'
                  : 'История линии изменилась: данных ПСТО, ТВМТ и НК до ТО больше нет. Теперь можно удалить ошибочное назначение без официальной отмены.'}</p>
                <Button variant="outline" size="sm" onClick={onUseCurrentAction}>
                  {preview.historyRowCount > 0 ? 'Перейти к отмене ПСТО' : 'Перейти к снятию назначения'}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="grid min-w-[980px] grid-cols-[minmax(190px,0.75fr)_minmax(300px,1fr)_minmax(380px,1.35fr)] border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase text-slate-500">
                <span>Стык</span>
                <span>Сейчас</span>
                <span>После снятия ПСТО</span>
              </div>
              <div className="divide-y divide-slate-100">
                {pagination.pageItems.map((row) => (
                  <div key={row.rowId} className="grid min-w-[980px] grid-cols-[minmax(190px,0.75fr)_minmax(300px,1fr)_minmax(380px,1.35fr)] items-center px-4 py-3 text-sm">
                    <div className="min-w-0 pr-4">
                      <p className="truncate font-semibold text-slate-800">{row.joint || `#${row.rowId}`}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">Спул: {row.spool || '—'}</p>
                    </div>
                    <div className="min-w-0 space-y-1 pr-4 text-xs text-slate-600">
                      <p>Основной НК: <MethodList methods={row.primaryMethods} /></p>
                      <p>НК до ТО: <MethodList methods={row.completedPreMethods} /></p>
                      {row.pendingPreMethods.length > 0 ? (
                        <p className="text-amber-700">Без результата: <MethodList methods={row.pendingPreMethods} /></p>
                      ) : null}
                      {row.pstoRequest || row.pstoResult || row.repeatCycleCount > 0 ? (
                        <p>ПСТО: {row.pstoResult || (row.pstoRequest ? 'есть заявка' : '—')}{row.repeatCycleCount ? ` · повторов: ${row.repeatCycleCount}` : ''}</p>
                      ) : null}
                    </div>
                    <div>
                      {actionOutdated ? (
                        <p className="text-xs leading-5 text-amber-700">Ничего не изменится, пока не выбран актуальный способ снятия ПСТО.</p>
                      ) : officialCancellation ? (<>
                        <p className="text-xs leading-5 text-emerald-700">Назначение ПСТО будет отменено. По умолчанию этапы сохраняются. Если физическая ПСТО уже проведена, внесите фактическую ТВМТ; новый повтор не откроется.</p>
                        {row.stageCorrection?.targetStage === 'primary' ? <PstoStageCorrectionChoice row={row} moveSelected={transferRowIds.has(row.rowId) && !row.stageCorrection.disabledReason} disabled={pending} onChange={move => onTransferChange(row.rowId, move)} /> : null}
                      </>) : (
                        <p className="text-xs text-slate-500">Основной комплект НК не изменится.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogRowPagination
            totalCount={pagination.totalCount}
            firstItemNumber={pagination.firstItemNumber}
            lastItemNumber={pagination.lastItemNumber}
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            onPreviousPage={pagination.goToPreviousPage}
            onNextPage={pagination.goToNextPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </>
      ) : null}

      <div className="border-t border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-3xl items-start gap-3 text-sm leading-5 text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p>
              {actionOutdated
                ? 'Предпросмотр обнаружил изменение истории. Выберите предложенный способ снятия ПСТО либо вернитесь назад; документы автоматически не удаляются.'
                : officialCancellation
                ? `Отмена не удаляет историю. Перенос НК до ТО в основной выполняется только для явно выбранных стыков: ${rows.filter(row => transferRowIds.has(row.rowId) && row.stageCorrection?.targetStage === 'primary' && !row.stageCorrection.disabledReason).length}. Заявка или история ПСТО/ТВМТ запрещают перенос соответствующего стыка.`
                : 'У стыков, чьё назначение изменится, нет данных ПСТО, ТВМТ и НК до ТО. Будет снято ошибочное назначение; основной НК и индивидуальные исключения сохранятся.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onCancel} disabled={pending}>Отмена</Button>
            <Button
              variant="destructive"
              onClick={onSubmit}
              disabled={!preview || pending || actionOutdated || transferBlocked || (officialCancellation && !cancellationDate)}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleSlash2 className="mr-2 h-4 w-4" />}
              {officialCancellation ? 'Отменить ПСТО на линии' : 'Снять назначение'}
            </Button>
          </div>
        </div>
        {saveError ? <p className="mt-3 text-sm font-medium text-rose-700">{saveError}</p> : null}
      </div>
    </div>
  )
}

function SummaryCell({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'sky' | 'amber' }) {
  return (
    <div className="min-h-20 bg-white px-3 py-3">
      <p className="text-[11px] leading-4 text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${
        tone === 'sky' ? 'text-sky-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'
      }`}>{value}</p>
    </div>
  )
}

function MethodList({ methods }: { methods: readonly string[] }) {
  return <span className="font-medium text-slate-800">{methods.length > 0 ? methods.join(', ') : '—'}</span>
}

function LineIdentityText({ line }: { line: PstoLineIdentity }) {
  return <>{line.projectTitle || 'Без проекта'} · Шифр: {line.subtitleCode || '—'} · Линия: {line.line}</>
}

function toIdentity(line: PstoLineIdentity): PstoLineIdentity {
  return {
    projectTitle: line.projectTitle,
    subtitleCode: line.subtitleCode,
    line: line.line,
  }
}
