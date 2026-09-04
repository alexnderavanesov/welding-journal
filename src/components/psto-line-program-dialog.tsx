import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateInputValue } from '@/lib/date-format'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  type PstoLineAssignmentSummary,
  type PstoLineActivationDecision,
  type PstoLineActivationDisposition,
  type PstoLineIdentity,
  type PstoLineRemovalDecision,
  type PstoLineRemovalDisposition,
  type PstoLineRemovalPreview,
} from '@/lib/psto-line-assignment'
import { normalizeSearchText } from '@/lib/report-row-utils'
import { usePagePagination } from '@/lib/use-page-pagination'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import {
  getPstoLineRemovalPreview,
  listPstoLineAssignments,
  savePstoLineAssignment,
} from '@/server/psto-line-assignment'

export const PSTO_LINE_ASSIGNMENTS_QUERY_KEY = ['psto-line-assignments'] as const

type PstoLineFilter = 'all' | 'assigned' | 'cancelled' | 'unassigned' | 'partial'
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
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PstoLineFilter>('all')
  const [view, setView] = useState<PstoLineProgramView>({ type: 'list' })
  const [cancellationDate, setCancellationDate] = useState(() => formatDateInputValue(new Date()))
  const [cancellationBasis, setCancellationBasis] = useState('')
  const [decisions, setDecisions] = useState<Record<number, PstoLineRemovalDisposition>>({})
  const [activationDispositions, setActivationDispositions] =
    useState<Record<number, PstoLineActivationDisposition>>({})
  const linesQuery = useQuery({
    queryKey: PSTO_LINE_ASSIGNMENTS_QUERY_KEY,
    queryFn: () => listPstoLineAssignments(),
    enabled: open,
    staleTime: 10_000,
  })
  const previewMutation = useMutation({
    mutationFn: (identity: PstoLineIdentity) => getPstoLineRemovalPreview({ data: identity }),
  })
  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof savePstoLineAssignment>[0]['data']) =>
      savePstoLineAssignment({ data: payload }),
    onSuccess: async (savedRows, payload) => {
      const rows = savedRows as WeldRow[]
      await invalidateWeldJoints(queryClient, { upsertRows: rows })
      await queryClient.invalidateQueries({ queryKey: PSTO_LINE_ASSIGNMENTS_QUERY_KEY })
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
      setDecisions({})
      setActivationDispositions({})
      previewMutation.reset()
    },
    onError: (error) => onSaved([], (error as Error).message),
  })

  useEffect(() => {
    if (!open) return
    setSearch('')
    setFilter('all')
    setView({ type: 'list' })
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setDecisions({})
    setActivationDispositions({})
    previewMutation.reset()
    saveMutation.reset()
  }, [open])

  if (!open) return null

  const closeDisabled = previewMutation.isPending || saveMutation.isPending
  const handleClose = () => {
    if (!closeDisabled) onClose()
  }
  const goBack = () => {
    if (closeDisabled) return
    setView({ type: 'list' })
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setDecisions({})
    setActivationDispositions({})
    previewMutation.reset()
    saveMutation.reset()
  }
  const openAssign = (line: PstoLineAssignmentSummary) => {
    setActivationDispositions({})
    previewMutation.reset()
    setView({ type: 'assign', line })
    previewMutation.mutate(toIdentity(line))
  }
  const openReactivate = (line: PstoLineAssignmentSummary) => {
    setActivationDispositions({})
    previewMutation.reset()
    setView({ type: 'reactivate', line })
    previewMutation.mutate(toIdentity(line))
  }
  const openRemove = (line: PstoLineAssignmentSummary) => {
    setDecisions({})
    setCancellationDate(formatDateInputValue(new Date()))
    setCancellationBasis('')
    setView({ type: line.historyRowCount > 0 ? 'cancel' : 'remove', line })
    previewMutation.mutate(toIdentity(line))
  }
  const submitAssignment = () => {
    if (
      (view.type !== 'assign' && view.type !== 'reactivate') ||
      saveMutation.isPending ||
      !previewMutation.data
    ) return
    const reactivating = view.type === 'reactivate'
    const blockedRows = previewMutation.data.rows.filter((row) => row.blocksActivation)
    if (blockedRows.some((row) => {
      const disposition = activationDispositions[row.rowId]
      return !disposition || (
        disposition === 'movePrimaryToBeforeHeatTreatment' &&
        row.activationTransferBlockedMethods.length > 0
      )
    })) return
    const activationDecisions: PstoLineActivationDecision[] = blockedRows.map((row) => ({
      rowId: row.rowId,
      disposition: activationDispositions[row.rowId]!,
      methodCodes: row.primaryMethods,
    }))
    onRunProtectedEdit(reactivating ? 'возобновление программы ПСТО' : 'назначение ПСТО на всю линию', async () => {
      await saveMutation.mutateAsync({
        identity: toIdentity(view.line),
        action: reactivating ? 'reactivate' : 'assign',
        expectedVersions: previewMutation.data.expectedVersions,
        activationDecisions,
      })
    })
  }
  const submitRemoval = () => {
    if ((view.type !== 'remove' && view.type !== 'cancel') || !previewMutation.data || saveMutation.isPending) return
    const cancelling = view.type === 'cancel'
    const requiredRows = previewMutation.data.rows.filter(
      (row) => !row.preservesPerformedHistory && row.promotablePreMethods.length > 0,
    )
    if (requiredRows.some((row) => !decisions[row.rowId])) return
    const payloadDecisions: PstoLineRemovalDecision[] = requiredRows.map((row) => ({
      rowId: row.rowId,
      disposition: decisions[row.rowId],
    }))
    onRunProtectedDelete(cancelling ? 'официальная отмена ПСТО на линии' : 'удаление ошибочного назначения ПСТО', async () => {
      await saveMutation.mutateAsync({
        identity: toIdentity(view.line),
        action: cancelling ? 'cancel' : 'remove',
        expectedVersions: previewMutation.data.expectedVersions,
        cancellationDate: cancelling ? cancellationDate : undefined,
        cancellationBasis: cancelling ? cancellationBasis : undefined,
        decisions: payloadDecisions,
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
                : 'Удаление назначения ПСТО'}
        subtitle={view.type === 'list'
          ? 'Назначение ведется для всей линии целиком.'
          : <LineIdentityText line={view.line} />}
        actions={view.type !== 'list' ? (
          <Button variant="outline" size="sm" onClick={goBack} disabled={closeDisabled}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            К линиям
          </Button>
        ) : undefined}
        onClose={handleClose}
      />

      {view.type === 'list' ? (
        <LineListView
          lines={linesQuery.data ?? []}
          loading={linesQuery.isPending}
          error={(linesQuery.error as Error | null)?.message ?? ''}
          search={search}
          filter={filter}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onRefresh={() => void linesQuery.refetch()}
          onAssign={openAssign}
          onReactivate={openReactivate}
          onRemove={openRemove}
        />
      ) : view.type === 'assign' || view.type === 'reactivate' ? (
        <AssignmentView
          line={view.line}
          reactivating={view.type === 'reactivate'}
          preview={previewMutation.data ?? null}
          previewLoading={previewMutation.isPending}
          previewError={(previewMutation.error as Error | null)?.message ?? ''}
          activationDispositions={activationDispositions}
          pending={saveMutation.isPending}
          error={(saveMutation.error as Error | null)?.message ?? ''}
          onActivationDispositionsChange={setActivationDispositions}
          onRetry={() => {
            setActivationDispositions({})
            previewMutation.mutate(toIdentity(view.line))
          }}
          onCancel={goBack}
          onSubmit={submitAssignment}
        />
      ) : (
        <RemovalView
          line={view.line}
          preview={previewMutation.data ?? null}
          loading={previewMutation.isPending}
          previewError={(previewMutation.error as Error | null)?.message ?? ''}
          saveError={(saveMutation.error as Error | null)?.message ?? ''}
          pending={saveMutation.isPending}
          decisions={decisions}
          officialCancellation={view.type === 'cancel'}
          cancellationDate={cancellationDate}
          cancellationBasis={cancellationBasis}
          onCancellationDateChange={setCancellationDate}
          onCancellationBasisChange={setCancellationBasis}
          onDecisionChange={(rowId, disposition) => setDecisions((current) => ({
            ...current,
            [rowId]: disposition,
          }))}
          onSetAll={(disposition) => setDecisions(Object.fromEntries(
            (previewMutation.data?.rows ?? [])
              .filter((row) => !row.preservesPerformedHistory && row.promotablePreMethods.length > 0)
              .map((row) => [row.rowId, disposition]),
          ))}
          onRetry={() => previewMutation.mutate(toIdentity(view.line))}
          onCancel={goBack}
          onSubmit={submitRemoval}
        />
      )}
    </LargeDialogShell>
  )
}

function LineListView({
  lines,
  loading,
  error,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onRefresh,
  onAssign,
  onReactivate,
  onRemove,
}: {
  lines: PstoLineAssignmentSummary[]
  loading: boolean
  error: string
  search: string
  filter: PstoLineFilter
  onSearchChange: (value: string) => void
  onFilterChange: (value: PstoLineFilter) => void
  onRefresh: () => void
  onAssign: (line: PstoLineAssignmentSummary) => void
  onReactivate: (line: PstoLineAssignmentSummary) => void
  onRemove: (line: PstoLineAssignmentSummary) => void
}) {
  const counts = useMemo(() => ({
    all: lines.length,
    assigned: lines.filter((line) => line.assignedCount === line.rowCount).length,
    cancelled: lines.filter((line) => line.cancelledCount === line.rowCount).length,
    unassigned: lines.filter((line) => line.assignedCount === 0 && line.cancelledCount === 0).length,
    partial: lines.filter((line) => (
      line.assignedCount !== line.rowCount &&
      line.cancelledCount !== line.rowCount &&
      (line.assignedCount > 0 || line.cancelledCount > 0)
    )).length,
  }), [lines])
  const filteredLines = useMemo(() => {
    const needle = normalizeSearchText(search)
    return lines.filter((line) => {
      const matchesFilter = filter === 'all' || (
        filter === 'assigned'
          ? line.assignedCount === line.rowCount
          : filter === 'cancelled'
            ? line.cancelledCount === line.rowCount
            : filter === 'unassigned'
              ? line.assignedCount === 0 && line.cancelledCount === 0
              : line.assignedCount !== line.rowCount &&
                line.cancelledCount !== line.rowCount &&
                (line.assignedCount > 0 || line.cancelledCount > 0)
      )
      if (!matchesFilter) return false
      if (!needle) return true
      return normalizeSearchText(`${line.projectTitle} ${line.subtitleCode} ${line.line}`).includes(needle)
    })
  }, [filter, lines, search])
  const pagination = usePagePagination({ items: filteredLines, defaultPageSize: 25, resetKeys: [filter, search] })

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Поиск линий"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Проект, шифр или линия"
              className="pl-9"
            />
          </label>
          <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Обновить список линий">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
          {([
            ['all', 'Все'],
            ['assigned', 'ПСТО назначена'],
            ['cancelled', 'ПСТО отменена'],
            ['unassigned', 'Без ПСТО'],
            ['partial', 'Требуют выравнивания'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
              className={`flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors ${
                filter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/70'
              }`}
            >
              {label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {loading ? (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Загружаю линии...
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p className="font-semibold">Не удалось загрузить программу ПСТО</p>
            <p className="mt-1">{error}</p>
          </div>
        ) : pagination.pageItems.length === 0 ? (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-500">
            Линии по выбранным условиям не найдены.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="grid min-w-[940px] grid-cols-[minmax(220px,1fr)_minmax(230px,1fr)_130px_300px] border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase text-slate-500">
              <span>Проект и шифр</span>
              <span>Линия</span>
              <span>Стыки</span>
              <span>Назначение</span>
            </div>
            <div className="divide-y divide-slate-100">
              {pagination.pageItems.map((line) => (
                <LineListRow
                  key={line.key}
                  line={line}
                  onAssign={onAssign}
                  onReactivate={onReactivate}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        )}
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
        itemLabel="линий"
      />
    </div>
  )
}

function LineListRow({
  line,
  onAssign,
  onReactivate,
  onRemove,
}: {
  line: PstoLineAssignmentSummary
  onAssign: (line: PstoLineAssignmentSummary) => void
  onReactivate: (line: PstoLineAssignmentSummary) => void
  onRemove: (line: PstoLineAssignmentSummary) => void
}) {
  const assigned = line.assignedCount === line.rowCount
  const cancelled = line.cancelledCount === line.rowCount
  const unassigned = line.assignedCount === 0 && line.cancelledCount === 0
  return (
    <div className="grid min-w-[940px] grid-cols-[minmax(220px,1fr)_minmax(230px,1fr)_130px_300px] items-center gap-y-1 px-4 py-3 text-sm hover:bg-slate-50/70">
      <div className="min-w-0 pr-4">
        <p className="truncate font-semibold text-slate-800">{line.projectTitle || 'Без проекта'}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">Шифр: {line.subtitleCode || '—'}</p>
      </div>
      <div className="min-w-0 pr-4">
        <p className="truncate font-medium text-slate-800">{line.line}</p>
        {line.historyRowCount > 0 ? (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            История: {line.historyRowCount} стыков · НК до ТО: {line.preControlCount} · повторов: {line.repeatCycleCount}
          </p>
        ) : null}
      </div>
      <div className="tabular-nums text-slate-700">
        <span className="font-semibold">{line.rowCount}</span>
        {!unassigned && !assigned && !cancelled ? (
          <span className="ml-1 text-xs text-amber-700">({line.assignedCount} назначено · {line.cancelledCount} отменено)</span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <LineAssignmentStatus line={line} />
        <div className="flex shrink-0 gap-1.5">
          {cancelled ? (
            <Button size="sm" variant="outline" onClick={() => onReactivate(line)}>
              Возобновить
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : !assigned ? (
            <Button size="sm" variant={unassigned ? 'outline' : 'default'} onClick={() => onAssign(line)}>
              {unassigned ? 'Назначить' : 'На всю линию'}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : null}
          {assigned ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRemove(line)}
              title={line.historyRowCount > 0 ? 'Официально отменить ПСТО на линии' : 'Удалить ошибочное назначение'}
            >
              <CircleSlash2 className="h-4 w-4" />
              <span className="sr-only">{line.historyRowCount > 0 ? 'Отменить ПСТО' : 'Удалить назначение ПСТО'}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function LineAssignmentStatus({ line }: { line: PstoLineAssignmentSummary }) {
  if (line.assignedCount === line.rowCount) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-4 w-4" />
        Назначена
      </span>
    )
  }
  if (line.cancelledCount === line.rowCount) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <CircleSlash2 className="h-4 w-4" />
        Отменена
      </span>
    )
  }
  if (line.assignedCount === 0 && line.cancelledCount === 0) {
    return <span className="text-xs font-medium text-slate-500">Не назначена</span>
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <AlertTriangle className="h-4 w-4" />
      Частично
    </span>
  )
}

function AssignmentView({
  line,
  reactivating,
  preview,
  previewLoading,
  previewError,
  activationDispositions,
  pending,
  error,
  onActivationDispositionsChange,
  onRetry,
  onCancel,
  onSubmit,
}: {
  line: PstoLineAssignmentSummary
  reactivating: boolean
  preview: PstoLineRemovalPreview | null
  previewLoading: boolean
  previewError: string
  activationDispositions: Record<number, PstoLineActivationDisposition>
  pending: boolean
  error: string
  onActivationDispositionsChange: (value: Record<number, PstoLineActivationDisposition>) => void
  onRetry: () => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const blockedRows = preview?.rows.filter((row) => row.blocksActivation) ?? []
  const selectedDecisionCount = blockedRows.filter(
    (row) => Boolean(activationDispositions[row.rowId]),
  ).length
  const hasInvalidTransfer = blockedRows.some(
    (row) => activationDispositions[row.rowId] === 'movePrimaryToBeforeHeatTreatment' &&
      row.activationTransferBlockedMethods.length > 0,
  )
  const submitDisabled = (
    pending ||
    previewLoading ||
    !preview ||
    Boolean(previewError) ||
    selectedDecisionCount < blockedRows.length ||
    hasInvalidTransfer
  )
  const setAllActivationDispositions = (mode: 'keepPrimary' | 'moveAvailable') => {
    const next: Record<number, PstoLineActivationDisposition> = {}
    for (const row of blockedRows) {
      next[row.rowId] = mode === 'keepPrimary' || row.activationTransferBlockedMethods.length > 0
        ? 'keepPrimary'
        : 'movePrimaryToBeforeHeatTreatment'
    }
    onActivationDispositionsChange(next)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-4xl space-y-4">
          <section className="rounded-md border border-slate-200 bg-white">
            <div className="grid gap-px bg-slate-200 sm:grid-cols-3">
              <SummaryCell label="Стыков на линии" value={line.rowCount} />
              <SummaryCell label="Сейчас с ПСТО" value={line.assignedCount} />
              <SummaryCell label="Будет с ПСТО" value={line.rowCount} tone="sky" />
            </div>
          </section>
          <div className="flex items-start gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
            <ListChecks className="mt-1 h-4 w-4 shrink-0 text-sky-600" />
            <p>
              {reactivating
                ? `ПСТО снова будет назначена всем ${line.rowCount} стыкам линии. Выполненная история сохранится, а дата и основание отмены очистятся. Для необработанных стыков полный цикл начнется заново.`
                : `Назначение «ПСТО: да» будет установлено всем ${line.rowCount} стыкам линии. Перед сохранением система проверит уже созданный основной НК.`}
            </p>
          </div>
          {previewLoading ? (
            <div className="flex min-h-32 items-center justify-center rounded-md border border-slate-200 bg-white text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Проверяю основной НК и этап «До ТО»...
            </div>
          ) : previewError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">Не удалось проверить линию</p>
              <p className="mt-1">{previewError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Повторить проверку
              </Button>
            </div>
          ) : blockedRows.length > 0 ? (
            <section className="overflow-hidden rounded-md border border-amber-300 bg-white">
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold">Выберите судьбу основного НК для каждого стыка</p>
                    <p className="mt-1 leading-5">
                      Комплект каждого стыка переносится целиком. Для фактического контроля после ТО оставьте его основным
                      и позднее оформите отдельный НК до ТО.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 bg-white text-xs"
                        onClick={() => setAllActivationDispositions('keepPrimary')}
                      >
                        Все оставить основными
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 bg-white text-xs"
                        onClick={() => setAllActivationDispositions('moveAvailable')}
                        title="Стыки с уже заполненным НК до ТО останутся на основном этапе"
                      >
                        Доступные перенести в «До ТО»
                      </Button>
                      <span className="ml-auto text-xs font-medium tabular-nums text-amber-800">
                        Выбрано: {selectedDecisionCount} из {blockedRows.length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {blockedRows.map((row) => {
                  const jointLabel = row.joint || `#${row.rowId}`
                  return (
                    <div
                      key={row.rowId}
                      className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(130px,0.55fr)_minmax(220px,1fr)_minmax(300px,1.25fr)] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-800">{jointLabel}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">Спул: {row.spool || '—'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-600">Основной НК: <MethodList methods={row.primaryMethods} /></p>
                        {row.activationTransferBlockedMethods.length > 0 ? (
                          <p className="mt-1 text-xs leading-5 text-amber-700">
                            В «НК до ТО» уже заполнено: {row.activationTransferBlockedMethods.join(', ')}.
                            Для этого стыка доступно только сохранение основного комплекта.
                          </p>
                        ) : null}
                      </div>
                      <ActivationDispositionSelector
                        jointLabel={jointLabel}
                        selected={activationDispositions[row.rowId]}
                        transferDisabled={row.activationTransferBlockedMethods.length > 0}
                        onChange={(disposition) => onActivationDispositionsChange({
                          ...activationDispositions,
                          [row.rowId]: disposition,
                        })}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                Выбор сам по себе ничего не сохраняет. ПСТО по-прежнему назначается всей линии только после нажатия итоговой кнопки.
              </div>
            </section>
          ) : preview ? (
            <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>Конфликтов с основным НК нет. Назначение можно сохранить.</p>
            </div>
          ) : null}
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
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
  )
}

function ActivationDispositionSelector({
  jointLabel,
  selected,
  transferDisabled,
  onChange,
}: {
  jointLabel: string
  selected: PstoLineActivationDisposition | undefined
  transferDisabled: boolean
  onChange: (value: PstoLineActivationDisposition) => void
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase text-slate-500">Судьба комплекта</p>
      <div
        role="group"
        aria-label={`Судьба основного НК для стыка ${jointLabel}`}
        className="grid min-h-10 grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1"
      >
        <button
          type="button"
          aria-label={`Оставить основной НК для стыка ${jointLabel}`}
          aria-pressed={selected === 'keepPrimary'}
          onClick={() => onChange('keepPrimary')}
          className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors ${
            selected === 'keepPrimary'
              ? 'bg-white text-sky-800 shadow-sm ring-1 ring-sky-200'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
          }`}
        >
          Оставить основным
        </button>
        <button
          type="button"
          aria-label={`Перенести основной НК стыка ${jointLabel} в «До ТО»`}
          aria-pressed={selected === 'movePrimaryToBeforeHeatTreatment'}
          disabled={transferDisabled}
          title={transferDisabled ? 'Этап «До ТО» уже содержит данные этого вида НК' : undefined}
          onClick={() => onChange('movePrimaryToBeforeHeatTreatment')}
          className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
            selected === 'movePrimaryToBeforeHeatTreatment'
              ? 'bg-white text-sky-800 shadow-sm ring-1 ring-sky-200'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
          }`}
        >
          В «До ТО»
        </button>
      </div>
    </div>
  )
}

function RemovalView({
  line,
  preview,
  loading,
  previewError,
  saveError,
  pending,
  decisions,
  officialCancellation,
  cancellationDate,
  cancellationBasis,
  onCancellationDateChange,
  onCancellationBasisChange,
  onDecisionChange,
  onSetAll,
  onRetry,
  onCancel,
  onSubmit,
}: {
  line: PstoLineAssignmentSummary
  preview: PstoLineRemovalPreview | null
  loading: boolean
  previewError: string
  saveError: string
  pending: boolean
  decisions: Record<number, PstoLineRemovalDisposition>
  officialCancellation: boolean
  cancellationDate: string
  cancellationBasis: string
  onCancellationDateChange: (value: string) => void
  onCancellationBasisChange: (value: string) => void
  onDecisionChange: (rowId: number, disposition: PstoLineRemovalDisposition) => void
  onSetAll: (disposition: PstoLineRemovalDisposition) => void
  onRetry: () => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const rows = preview?.rows ?? []
  const pagination = usePagePagination({ items: rows, defaultPageSize: 25, resetKeys: [preview] })
  const requiredRows = rows.filter(
    (row) => !row.preservesPerformedHistory && row.promotablePreMethods.length > 0,
  )
  const undecidedCount = requiredRows.filter((row) => !decisions[row.rowId]).length

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
            {requiredRows.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Нужно выбрать комплект для {requiredRows.length} стыков. Без решения: <strong className="text-slate-900">{undecidedCount}</strong>.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onSetAll('keepPrimary')}>Всем: оставить основной</Button>
                  <Button variant="outline" size="sm" onClick={() => onSetAll('promoteBeforeHeatTreatment')}>Всем: перенести до ТО</Button>
                </div>
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
                      <p>НК до ТО: <MethodList methods={row.promotablePreMethods} /></p>
                      {row.pendingPreMethods.length > 0 ? (
                        <p className="text-amber-700">Без результата: <MethodList methods={row.pendingPreMethods} /></p>
                      ) : null}
                      {row.pstoRequest || row.pstoResult || row.repeatCycleCount > 0 ? (
                        <p>ПСТО: {row.pstoResult || (row.pstoRequest ? 'есть заявка' : '—')}{row.repeatCycleCount ? ` · повторов: ${row.repeatCycleCount}` : ''}</p>
                      ) : null}
                    </div>
                    <div>
                      {row.preservesPerformedHistory ? (
                        <p className="text-xs leading-5 text-emerald-700">
                          Выполненная ПСТО, ТВМТ, повторные циклы и документы сохранятся. Если текущая физическая ПСТО уже проведена, внесите фактическую ТВМТ: любой результат завершит отмененный цикл, а новый повтор не откроется. Затем можно завершить основной НК.
                        </p>
                      ) : row.promotablePreMethods.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-1">
                          <DecisionButton
                            selected={decisions[row.rowId] === 'keepPrimary'}
                            onClick={() => onDecisionChange(row.rowId, 'keepPrimary')}
                            label="Оставить основной комплект"
                          />
                          <DecisionButton
                            selected={decisions[row.rowId] === 'promoteBeforeHeatTreatment'}
                            onClick={() => onDecisionChange(row.rowId, 'promoteBeforeHeatTreatment')}
                            label="Перенести завершенный НК до ТО"
                          />
                        </div>
                      ) : row.pendingPreMethods.length > 0 ? (
                        <p className="text-xs leading-5 text-amber-700">Заявки до ТО без результата будут удалены. Основной комплект не изменится.</p>
                      ) : (
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
              {officialCancellation
                ? 'Выполненная и оплачиваемая история ПСТО/ТВМТ сохранится. У необработанных стыков удалятся заявки ПСТО без результата и данные НК до ТО по показанному выбору; после отмены им не потребуется двойной контроль.'
                : 'У линии нет документов и результатов. Будет удалено только ошибочное назначение ПСТО; другие данные стыков не изменятся.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onCancel} disabled={pending}>Отмена</Button>
            <Button
              variant="destructive"
              onClick={onSubmit}
              disabled={!preview || pending || undecidedCount > 0 || (officialCancellation && !cancellationDate)}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleSlash2 className="mr-2 h-4 w-4" />}
              {officialCancellation ? 'Отменить ПСТО на линии' : 'Удалить назначение'}
            </Button>
          </div>
        </div>
        {saveError ? <p className="mt-3 text-sm font-medium text-rose-700">{saveError}</p> : null}
      </div>
    </div>
  )
}

function DecisionButton({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 rounded px-3 py-2 text-left text-xs font-medium leading-4 transition-colors ${
        selected
          ? 'bg-sky-600 text-white shadow-sm'
          : 'bg-white text-slate-700 hover:bg-sky-50 hover:text-sky-900'
      }`}
    >
      {label}
    </button>
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
