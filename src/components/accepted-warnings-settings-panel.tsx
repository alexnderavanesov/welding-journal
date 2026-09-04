import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { DialogRowPagination } from '@/components/dialog-row-pagination'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getAcceptedWarningContextParts } from '@/lib/dispatcher-accepted-warning-display'
import {
  DEFAULT_DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE,
  DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY,
  getDispatcherAcceptedWarningCategoryLabel,
  type DispatcherAcceptedWarningCategory,
  type DispatcherAcceptedWarningPeriod,
  type DispatcherAcceptedWarningSort,
} from '@/lib/dispatcher-accepted-warning-query'
import { parseEarlyCoilDecisionKey } from '@/lib/early-coil-decision'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSecurityGuard } from '@/lib/security-context'
import {
  DISPATCHER_TASK_SNAPSHOT_QUERY_KEY,
  invalidateWeldPageQueries,
  STATISTICS_SERVER_QUERY_KEY,
} from '@/lib/weld-query-utils'
import {
  listDispatcherAcceptedWarnings,
  revokeDispatcherAcceptedWarning,
} from '@/server/dispatcher-warnings'

type AcceptedWarningsSettingsPanelProps = {
  runProtectedSettingsChange: (action: () => void | Promise<void>) => Promise<boolean>
}

const CATEGORY_OPTIONS: Array<{ value: DispatcherAcceptedWarningCategory; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'percentage-line-control', label: 'Процентные линии' },
  { value: 'early-coil', label: 'Досрочные катушки' },
  { value: 'other', label: 'Другие' },
]

const PERIOD_OPTIONS: Array<{ value: DispatcherAcceptedWarningPeriod; label: string }> = [
  { value: 'all', label: 'За все время' },
  { value: '7d', label: 'За 7 дней' },
  { value: '30d', label: 'За 30 дней' },
  { value: '90d', label: 'За 90 дней' },
]

const SORT_OPTIONS: Array<{ value: DispatcherAcceptedWarningSort; label: string }> = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
]

