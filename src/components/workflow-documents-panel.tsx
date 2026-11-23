import type { WorkflowDocumentChoice } from '@/lib/workflow-document-choices'
import { workflowDocumentReferenceArea } from '@/lib/workflow-document-area'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from './ui/button'
import { Select } from './ui/select'
import { BufferedFilterInput } from './result-filters'
import { ManagerEditPanel, ManagerEditSection } from './manager-edit-panel'
import { SystemDocumentDateEditor } from './system-document-date-editor'
import { DocumentConnectionsButton } from './document-connections-button'
import { DialogRowPagination } from './dialog-row-pagination'
import { formatDisplayDate } from '@/lib/date-format'
import { loadWorkflowDocumentHistoryGrid } from '@/lib/system-document-storage'
import { useAccess } from '@/lib/security-context'
import { useSystemDocumentContext } from '@/lib/use-system-document-context'
import { usePagePagination } from '@/lib/use-page-pagination'
import { useRequestConclusionSettings } from '@/lib/request-conclusion-settings'
import { isDocumentHistoryGroupRow } from '@/lib/document-history-grid'
import { buildWeldColumnValueFilter } from '@/lib/weld-column-choice-filter'
import { getSystemDocumentId, isSystemDocumentNameForRows, type SystemDocumentReference, type SystemDocumentSummary } from '@/lib/system-document-types'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WorkflowRootCauseAction } from '@/lib/workflow-root-cause-actions'

export type WorkflowDocumentsPanelProps = {
  choices: WorkflowDocumentChoice[]
  target: SystemDocumentReference | null
  openRequestId?: number
  /** Explicit selected-joint scope; undefined means the entire server registry. */
  references?: SystemDocumentReference[]
  disabled?: boolean
  disabledReason?: string
  onMessage?: (message: string) => void
  onSaved?: (reference: SystemDocumentReference) => void
  onSavingChange?: (saving: boolean) => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
  onOpenJournalRows: (rows: readonly WeldRow[], label: string) => void
}

