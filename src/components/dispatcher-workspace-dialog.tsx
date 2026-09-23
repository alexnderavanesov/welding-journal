import { useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { BellRing, Search, X } from 'lucide-react'

import { DialogVirtualizedRows } from '@/components/dialog-virtualized-rows'
import { DispatcherTaskViewActions, RepeatedJointTaskActions } from '@/components/dispatcher-task-actions'
import type { DispatcherTaskCardHandlers } from '@/components/dispatcher-task-card'
import { DispatcherTaskDetails } from '@/components/dispatcher-task-ui'
import { Button } from '@/components/ui/button'
import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'
import { buildDispatcherTaskCodeGroups } from '@/lib/dispatcher-code-groups'
import type { DispatcherTask, RepeatedJointTask, RepeatedJointTaskGroup } from '@/lib/dispatcher-types'
import { buildDispatcherTaskGroups } from '@/lib/dispatcher-view'
import { formatTaskCount } from '@/lib/dispatcher-format'
import { getDispatcherTaskCode } from '@/lib/dispatcher-settings'
import { getRepeatedJointTaskTitle } from '@/lib/dispatcher-text'
import { matchesDispatcherWorkspaceTask } from '@/lib/dispatcher-workspace-search'
import { getJointChainConsistencyKey } from '@/lib/repeated-joint-tasks'
import { searchDispatcherTaskPages } from '@/server/dispatcher-task-pages'

export function DispatcherWorkspaceDialog({
  tasks,
  groups,
  totalTaskCount,
  computedRevision,
  taskFilterOptions,
  isRefreshing,
  hasMoreTasks,
  onLoadMoreTasks,
  isTaskBatchLoading,
  taskBatchError,
  onRetryTaskBatch,
  onRefreshTasks,
  handlers,
  onClose,
}: {
  tasks: RepeatedJointTask[]
  groups: RepeatedJointTaskGroup[]
  totalTaskCount: number
  computedRevision: number
  taskFilterOptions: Array<{ value: string; count: number; label: string }>
  isRefreshing: boolean
  hasMoreTasks: boolean
  onLoadMoreTasks?: () => void
  isTaskBatchLoading: boolean
  taskBatchError?: string
  onRetryTaskBatch?: () => void
  onRefreshTasks?: () => Promise<number | undefined>
  handlers: DispatcherTaskCardHandlers
  onClose: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [isRetryingSearch, setIsRetryingSearch] = useState(false)
  const [searchRetryError, setSearchRetryError] = useState<string | null>(null)
  const showExpandedSearch = isSearchExpanded || Boolean(searchDraft || search)

  const allCodeGroups = useMemo(() => buildDispatcherTaskCodeGroups(groups), [groups])
  const codeOptions = useMemo(() => {
    const byCode = new Map(allCodeGroups.map((group) => [group.code, {
      code: group.code,
      label: group.label,
      count: group.tasks.length,
    }]))
    if (hasMoreTasks) {
      for (const option of taskFilterOptions) {
        if (!byCode.has(option.value)) byCode.set(option.value, {
          code: option.value,
          label: option.label,
          // Filter-option counts are weld rows, not task cards. A code absent
          // from the loaded snapshot can still have tasks in later batches.
          count: 0,
        })
      }
    }
    return [...byCode.values()]
  }, [allCodeGroups, hasMoreTasks, taskFilterOptions])
  const selectedCodeOption = codeOptions.find((option) => option.code === selectedCode)
  const searchOnServer = hasMoreTasks && Boolean(search || selectedCode)
  const searchQuery = useInfiniteQuery({
    queryKey: ['dispatcher-workspace-search', computedRevision, search, selectedCode],
    initialPageParam: 0,
    enabled: searchOnServer && computedRevision >= 0 && !isRefreshing,
    queryFn: ({ pageParam }) => searchDispatcherTaskPages({
      data: { search, code: selectedCode, offset: pageParam, limit: 100, computedRevision },
    }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.tasks.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const searchedTasks = useMemo(
    () => searchQuery.data?.pages.flatMap((page) => page.tasks) ?? [],
    [searchQuery.data],
  )
  const filteredTasks = useMemo(
    () => searchOnServer
      ? searchedTasks
      : tasks.filter((task) => matchesDispatcherWorkspaceTask(task, search, selectedCode)),
    [tasks, search, selectedCode, searchedTasks, searchOnServer],
  )
  const filteredGroups = useMemo(() => {
    if (!searchOnServer && !search && !selectedCode) return groups
    return buildDispatcherTaskGroups({
      repeatedJointTasks: filteredTasks,
      welderStampExpiryTasks: [],
      getJointChainConsistencyKey,
    }).repeatedJointTaskGroups
  }, [filteredTasks, groups, search, searchOnServer, selectedCode])
  const codeGroups = useMemo(() => buildDispatcherTaskCodeGroups(filteredGroups), [filteredGroups])
  const queuedTasks = useMemo(
    () => codeGroups.flatMap((group) => group.tasks).filter((task): task is RepeatedJointTask => task.kind !== 'welder-stamp-expiry'),
    [codeGroups],
  )
  const totalMatches = searchOnServer ? searchQuery.data?.pages[0]?.total ?? 0 : filteredTasks.length
  const hasCommittedSearch = search.length > 0
  const isSearchPending = searchOnServer && (isRefreshing || searchQuery.isPending)
  const resultCount = selectedCode || hasCommittedSearch ? totalMatches : totalTaskCount
  const resultSummary = isSearchPending
    ? 'Ищем задачи…'
    : hasCommittedSearch
      ? `${totalMatches === 1 ? 'Найдена' : 'Найдено'} ${formatTaskCount(totalMatches)} по запросу «${search}»`
      : hasMoreTasks && !searchOnServer
        ? `Загружено ${tasks.length.toLocaleString('ru-RU')} из ${totalTaskCount.toLocaleString('ru-RU')}; поиск проверяет весь список`
        : null
  const workspaceHandlers = useMemo(() => ({
    ...handlers,
    onShowTask: (task: DispatcherTask) => {
      onClose()
      handlers.onShowTask(task)
    },
  }), [handlers, onClose])
  const chooseCode = (code: string | null) => {
    setSelectedCode(code)
  }
  const retrySearch = async () => {
    if (isRetryingSearch) return
    setIsRetryingSearch(true)
    setSearchRetryError(null)
    try {
      const revision = onRefreshTasks ? await onRefreshTasks() : computedRevision
      // A new revision changes the query key. Never refetch the old search
      // after another user's save, or mix pages from different calculations.
      if (revision === computedRevision) await searchQuery.refetch()
    } catch (error) {
      setSearchRetryError(error instanceof Error ? error.message : 'Не удалось обновить задачи.')
    } finally {
      setIsRetryingSearch(false)
    }
  }

  return (
    <WorkflowDialogShell ariaLabel="Диспетчер задач">
      <div className="flex min-h-0 flex-1 flex-col" aria-label="Рабочее пространство диспетчера">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700" aria-hidden="true">
              <BellRing className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Диспетчер задач</h2>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                {formatTaskCount(totalTaskCount)}
              </span>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0 text-slate-500" onClick={onClose} aria-label="Закрыть диспетчер">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <select
          aria-label="Тип ДЗ"
          className="mx-4 my-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm lg:hidden"
          value={selectedCode ?? ''}
          onChange={(event) => chooseCode(event.target.value || null)}
        >
          <option value="">Все ДЗ</option>
          {codeOptions.map((option) => <option key={option.code} value={option.code}>{option.code} · {option.label}</option>)}
        </select>
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[304px] shrink-0 overflow-y-auto border-r border-slate-200 bg-[#f8fcfe] p-3 xl:w-[328px] lg:block" aria-label="Типы ДЗ">
            <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <button type="button" onClick={() => chooseCode(null)} aria-pressed={selectedCode === null}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border-l-[3px] px-3 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${selectedCode === null ? 'border-sky-500 bg-sky-50 text-sky-900' : 'border-transparent text-slate-700 hover:bg-slate-50'}`}>
                <span>Все задачи</span>
                <span className="inline-flex min-w-8 justify-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{totalTaskCount}</span>
              </button>
              <div className="mx-2 my-1 border-t border-slate-100" />
              {codeOptions.map((option) => (
                <button key={option.code} type="button" onClick={() => chooseCode(option.code)} aria-pressed={selectedCode === option.code}
                  className={`flex w-full items-start justify-between gap-2.5 rounded-lg border-l-[3px] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${selectedCode === option.code ? 'border-sky-500 bg-sky-50 text-slate-900' : 'border-transparent text-slate-800 hover:bg-slate-50'}`}>
                  <span className="flex min-w-0 flex-col gap-0.5" title={`${option.code} · ${option.label}`}>
                    <span className="text-xs font-semibold text-violet-700">{option.code}</span>
                    <span className="break-words text-sm font-medium leading-5">{option.label}</span>
                  </span>
                  <span className="mt-0.5 inline-flex shrink-0 justify-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{hasMoreTasks ? `${option.count} загр.` : option.count}</span>
                </button>
              ))}
            </div>
          </aside>
          <main className="flex min-w-0 min-h-0 flex-1 flex-col overflow-y-auto bg-[#f8fcfe] p-4 sm:p-5 lg:overflow-hidden">
            <div className="mb-4 flex flex-wrap items-start gap-3">
              <div className="min-w-[160px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className={`min-w-0 font-semibold leading-snug text-slate-900 ${selectedCode ? 'text-[15px]' : 'text-base'}`}>
                    {selectedCode ? `${selectedCode} · ${selectedCodeOption?.label ?? 'Задачи диспетчера'}` : hasCommittedSearch ? 'Результаты поиска' : 'Все задачи'}
                  </h3>
                  {!isSearchPending ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{formatTaskCount(resultCount)}</span> : null}
                </div>
                {resultSummary ? <p className="mt-1 text-xs leading-5 text-slate-500" role="status">{resultSummary}</p> : null}
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
                <form
                  role="search"
                  aria-label="Поиск задач"
                  data-dispatcher-workspace-search
                  data-expanded={showExpandedSearch}
                  className={`min-w-0 max-w-full transition-[width] duration-200 ease-out ${showExpandedSearch ? 'w-full sm:w-[340px]' : 'w-full sm:w-[190px]'}`}
                  onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()) }}
                  onFocus={() => setIsSearchExpanded(true)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget) && !searchDraft && !search) setIsSearchExpanded(false)
                  }}
                >
                  <div className="flex h-9 min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 shadow-sm transition-colors focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <input
                      ref={searchRef}
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      aria-label="Поиск задач диспетчера"
                      enterKeyHint="search"
                      maxLength={120}
                      placeholder={showExpandedSearch ? 'Номер, линия или текст' : 'Поиск задач'}
                      className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0"
                    />
                    {searchDraft || search ? (
                      <button type="button" aria-label="Очистить" title="Очистить поиск"
                        onClick={() => { setSearchDraft(''); setSearch(''); searchRef.current?.focus() }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                    {showExpandedSearch ? <Button type="submit" size="sm" className="h-7 shrink-0 rounded-md bg-sky-600 px-3 text-white hover:bg-sky-700 focus-visible:ring-sky-200">Найти</Button> : null}
                  </div>
                </form>
              </div>
            </div>
            {searchOnServer && isRefreshing ? <div className="p-4 text-sm text-slate-600">Идёт пересчёт диспетчера. Дождитесь обновления, чтобы искать по всему списку.</div> : null}
            {searchOnServer && !isRefreshing && searchQuery.isPending ? <div className="p-4 text-sm text-slate-600">Ищем задачи…</div> : null}
            {searchOnServer && searchQuery.isError ? (
              <div className="flex items-center gap-2 p-4 text-sm text-red-700" role="alert">
                {searchRetryError ?? (searchQuery.error instanceof Error ? searchQuery.error.message : 'Не удалось найти задачи.')}
                <Button type="button" variant="outline" size="sm" disabled={isRetryingSearch} onClick={() => { void retrySearch() }}>Повторить поиск</Button>
              </div>
            ) : null}
            {!(searchOnServer && (isRefreshing || searchQuery.isPending || searchQuery.isError)) && queuedTasks.length > 0 ? (
              <section className="flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Очередь задач диспетчера">
                  <div className="hidden shrink-0 grid-cols-[190px_minmax(0,1fr)] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
                    <span>Стык или линия</span>
                    <span>Задача, причина и действия</span>
                  </div>
                  <DialogVirtualizedRows
                    key={`${selectedCode ?? 'all'}:${search}`}
                    items={queuedTasks}
                    estimateRowHeight={120}
                    getItemKey={(task) => task.key}
                    renderItem={(task) => (
                      <DispatcherWorkspaceTaskRow
                        task={task}
                        handlers={workspaceHandlers}
                      />
                    )}
                    footer={taskBatchError || (searchOnServer && searchQuery.hasNextPage) || (!searchOnServer && hasMoreTasks) ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
                        {taskBatchError ? (
                          <div className="flex flex-wrap items-center gap-2 text-sm text-red-700" role="alert">
                            {taskBatchError}
                            {onRetryTaskBatch ? <Button type="button" variant="outline" size="sm" onClick={onRetryTaskBatch}>Повторить загрузку</Button> : null}
                          </div>
                        ) : null}
                        {searchOnServer && searchQuery.hasNextPage ? (
                          <Button type="button" variant="outline" size="sm" disabled={searchQuery.isFetchingNextPage} onClick={() => { void searchQuery.fetchNextPage() }}>
                            {searchQuery.isFetchingNextPage ? 'Загружаем результаты…' : `Показать ещё найденные (${searchedTasks.length} из ${totalMatches})`}
                          </Button>
                        ) : null}
                        {!searchOnServer && hasMoreTasks ? (
                          <Button type="button" variant="outline" size="sm" disabled={isTaskBatchLoading || isRefreshing} onClick={onLoadMoreTasks}>
                            {isTaskBatchLoading ? 'Загружаем задачи…' : `Загрузить ещё задачи (${tasks.length} из ${totalTaskCount})`}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  />
              </section>
            ) : (!searchOnServer || (!isRefreshing && !searchQuery.isPending && !searchQuery.isError)) ? (
              <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600">
                {hasMoreTasks && !searchOnServer ? 'В загруженной части задачи не найдены. Загрузите следующую порцию или воспользуйтесь поиском.' : 'Задачи не найдены. Измените запрос или тип ДЗ.'}
                {taskBatchError ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700" role="alert">
                    {taskBatchError}
                    {onRetryTaskBatch ? <Button type="button" variant="outline" size="sm" onClick={onRetryTaskBatch}>Повторить загрузку</Button> : null}
                  </div>
                ) : null}
                {!searchOnServer && hasMoreTasks ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3" disabled={isTaskBatchLoading || isRefreshing} onClick={onLoadMoreTasks}>
                    {isTaskBatchLoading ? 'Загружаем задачи…' : `Загрузить ещё задачи (${tasks.length} из ${totalTaskCount})`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </WorkflowDialogShell>
  )
}

function DispatcherWorkspaceTaskRow({
  task,
  handlers,
}: {
  task: RepeatedJointTask
  handlers: DispatcherTaskCardHandlers
}) {
  const title = getRepeatedJointTaskTitle(task)
  const isLineTask = task.kind === 'line-consistency' || task.kind === 'percentage-line-control'
  const projectTitle = isLineTask ? String(task.row.projectTitle ?? '').trim() : ''
  const subtitleCode = isLineTask ? String(task.row.subtitleCode ?? '').trim() : ''
  const locationDetail = isLineTask ? '' : String(task.row.line ?? '').trim()

  return (
    <article
      data-dispatcher-workspace-task-row
      className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 bg-white px-4 py-3 text-sm transition-colors duration-150 hover:bg-sky-50/80 focus-within:bg-sky-50/80 sm:grid-cols-[190px_minmax(0,1fr)]"
    >
      <div className="min-w-0 break-words" data-dispatcher-workspace-task-location>
        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isLineTask ? 'Линия' : 'Стык'}</span>
        <strong className="block font-semibold leading-5 text-slate-900">{title.joint}</strong>
        {isLineTask ? (
          <span className="mt-0.5 block min-w-0 text-xs leading-4 text-slate-500">
            {projectTitle ? <span className="block break-words" title={projectTitle}>{projectTitle}</span> : null}
            {subtitleCode ? <span className="block break-words text-slate-500" title={subtitleCode}>{subtitleCode}</span> : null}
          </span>
        ) : locationDetail ? <span className="block text-xs text-slate-500">{locationDetail}</span> : null}
      </div>
      <div className="min-w-0" data-dispatcher-workspace-task-details>
        <div
          data-dispatcher-workspace-task-heading
          className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-medium text-slate-800">
            <span className="font-semibold text-violet-700">{getDispatcherTaskCode(task)}</span>
            <span>{title.type}</span>
          </div>
          <DispatcherTaskViewActions
            task={task}
            onShowTask={handlers.onShowTask}
            onOpenTaskPicture={handlers.onOpenTaskPicture}
            workspace
            className="sm:justify-self-end"
          />
        </div>
        <DispatcherTaskDetails task={task} showHeading={false} workspace workspaceTitle={title.type} />
        <RepeatedJointTaskActions task={task} {...handlers} workspace hideViewActions className="has-[button]:mt-2" />
      </div>
    </article>
  )
}