export function AcceptedWarningsSettingsPanel({
  runProtectedSettingsChange,
}: AcceptedWarningsSettingsPanelProps) {
  const [searchDraft, setSearchDraft] = useState('')
  const [category, setCategory] = useState<DispatcherAcceptedWarningCategory>('all')
  const [period, setPeriod] = useState<DispatcherAcceptedWarningPeriod>('all')
  const [sort, setSort] = useState<DispatcherAcceptedWarningSort>('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DISPATCHER_ACCEPTED_WARNING_PAGE_SIZE)
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null)
  const search = useDebouncedValue(searchDraft.trim(), 250)
  const searchIsSettled = search === searchDraft.trim()
  const confirmAction = useConfirmAction()
  const { requireDeletePassword } = useSecurityGuard()
  const queryClient = useQueryClient()
  const request = useMemo(() => ({
    search,
    category,
    period,
    sort,
    page,
    pageSize,
  }), [category, page, pageSize, period, search, sort])
  const acceptedWarningsQuery = useQuery({
    queryKey: [...DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, request],
    queryFn: () => listDispatcherAcceptedWarnings({ data: request }),
    enabled: searchIsSettled,
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  })
  const revokeAcceptedWarningMutation = useMutation({
    mutationFn: (key: string) => revokeDispatcherAcceptedWarning({ data: { key } }),
    onSuccess: async (result, key) => {
      setMessage({
        text: parseEarlyCoilDecisionKey(key)
          ? `Решение о досрочной катушке отменено${result.deletedRowIds.length > 0 ? `; удалено пустых стыков: ${result.deletedRowIds.length}` : ''}.`
          : 'Принятое исключение отменено.',
        tone: 'success',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DISPATCHER_TASK_SNAPSHOT_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATISTICS_SERVER_QUERY_KEY }),
        invalidateWeldPageQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'] }),
      ])
    },
    onError: (error) => {
      setMessage({
        text: getAcceptedWarningErrorMessage(error, 'Не удалось отменить принятое исключение.'),
        tone: 'error',
      })
    },
  })

  const data = acceptedWarningsQuery.data
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
  const firstItemNumber = data?.items.length ? (page - 1) * pageSize + 1 : 0
  const lastItemNumber = data?.items.length ? firstItemNumber + data.items.length - 1 : 0
  const hasFilters = Boolean(search) || category !== 'all' || period !== 'all'
  const hasChangedView = hasFilters || sort !== 'newest'

  useEffect(() => {
    if (data && page > pageCount) setPage(pageCount)
  }, [data, page, pageCount])

  const resetPage = () => setPage(1)

  const clearView = () => {
    setSearchDraft('')
    setCategory('all')
    setPeriod('all')
    setSort('newest')
    resetPage()
  }

  const revokeAcceptedWarning = async (key: string, label: string) => {
    const isEarlyCoilDecision = Boolean(parseEarlyCoilDecisionKey(key))
    const confirmed = await confirmAction({
      title: isEarlyCoilDecision ? 'Отменить досрочную врезку катушки' : 'Отменить принятое исключение',
      itemName: label,
      description: isEarlyCoilDecision
        ? 'Система удалит созданные стыки катушки только если они остались полностью пустыми и нетронутыми. После отмены диспетчер снова предложит обычный следующий ремонт или вырез.'
        : 'Если нарушение все еще существует, после пересчета оно снова появится в диспетчере.',
      warning: isEarlyCoilDecision
        ? 'Если у стыков катушки уже появились изменения, сварка, контроль, документы или продолжение цепочки, отмена будет заблокирована без удаления данных.'
        : undefined,
      confirmLabel: isEarlyCoilDecision ? 'Отменить решение' : 'Отменить исключение',
      tone: 'warning',
    })
    if (!confirmed) return
    setMessage(null)
    try {
      await runProtectedSettingsChange(async () => {
        if (
          isEarlyCoilDecision &&
          !(await requireDeletePassword('отмену досрочной врезки катушки'))
        ) return
        await revokeAcceptedWarningMutation.mutateAsync(key)
      })
    } catch {
      // The mutation displays the authoritative server reason in this panel.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-slate-300 bg-slate-100/80 p-4 shadow-sm shadow-slate-200/60 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-slate-500" />
            <h3 className="text-base font-semibold text-slate-900">Принятые исключения</h3>
            <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
              Всего: {data?.overallTotal ?? 0}
            </span>
            {hasFilters ? (
              <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                Найдено: {data?.total ?? 0}
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            Здесь хранятся ситуации, которые пользователь осознанно разрешил кнопкой «Принять», и решения о досрочной врезке катушки.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void acceptedWarningsQuery.refetch()}
          disabled={!searchIsSettled || acceptedWarningsQuery.isFetching}
          aria-label="Обновить принятые исключения"
          title="Обновить"
        >
          <RefreshCw className={`h-4 w-4 ${acceptedWarningsQuery.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(280px,1fr)_auto_auto] lg:items-end">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Поиск</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchDraft}
                onChange={(event) => {
                  setSearchDraft(event.target.value)
                  resetPage()
                }}
                placeholder="Код, название, проект, шифр, линия, стык или клеймо"
                className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                aria-label="Поиск принятых исключений"
              />
              {searchDraft ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('')
                    resetPage()
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
                  aria-label="Очистить поиск принятых исключений"
                  title="Очистить поиск"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Период принятия</span>
            <select
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as DispatcherAcceptedWarningPeriod)
                resetPage()
              }}
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-3 pr-8 text-sm font-medium text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 lg:min-w-40"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Порядок</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as DispatcherAcceptedWarningSort)
                resetPage()
              }}
              className="h-10 w-full rounded-md border border-slate-200 bg-white pl-3 pr-8 text-sm font-medium text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 lg:min-w-44"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap overflow-hidden rounded-md border border-slate-200 bg-white" role="group" aria-label="Тип принятого исключения">
            {CATEGORY_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setCategory(option.value)
                  resetPage()
                }}
                className={`min-h-9 border-slate-200 px-3 py-1.5 text-xs font-semibold transition-colors ${
                  index > 0 ? 'border-l' : ''
                } ${
                  category === option.value
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                aria-pressed={category === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          {hasChangedView ? (
            <button
              type="button"
              onClick={clearView}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-3.5 w-3.5" />
              Сбросить
            </button>
          ) : null}
        </div>

        {message ? (
          <div className={`border-b px-4 py-2.5 text-xs font-medium ${
            message.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            {message.text}
          </div>
        ) : null}

        {!searchIsSettled || acceptedWarningsQuery.isPending ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Загружаем исключения...</div>
        ) : acceptedWarningsQuery.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-red-700">
            <span>{getAcceptedWarningErrorMessage(acceptedWarningsQuery.error, 'Не удалось загрузить принятые исключения.')}</span>
            <button
              type="button"
              onClick={() => void acceptedWarningsQuery.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold hover:bg-red-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Повторить
            </button>
          </div>
        ) : data?.items.length ? (
          <div className="divide-y divide-slate-100">
            {data.items.map((warning) => {
              const categoryLabel = getDispatcherAcceptedWarningCategoryLabel(warning.kind)
              const label = warning.title || categoryLabel
              const contextParts = getAcceptedWarningContextParts(warning)
              const isRevoking = revokeAcceptedWarningMutation.isPending && revokeAcceptedWarningMutation.variables === warning.key
              return (
                <div key={warning.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                    {warning.code || categoryLabel}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-semibold text-slate-900">{label}</div>
                    {contextParts.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-slate-600">
                        {contextParts.map((part, index) => (
                          <span key={`${part.label}:${part.value}:${index}`} className="break-words">
                            <span className="font-semibold text-slate-500">{part.label}:</span> {part.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-xs text-slate-500">
                      Принято: {formatAcceptedWarningTimestamp(warning.acceptedAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void revokeAcceptedWarning(warning.key, warning.context || label)}
                    disabled={revokeAcceptedWarningMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isRevoking ? 'Отменяем...' : 'Отменить'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            {hasFilters ? 'По заданным условиям исключения не найдены.' : 'Принятых исключений пока нет.'}
          </div>
        )}

        {data && data.total > 0 ? (
          <DialogRowPagination
            totalCount={data.total}
            firstItemNumber={firstItemNumber}
            lastItemNumber={lastItemNumber}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            onPreviousPage={() => setPage((current) => Math.max(1, current - 1))}
            onNextPage={() => setPage((current) => Math.min(pageCount, current + 1))}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize)
              resetPage()
            }}
            itemLabel="исключений"
          />
        ) : null}
      </div>
    </div>
  )
}

function getAcceptedWarningErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function formatAcceptedWarningTimestamp(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}
