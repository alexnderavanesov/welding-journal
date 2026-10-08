import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { previewCoilRestoration, restoreErroneousCoil, getCoilRestorationHistory, previewEarlyCoilCorrection, cancelErroneousEarlyCoil } from '@/server/coil-restoration'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'
import { CoilCorrectionChecklist, type CoilCorrectionReportHandler } from './coil-correction-checklist'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from '@/lib/dispatcher-accepted-warning-query'

type CorrectionPreview = Awaited<ReturnType<typeof previewCoilRestoration>> | Awaited<ReturnType<typeof previewEarlyCoilCorrection>>
function isEarlyCorrectionPreview(data: CorrectionPreview): data is Awaited<ReturnType<typeof previewEarlyCoilCorrection>> {
  return data.operation === 'cancel-early'
}

export function CoilRestorationDialog({ rootId, onClose, onSaved, earlyDecision = false, onOpenReport, onRestored, onCancellationSaved }: { rootId: number; onClose: () => void; onSaved: (message: string) => void; earlyDecision?: boolean; onOpenReport?: CoilCorrectionReportHandler; onRestored?: () => void; onCancellationSaved?: (restorationRootId: number | null) => void }) {
  const queryClient = useQueryClient()
  const { requireEditPassword, requireDeletePassword, requireSettingsChangePassword } = useSecurityGuard()
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [earlySourceId, setEarlySourceId] = useState<number | null>(null)
  const [restorationRootId, setRestorationRootId] = useState<number | null>(null)
  const isEarly = restorationRootId == null && (earlyDecision || earlySourceId != null)
  const requestId = restorationRootId ?? earlySourceId ?? rootId
  const close = () => {
    if (earlySourceId != null && restorationRootId == null) { setEarlySourceId(null); setConfirmed(false); setError('') }
    else onClose()
  }
  const inFlight = useRef(false)
  const preview = useQuery<CorrectionPreview>({ queryKey: ['coil-restoration-preview', requestId, isEarly], queryFn: async () => (isEarly ? previewEarlyCoilCorrection : previewCoilRestoration)({ data: { rootId: requestId } }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !inFlight.current) { event.stopImmediatePropagation(); close() } }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [onClose, earlySourceId, restorationRootId])
  const data = preview.data
  const earlyData = data && isEarlyCorrectionPreview(data) ? data : null
  const title = isEarly ? 'Отмена решения о досрочной катушке' : 'Отменить ошибочно внесённую катушку'
  return <LargeDialogShell ariaLabel={title} maxWidthClassName="max-w-3xl" overlayClassName="z-[90] bg-slate-950/30">
    <header className="shrink-0 border-b px-5 py-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{isEarly ? 'Проверка записей → подтверждение отмены → восстановление, если требуется' : 'Проверка исходной цепочки и отдельное подтверждение восстановления'}</p>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
      {restorationRootId != null ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">Решение отменено. Исходное соединение ещё не восстановлено. Следующий шаг — исправить оставшиеся препятствия и отдельно подтвердить восстановление ниже. Закрытие окна не отменяет уже сохранённый шаг.</p> : null}
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">Это исправление ошибочной записи, не отмена реально выполненной врезки. Если катушку физически врезали, пользоваться этой отменой нельзя — восстановите достоверные записи катушки.</p>
      {!isEarly ? <p>Помощник показывает оставшиеся действия. «Закрыть» и Escape ничего не записывают; существующие задачи остаются. СП-09 нельзя принять как исключение или скрыть подтверждением.</p> : null}
      {preview.isFetching ? <p>Проверяем сохранённую цепочку и расчёт…</p> : preview.error ? <p role="alert">{preview.error.message}</p> : data ? <>
        <p className="font-medium">Линия: {data.line} · Исходный стык: {data.joint}{earlyData && earlyData.decisionJoint !== data.joint ? ` · Решение по стыку: ${earlyData.decisionJoint}` : ''}</p>
        <p>Связанные записи: {data.chain.map(row => row.joint).join(', ')}</p>
        {isEarly && earlyData ? <section aria-label="Последствия отмены решения" className="space-y-2 rounded-lg border border-slate-200 p-3">
          <h3 className="font-semibold">Что изменится после подтверждения</h3>
          <p>{earlyData.targetJoints.length ? `Будут удалены записи сторон: ${earlyData.targetJoints.join(', ')} — только после проверки, что они пустые.` : 'Сохранённых записей сторон для удаления нет.'}</p>
          <p>Решение о досрочной катушке будет отменено. Результаты, документы и даты сварки автоматически не очищаются.</p>
          <p>{data.checklist.replacedByCoil ? 'Замена уже зафиксирована: исходное соединение останется вырезанным. Следующим шагом в этом окне будет отдельная проверка восстановления по СП-09.' : 'Физическая замена не зафиксирована; отдельное восстановление не требуется. Диспетчер снова покажет дальнейшие действия по исходной цепочке.'}</p>
          {!data.reason ? <p className="font-medium text-emerald-800">{earlyData.cancellationMode === 'untouched' ? 'Стороны пустые и нетронутые. Отмена доступна.' : 'Стороны ранее редактировали, но препятствующих данных больше нет. Отмена доступна с подтверждением ошибочности записи.'}</p> : null}
        </section> : null}
        {data.checklist && (!isEarly || data.reason) ? <fieldset disabled={busy}><CoilCorrectionChecklist data={data.checklist} reason={data.reason} cancellingEarly={isEarly}
          onOpenReport={onOpenReport ? (rows, report) => { onClose(); onOpenReport(rows, report, { rootId: requestId, earlyDecision: isEarly }) } : undefined}
          onEarlyCorrection={id => { setConfirmed(false); setError(''); setRestorationRootId(null); setEarlySourceId(id) }} /></fieldset> : null}
        {data.reason ? <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{data.reason}</p> : <>
          <p>Физические соединения: <strong>{data.before.joints} → {data.after.joints}</strong>. Для процентного расчёта: {data.before.calculationJoints} → {data.after.calculationJoints}.</p>
          {data.stampChanges.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Клеймо</th><th>Соединения</th><th>Норма РК/УЗК</th><th>Норма ПВК</th><th>К назначению</th></tr></thead><tbody>
            {data.stampChanges.map(change => <tr key={change.stamp}><td>{change.stamp || 'Вся линия'}</td>{(['joints', 'common', 'pvk', 'missing'] as const).map(key => <td key={key}>{change.before[key]} → {change.after[key]}</td>)}</tr>)}
          </tbody></table></div> : null}
          {!data.before.common ? <p>Программа линии не настроена: норму пока рассчитать нельзя.</p> : null}
          <p>{isEarly ? 'Результатов, документов и даты сварки у удаляемых сторон быть не должно. Их пустые назначения будут удалены вместе со строками.' : 'Назначения, результаты и документы не изменятся.'} Будет отменено решений о досрочной катушке этой ветки: {data.cancelledEarlyDecisions}.</p>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="checkbox" className="mt-0.5" checked={confirmed} disabled={busy || !!error} onChange={event => setConfirmed(event.target.checked)} />Катушка фактически не врезалась; исправляется ошибочная запись</label>
        </>}
      </> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {data ? <CoilRestorationHistory key={data.rootId} rootId={data.rootId} /> : null}
    </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-slate-50 px-5 py-3"><Button variant="outline" disabled={busy} onClick={close}>{earlySourceId != null && restorationRootId == null ? 'Назад к помощнику' : 'Закрыть'}</Button>
        <Button variant="outline" disabled={busy || preview.isFetching} onClick={() => { setConfirmed(false); setError(''); void preview.refetch() }}>Повторить проверку</Button>
        <Button disabled={busy || preview.isFetching || !!preview.error || !!error || !data || !!data.reason || !confirmed} onClick={async () => {
          if (inFlight.current || !data) return
          inFlight.current = true; setBusy(true); setError('')
          try {
            if (isEarly) {
              if (!await requireSettingsChangePassword() || !await requireDeletePassword('удаление очищенных сторон ошибочной катушки')) return
            } else if (!await requireEditPassword('отмена ошибочно внесённой катушки')) return
            const input = { data: { rootId: requestId, token: data.token, confirmedNotInstalled: confirmed } }
            const result = isEarly ? await cancelErroneousEarlyCoil(input) : { ...await restoreErroneousCoil(input), restorationRootId: null }
            scheduleWeldDataRefresh(queryClient)
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'], refetchType: 'active' }),
              queryClient.invalidateQueries({ queryKey: ['coil-restoration-history', data.rootId], refetchType: 'active' }),
              queryClient.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, refetchType: 'active' }),
              queryClient.invalidateQueries({ queryKey: ['coil-restoration-preview'], refetchType: 'none' })])
            const nextRootId = result.restorationRootId
            onSaved(result.alreadyApplied ? 'Это подтверждение уже выполнено. Данные обновлены.' : isEarly ? `Решение о досрочной катушке отменено, очищенные стороны удалены.${nextRootId != null ? ' Исходное соединение ещё не восстановлено — продолжите проверку в этом окне.' : ''}` : 'Ошибочная катушка отменена. Исходное соединение восстановлено; подтверждение сохранено в истории.')
            if (!isEarly) onRestored?.()
            else onCancellationSaved?.(nextRootId)
            if (isEarly && nextRootId != null) {
              setConfirmed(false); setEarlySourceId(null); setRestorationRootId(nextRootId)
            } else close()
          } catch (cause) { setError((cause as Error).message); setConfirmed(false) }
          finally { inFlight.current = false; setBusy(false) }
        }}>{busy ? 'Сохраняем…' : isEarly ? 'Подтвердить отмену' : 'Восстановить исходное соединение'}</Button>
      </footer>
  </LargeDialogShell>
}

