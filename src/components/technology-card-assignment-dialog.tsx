import { Select } from '@/components/ui/select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { useSecurityGuard } from '@/lib/security-context'
import { useConfirmAction } from '@/lib/confirm-action-context'
import {
  emptyTechnologyCardAssignmentCounts, isTechnologyCardAssignmentAction, TK_ASSIGNMENT_ACTIONS, TK_ASSIGNMENT_LABELS, TK_ASSIGNMENT_FILTER_LABELS,
  matchesTechnologyCardAssignmentFilter, technologyCardAssignmentFilterCount, type TechnologyCardAssignmentFilter,
  type TechnologyCardAssignmentAction, type TechnologyCardAssignmentChunk, type TechnologyCardAssignmentContext,
  type TechnologyCardAssignmentCounts, type TechnologyCardAssignmentProposal,
} from '@/lib/technology-card-assignment'
import { applyTechnologyCardAssignmentBatch, getTechnologyCardAssignmentDetails, previewTechnologyCardAssignments } from '@/server/technology-cards-api'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'

const PAGE_SIZE = 50
export function TechnologyCardAssignmentDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const confirm = useConfirmAction()
  const { requireEditPassword } = useSecurityGuard()
  const stop = useRef(false)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'initial' | 'scan' | 'preview' | 'apply' | 'result'>('initial')
  const [context, setContext] = useState<TechnologyCardAssignmentContext | null>(null)
  const [chunks, setChunks] = useState<TechnologyCardAssignmentChunk[]>([])
  const [counts, setCounts] = useState(emptyTechnologyCardAssignmentCounts)
  const [actions, setActions] = useState<TechnologyCardAssignmentAction[]>(['assign', 'rename'])
  const [excluded, setExcluded] = useState<Map<number, TechnologyCardAssignmentAction>>(new Map())
  const [chunkIndex, setChunkIndex] = useState(0)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<TechnologyCardAssignmentFilter>('all')
  const [details, setDetails] = useState<TechnologyCardAssignmentProposal[]>([])
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState({ assign: 0, reassign: 0, rename: 0 })
  const [processed, setProcessed] = useState(0)
  useEffect(() => () => { stop.current = true }, [])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])
  const selectedCount = useMemo(() => actions.reduce((sum, action) => sum + counts[action], 0) - [...excluded.values()].filter(kind => actions.includes(kind)).length, [actions, counts, excluded])
  const chunk = chunks[chunkIndex]
  const visibleChunkIndexes = useMemo(() => chunks.flatMap((part, index) => technologyCardAssignmentFilterCount(part.counts, filter) > 0 ? [index] : []), [chunks, filter])
  const chunkPosition = visibleChunkIndexes.indexOf(chunkIndex)
  const filteredChunkSize = chunk ? technologyCardAssignmentFilterCount(chunk.counts, filter) : 0
  const visibleDetails = details.filter(row => matchesTechnologyCardAssignmentFilter(row, filter))
  useEffect(() => {
    if (!context || phase !== 'preview') return
    if (!chunk) { setDetails([]); setDetailsBusy(false); return }
    let active = true
    setDetailsBusy(true); setDetails([])
    void getTechnologyCardAssignmentDetails({ data: { context, chunk } }).then(rows => { if (active) setDetails(rows) })
      .catch(cause => { if (active) setError((cause as Error).message) })
      .finally(() => { if (active) setDetailsBusy(false) })
    return () => { active = false }
  }, [context, chunk, phase])

  async function scan() {
    if (running.current) return
    running.current = true; stop.current = false; setBusy(true); setPhase('scan'); setError('')
    setChunks([]); setContext(null); setCounts(emptyTechnologyCardAssignmentCounts()); setExcluded(new Map()); setChunkIndex(0); setPage(0); setFilter('all'); setDetails([]); setResult({ assign: 0, reassign: 0, rename: 0 }); setProcessed(0)
    let cursor = 0
    let snapshot: TechnologyCardAssignmentContext | undefined
    const collected: TechnologyCardAssignmentChunk[] = []
    const totals = emptyTechnologyCardAssignmentCounts()
    try {
      do {
        const batch = await previewTechnologyCardAssignments({ data: { context: snapshot, afterId: cursor } })
        snapshot = batch.context; collected.push(...batch.chunks)
        for (const part of batch.chunks) for (const kind of Object.keys(totals) as Array<keyof TechnologyCardAssignmentCounts>) totals[kind] += part.counts[kind]
        setCounts({ ...totals })
        if (stop.current) { setPhase('initial'); return }
        if (batch.nextCursor === null) break
        cursor = batch.nextCursor
      } while (true)
      setContext(snapshot!); setChunks(collected); setPhase('preview')
    } catch (cause) { setError((cause as Error).message); setPhase('initial') }
    finally { running.current = false; setBusy(false) }
  }

  async function apply() {
    if (running.current || !context || phase !== 'preview' || selectedCount <= 0) return
    running.current = true; setBusy(true)
    let attempted = false
    try {
      if (!await requireEditPassword('назначение технологических карт')) return
      if (!await confirm({ title: 'Применить изменения ТК?', tone: 'warning', description: `Выбрано стыков: ${selectedCount}. Изменения затронут весь журнал, включая уже заваренные стыки и данные в предпросмотре документов.`, warning: 'Сохранение идёт порциями до 500 стыков. При остановке или конфликте уже сохранённые порции не отменяются.', confirmLabel: 'Применить изменения' })) return
      stop.current = false; setPhase('apply'); setError('')
      const totals = { assign: 0, reassign: 0, rename: 0 }
      let completed = 0
      for (const part of chunks) {
        if (stop.current) break
        const excludedIds = [...excluded.keys()].filter(id => id > part.afterId && id <= part.throughId)
        const eligible = actions.reduce((sum, action) => sum + part.counts[action], 0) - excludedIds.filter(id => actions.includes(excluded.get(id)!)).length
        if (eligible > 0) {
          attempted = true
          const saved = await applyTechnologyCardAssignmentBatch({ data: { context, chunk: part, actions, excludedIds } })
          for (const action of TK_ASSIGNMENT_ACTIONS) totals[action] += saved[action]
          setResult({ ...totals })
        }
        completed++; setProcessed(completed)
      }
      if (stop.current) setError('Остановлено после текущей порции. Уже сохранённые изменения не отменены. Для оставшихся стыков запустите новую проверку.')
    } catch (cause) {
      setError(`${(cause as Error).message} При потере связи результат последней порции может быть неизвестен. Новая проверка покажет фактическое состояние и не повторит выполненные назначения.`)
    } finally {
      if (attempted) {
        setPhase('result')
        // One refresh after the operation, not per row/chunk.
        scheduleWeldDataRefresh(client)
      }
      running.current = false; setBusy(false)
    }
  }

  return <LargeDialogShell ariaLabel="Проверка и назначение ТК" maxWidthClassName="max-w-[1200px]" panelClassName="overflow-hidden">
    <header className="flex items-start justify-between gap-3 border-b px-5 py-4"><div><h2 className="text-lg font-semibold">Проверить и назначить ТК</h2><p className="mt-1 text-sm text-slate-500">Весь журнал · все проекты · включая уже заваренные стыки</p></div><Button variant="ghost" size="icon" disabled={busy} aria-label="Закрыть проверку ТК" onClick={onClose}><X className="h-5 w-5" /></Button></header>
    <div className="min-h-0 space-y-4 overflow-y-auto p-5">
      <p className="text-sm text-slate-600">Проверка ничего не сохраняет. Выберите действия и исключите отдельные стыки перед применением. Причина пропуска указана в строке.</p>
      <div className="grid gap-2 sm:grid-cols-3">{TK_ASSIGNMENT_ACTIONS.map(action => <label key={action} className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${actions.includes(action) ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-slate-50'}`}>
        <input type="checkbox" aria-label={TK_ASSIGNMENT_LABELS[action]} checked={actions.includes(action)} disabled={busy || phase === 'result'} onChange={event => setActions(current => event.target.checked ? [...current, action] : current.filter(value => value !== action))} />
        <span className="flex-1 text-sm font-medium">{TK_ASSIGNMENT_LABELS[action]}<span className="block text-xs font-normal text-slate-500">{action === 'assign' ? 'ТК не заполнена' : action === 'reassign' ? 'Включая прежний ручной выбор' : 'Та же карта, новое название'}</span></span><strong className="text-xl">{counts[action]}</strong>
      </label>)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">{(['ambiguous', 'none', 'incomplete', 'unchanged', 'excluded'] as const).map(kind => <span key={kind}>{TK_ASSIGNMENT_LABELS[kind]}: <b>{counts[kind]}</b></span>)}<span>Несоответствий заполненных ТК: <b>{counts.mismatch}</b></span></div>
      <p className="text-xs text-slate-500">Несоответствия входят в замены, неоднозначные или «нет подходящей ТК». Подходящую назначенную карту сохраняем, даже если есть другие варианты или она в архиве.</p>
      {error && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {phase === 'scan' && <p role="status" className="text-sm text-sky-700">Проверяем журнал… Обработано {Object.entries(counts).filter(([key]) => key !== 'mismatch').reduce((sum, [, value]) => sum + value, 0)} стыков.</p>}
      {phase === 'preview' && <>
        <div className="flex flex-wrap items-center gap-3"><label className="grid w-full gap-1 text-sm text-slate-700 sm:flex sm:w-auto sm:items-center sm:gap-2">Показать стыки<Select className="w-full min-w-0 max-w-full rounded-md border-slate-200 text-sm sm:w-auto" disabled={busy} value={filter} onChange={event => {
          const next = event.target.value as TechnologyCardAssignmentFilter
          setFilter(next); setPage(0); setChunkIndex(chunks.findIndex(part => technologyCardAssignmentFilterCount(part.counts, next) > 0))
        }}>{Object.entries(TK_ASSIGNMENT_FILTER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><span className="text-xs text-slate-500">Фильтр таблицы не меняет выбор для применения.</span></div>
        <div className="overflow-x-auto rounded-md border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Выбор', 'Проект / линия / стык', 'Было → станет', 'Результат проверки'].map(label => <th className="px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
          {visibleDetails.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <tr key={row.id} className="border-t"><td className="px-3 py-2">{isTechnologyCardAssignmentAction(row.kind) ? <input aria-label={`Назначение ТК стыку ${row.id}`} type="checkbox" disabled={busy || !actions.includes(row.kind)} checked={actions.includes(row.kind) && !excluded.has(row.id)} onChange={event => setExcluded(current => { const next = new Map(current); if (event.target.checked) next.delete(row.id); else next.set(row.id, row.kind as TechnologyCardAssignmentAction); return next })} /> : '—'}</td><td className="px-3 py-2"><span className="block text-xs text-slate-500">{row.project || 'Без проекта'}</span>{row.line || '—'} / {row.joint || '—'}<span className="block text-xs text-slate-400">ID {row.id}</span></td><td className="px-3 py-2">{row.oldName || 'Не заполнена'}{isTechnologyCardAssignmentAction(row.kind) && <><span className="block text-slate-400">↓</span><span className="font-medium text-sky-800">{row.newName}</span></>}</td><td className="max-w-md px-3 py-2"><span className="font-medium">{TK_ASSIGNMENT_LABELS[row.kind]}</span><p className="mt-1 text-xs text-slate-500">{row.reason}</p></td></tr>)}
        </tbody></table>{detailsBusy ? <p className="p-4 text-sm">Загружаем стыки…</p> : !visibleDetails.length && <p className="p-4 text-sm text-slate-500">Стыков нет.</p>}</div>
        {visibleChunkIndexes.length > 0 && <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy || detailsBusy || (chunkPosition === 0 && page === 0)} onClick={() => {
            if (page) setPage(page - 1)
            else { const previous = visibleChunkIndexes[chunkPosition - 1]; setChunkIndex(previous); setPage(Math.ceil(technologyCardAssignmentFilterCount(chunks[previous].counts, filter) / PAGE_SIZE) - 1) }
          }}>Назад</Button>
          <span className="text-xs text-slate-500">Порция {chunkPosition + 1} из {visibleChunkIndexes.length} · страница {page + 1} из {Math.ceil(filteredChunkSize / PAGE_SIZE)} · по {PAGE_SIZE} стыков</span>
          <Button variant="outline" disabled={busy || detailsBusy || (chunkPosition === visibleChunkIndexes.length - 1 && (page + 1) * PAGE_SIZE >= filteredChunkSize)} onClick={() => {
            if ((page + 1) * PAGE_SIZE < filteredChunkSize) setPage(page + 1)
            else { setChunkIndex(visibleChunkIndexes[chunkPosition + 1]); setPage(0) }
          }}>Далее</Button>
        </div>}
      </>}
      {(phase === 'apply' || phase === 'result') && <div role="status" className="rounded-md bg-slate-50 p-4 text-sm"><p className="font-semibold">{phase === 'apply' ? 'Сохраняем изменения…' : 'Результат операции'}</p><p className="mt-2">Назначено: {result.assign} · Заменено: {result.reassign} · Названия обновлены: {result.rename}</p><p className="mt-1 text-slate-500">Обработано порций: {processed} из {chunks.length}. Показаны подтверждённые сервером изменения.</p></div>}
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"><span className="text-sm text-slate-500">{phase === 'preview' ? `Выбрано к изменению: ${selectedCount}` : 'Без фонового назначения и журнала изменений'}</span><div className="flex flex-wrap gap-2">{busy ? <Button variant="outline" onClick={() => { stop.current = true }}>Остановить после текущей порции</Button> : <><Button variant="outline" onClick={onClose}>Закрыть</Button><Button variant="outline" onClick={() => void scan()}>{phase === 'initial' ? 'Начать проверку' : 'Проверить заново'}</Button>{phase === 'preview' && <Button disabled={selectedCount <= 0 || detailsBusy} onClick={() => void apply()}>Применить выбранное ({selectedCount})</Button>}</>}</div></footer>
  </LargeDialogShell>
}