export function WorkflowDocumentsPanel({ target, openRequestId, choices, references, ...callbacks }: WorkflowDocumentsPanelProps) {
  const [choiceKey, setChoiceKey] = useState(choices[0].key)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<SystemDocumentReference | null>(target)
  const [editRequested, setEditRequested] = useState(Boolean(target))
  const choice = choices.find(item => item.key === choiceKey) ?? choices[0]
  const workflowArea = workflowDocumentReferenceArea({ type: choice.type, methodCode: choice.method })
  const targetKey = JSON.stringify(target)
  useEffect(() => {
    if (!target) return
    setSelected(target)
    setEditRequested(true)
    const matching = choices.find(item => item.type === target.type && (!item.method || item.method === target.methodCode))
    if (matching) setChoiceKey(matching.key)
    setPage(1)
    setSearch('')
  }, [targetKey, openRequestId])
  const columnFilters = {
    ...(choice.stage ? { stage: buildWeldColumnValueFilter([choice.stage]) } : {}),
    ...(choice.method ? { method: buildWeldColumnValueFilter([choice.method]) } : {}),
  }
  const query = useQuery({
    queryKey: ['workflow-document-registry', workflowArea, choice, search, page],
    queryFn: () => loadWorkflowDocumentHistoryGrid({ workflowArea, type: choice.type, columnFilters,
      search, startRow: (page - 1) * 50, endRow: page * 50, rowGroupCols: [], groupKeys: [], sortModel: [{ colId: 'date', sort: 'desc' }],
    }),
    enabled: references === undefined, staleTime: 30_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const scoped = useMemo(() => references ? [...new Map(references.filter(ref => ref.type === choice.type && (!choice.method || ref.methodCode === choice.method))
    .map(ref => [getSystemDocumentId(ref), ref])).values()]
    .filter(ref => `${ref.title} ${formatDisplayDate(ref.date)} ${ref.methodCode ?? ''}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'ru')) : [], [references, choice, search])
  const documents = references ? scoped.slice((page - 1) * 50, page * 50) : (query.data?.rows ?? []).filter((row): row is SystemDocumentSummary => !isDocumentHistoryGroupRow(row))
  const total = references ? scoped.length : query.data?.total ?? 0
  const firstDocument = documents[0] ?? null
  useEffect(() => {
    if (firstDocument) setSelected(current => current ?? firstDocument)
  }, [firstDocument, selected])
  const active = selected ?? firstDocument
  const editRequestToken = editRequested && target && active && getSystemDocumentId(active) === getSystemDocumentId(target)
    ? openRequestId || targetKey : undefined
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
    <aside className="flex min-h-48 shrink-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:min-h-0 lg:border-b-0 lg:border-r">
      <div className="space-y-3 border-b border-slate-200 p-4">
        <p className="text-sm font-semibold">{references ? 'Документы выбранных стыков' : 'Все документы этого раздела'}</p>
        {choices.length > 1 ? <Select aria-label="Вид документа" value={choice.key} onChange={event => { setChoiceKey(event.target.value); setSelected(null); setEditRequested(false); setPage(1) }}>
          {choices.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </Select> : <p className="text-xs text-slate-500">{choice.label}{choice.stage ? ` · ${choice.stage}` : ''}</p>}
        <BufferedFilterInput value={search} onValueChange={value => { setSearch(value); setPage(1) }} placeholder="Поиск документов" />
        <div className="flex items-center justify-between gap-2"><p className="text-xs text-slate-500">Найдено документов: {total}</p>
          {!references ? <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch().then(result => {
            const refreshed = result.data?.rows.find(item => !isDocumentHistoryGroupRow(item) && item.documentId === selected?.documentId)
            if (refreshed && !isDocumentHistoryGroupRow(refreshed)) setSelected(current => current?.documentId === selected?.documentId ? refreshed : current)
          })}>Обновить список</Button> : null}</div>
      </div>
      <div className="max-h-64 min-h-0 space-y-1 overflow-auto p-2 lg:max-h-none lg:flex-1">
        {!references && query.isPending ? <p className="p-3 text-sm text-slate-500">Загрузка списка…</p> : null}
        {!references && query.isError ? <div className="p-3 text-sm text-rose-700">Не удалось загрузить документы.<Button variant="outline" onClick={() => void query.refetch()}>Повторить</Button></div> : null}
        {documents.map(document => <button key={getSystemDocumentId(document)} type="button" onClick={() => { setSelected(document); setEditRequested(false) }}
          className={`w-full space-y-1 rounded-md border p-3 text-left ${active && getSystemDocumentId(active) === getSystemDocumentId(document) ? 'border-sky-300 bg-white ring-1 ring-sky-100' : 'border-transparent hover:bg-white'}`}>
          <span className="block break-words text-sm font-medium text-slate-900">{document.title}</span>
          <span className="block text-xs text-slate-500">{formatDisplayDate(document.date) || 'Без даты'}{document.methodCode ? ` · ${document.methodCode}` : ''}</span>
        </button>)}
        {total === 0 && !query.isFetching ? <p className="p-3 text-sm text-slate-500">Документы не найдены.</p> : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-slate-500">
        <Button size="sm" variant="outline" aria-label="Предыдущая страница документов" disabled={page <= 1 || query.isFetching} onClick={() => setPage(page - 1)}>Назад</Button>
        <span>{page} из {Math.max(1, Math.ceil(total / 50))}</span>
        <Button size="sm" variant="outline" aria-label="Следующая страница документов" disabled={page * 50 >= total || query.isFetching} onClick={() => setPage(page + 1)}>Далее</Button>
      </div>
    </aside>
    <main className="min-w-0 shrink-0 p-4 sm:p-6 lg:overflow-auto">
      {active ? <DocumentDetails key={JSON.stringify([getSystemDocumentId(active), active.title, active.date])} reference={active} editRequestToken={editRequestToken} {...callbacks}
        onSavedReference={reference => {
          setSelected(current => current && getSystemDocumentId(current) === getSystemDocumentId(active) ? reference : current)
          callbacks.onSaved?.(reference)
        }} />
        : <p className="text-sm text-slate-500">Выберите документ слева.</p>}
    </main>
  </div>
}

function DocumentDetails({ reference, editRequestToken, disabled, disabledReason, onMessage, onSavingChange, onRunRootCauseAction, onOpenJournalRows, onSavedReference }: Omit<WorkflowDocumentsPanelProps, 'choices' | 'target' | 'references'> & {
  reference: SystemDocumentReference
  editRequestToken?: string | number
  onSavedReference: (reference: SystemDocumentReference) => void
}) {
  const { can } = useAccess()
  const area = workflowDocumentReferenceArea(reference)
  const editAllowed = can(`${area}.edit`)
  const permissionReason = editAllowed ? undefined : `Нет права изменения в ${area === 'lnk' ? 'ЛНК' : 'ПСТО'}. Обратитесь к администратору.`
  const context = useSystemDocumentContext(reference)
  const settings = useRequestConclusionSettings()
  const rows = context.data?.rows ?? []
  const pagination = usePagePagination({ items: rows, defaultPageSize: 25, resetKeys: [getSystemDocumentId(reference)] })
  const isRequest = reference.type.endsWith('Request')
  const nameReadOnlyReason = isRequest && reference.sourceKind !== 'beforeHeatTreatment' && isSystemDocumentNameForRows(rows, reference.type, reference.title, settings)
    ? 'Системную заявку нельзя переименовать. Дату можно изменить отдельно от названия.' : undefined
  return <div className="space-y-5">
    <header className="space-y-2">
      <p className="text-xs font-medium text-sky-700">{isRequest ? 'Заявка' : reference.type === 'pstoConclusion' ? 'Диаграмма' : 'Заключение'} · весь документ</p>
      <h3 className="break-words text-lg font-semibold text-slate-900">{reference.title}</h3>
      <p className="text-sm text-slate-500">Дата: {formatDisplayDate(reference.date) || 'не указана'} · Стыков: {context.isPending ? '…' : rows.length}</p>
      <DocumentConnectionsButton reference={reference} />
    </header>
    <ManagerEditPanel title="Реквизиты документа" requestToken={editAllowed ? editRequestToken : undefined} disabled={disabled || !editAllowed || context.isPending || context.isError}>
      <ManagerEditSection title="Редактирование документа" description="Дата и название меняются у всего документа. Проверяются все входящие в него стыки; при ошибке ни одна позиция не изменится.">
        <SystemDocumentDateEditor reference={reference} autoFocus={Boolean(editRequestToken)} label="Дата документа" nameLabel="Название документа"
          nameReadOnlyReason={nameReadOnlyReason} disabled={disabled} disabledReason={disabledReason}
          onMessage={onMessage} onSavingChange={onSavingChange} onRunRootCauseAction={onRunRootCauseAction} onSaved={result => onSavedReference(result.nextReference)} />
      </ManagerEditSection>
    </ManagerEditPanel>
    {permissionReason ? <p className="text-xs text-slate-500">{permissionReason}</p> : null}
    {disabledReason ? <p className="text-xs text-amber-700">{disabledReason}</p> : null}
    <section aria-label="Полный состав документа" className="overflow-hidden rounded-lg border border-slate-200">
      <h4 className="border-b bg-slate-50 p-3 text-sm font-semibold">Состав документа</h4>
      {context.isPending ? <p className="p-3 text-sm text-slate-500">Загрузка полного состава…</p> : context.isError ? <div className="p-3 text-sm text-rose-700">Не удалось загрузить состав. <Button variant="outline" onClick={() => void context.refetch()}>Повторить</Button></div>
        : <>
          {pagination.pageItems.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{String(row.line ?? '-')} · {String(row.joint ?? '-')}</p><p className="text-xs text-slate-500">{String(row.projectTitle ?? '')} · {String(row.subtitleCode ?? '')}</p></div>
            {can('welding.view') ? <Button size="sm" variant="ghost" onClick={() => onOpenJournalRows([row], `Документ ${reference.title}`)}>Показать стык в журнале</Button> : null}
          </div>)}
          {rows.length === 0 ? <p className="p-3 text-sm text-slate-500">В документе нет стыков.</p> : null}
          <DialogRowPagination {...pagination} totalCount={rows.length} onPreviousPage={pagination.goToPreviousPage} onNextPage={pagination.goToNextPage} onPageSizeChange={pagination.setPageSize} />
        </>}
    </section>
  </div>
}