export function CoilRestorationHistory({ rootId }: { rootId: number }) {
  const [open, setOpen] = useState(false)
  const history = useQuery({ queryKey: ['coil-restoration-history', rootId], queryFn: () => getCoilRestorationHistory({ data: { rootId } }),
    staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  if (history.error) return <div className="text-sm"><p role="alert">Не удалось проверить историю отмен: {history.error.message}</p><Button variant="ghost" disabled={history.isFetching} onClick={() => void history.refetch()}>Повторить загрузку истории</Button></div>
  if (!history.data?.length) return null
  return <div className="text-sm"><Button variant="ghost" onClick={() => setOpen(value => !value)} aria-expanded={open}>История отмен ошибочной катушки</Button>
    {open ? <div className="space-y-2 p-2">{history.isFetching ? 'Загрузка…' : <>
      {history.data.map((item, index) => <p key={`${item.confirmedAt}:${index}`}>{formatDateTimeWithSeconds(item.confirmedAt)}{item.confirmedBy ? ` · ${item.confirmedBy}` : ''}: {item.operation === 'cancel-early' ? 'отменено ошибочное досрочное решение, без подтверждения физического восстановления' : 'подтверждено исправление ошибочной записи катушки'}, {item.counts}.</p>)}
    </>}</div> : null}
  </div>
}
