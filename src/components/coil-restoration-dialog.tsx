import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { previewCoilRestoration, restoreErroneousCoil, getCoilRestorationHistory, previewEarlyCoilCorrection, cancelErroneousEarlyCoil } from '@/server/coil-restoration'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { formatDateTimeWithSeconds } from '@/lib/weld-table-formatting'
import { CoilCorrectionChecklist, type CoilCorrectionReportHandler } from './coil-correction-checklist'

export function CoilRestorationDialog({ rootId, onClose, onSaved, earlyDecision = false, onOpenReport, onRestored }: { rootId: number; onClose: () => void; onSaved: (message: string) => void; earlyDecision?: boolean; onOpenReport?: CoilCorrectionReportHandler; onRestored?: () => void }) {
  const queryClient = useQueryClient()
  const { requireEditPassword, requireDeletePassword, requireSettingsChangePassword } = useSecurityGuard()
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [earlySourceId, setEarlySourceId] = useState<number | null>(null)
  const isEarly = earlyDecision || earlySourceId != null
  const requestId = earlySourceId ?? rootId
  const close = () => {
    if (earlySourceId != null) { setEarlySourceId(null); setConfirmed(false); setError('') }
    else onClose()
  }
  const inFlight = useRef(false)
  const preview = useQuery({ queryKey: ['coil-restoration-preview', requestId, isEarly], queryFn: () => (isEarly ? previewEarlyCoilCorrection : previewCoilRestoration)({ data: { rootId: requestId } }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !inFlight.current) { event.stopImmediatePropagation(); close() } }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [onClose, earlySourceId])
  const data = preview.data
  const title = isEarly ? 'Отменить ошибочное досрочное решение' : 'Отменить ошибочно внесённую катушку'
  return <LargeDialogShell ariaLabel={title} maxWidthClassName="max-w-3xl" overlayClassName="z-[90] bg-slate-950/30">
    <div className="space-y-4 overflow-y-auto p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p>Это исправление ошибочной записи, не отмена реально выполненной врезки. Если катушку физически врезали, восстановите её записи.</p>
      {isEarly ? <p>Будут удалены только очищенные записи сторон и отменено досрочное решение. Если физическая замена уже была записана, исходное соединение останется вырезанным: исправьте цепочку по ДЗ, затем отдельно подтвердите восстановление через СП-04. Закрытие окна ничего не меняет.</p> : <p>Помощник показывает оставшиеся действия. «Отмена» и Escape ничего не записывают; существующие задачи остаются. СП-04 нельзя принять как исключение или скрыть подтверждением.</p>}
      {preview.isFetching ? <p>Проверяем сохранённую цепочку и расчёт…</p> : preview.error ? <p role="alert">{preview.error.message}</p> : data ? <>
        <p className="font-medium">{data.line} · {data.joint}</p>
        <p>Связанные записи: {data.chain.map(row => row.joint).join(', ')}</p>
        {!isEarly && data.checklist ? <fieldset disabled={busy}><CoilCorrectionChecklist data={data.checklist} reason={data.reason}
          onOpenReport={onOpenReport ? (rows, report) => { onClose(); onOpenReport(rows, report) } : undefined}
          onEarlyCorrection={id => { setConfirmed(false); setError(''); setEarlySourceId(id) }} /></fieldset> : null}
        {data.reason ? <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{data.reason}</p> : <>
          <p>Физические соединения: <strong>{data.before.joints} → {data.after.joints}</strong>. Для процентного расчёта: {data.before.calculationJoints} → {data.after.calculationJoints}.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Клеймо</th><th>Соединения</th><th>Норма РК/УЗК</th><th>Норма ПВК</th><th>К назначению</th></tr></thead><tbody>
            {data.stampChanges.map(change => <tr key={change.stamp}><td>{change.stamp || 'Вся линия'}</td>{(['joints', 'common', 'pvk', 'missing'] as const).map(key => <td key={key}>{change.before[key]} → {change.after[key]}</td>)}</tr>)}
          </tbody></table></div>
          {!data.before.common ? <p>Программа линии не настроена: норму пока рассчитать нельзя.</p> : null}
          <p>{isEarly ? 'Результатов, документов и даты сварки у удаляемых сторон быть не должно. Их пустые назначения будут удалены вместе со строками.' : 'Назначения, результаты и документы не изменятся.'} Будет отменено решений о досрочной катушке этой ветки: {data.cancelledEarlyDecisions}.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Катушка фактически не врезалась; исправляется ошибочная запись</label>
        </>}
      </> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {data ? <CoilRestorationHistory key={data.rootId} rootId={data.rootId} /> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>{earlySourceId != null ? 'Назад к помощнику' : 'Отмена'}</Button>
        <Button variant="outline" disabled={busy || preview.isFetching} onClick={() => { setConfirmed(false); setError(''); void preview.refetch() }}>Повторить проверку</Button>
        <Button disabled={busy || preview.isFetching || !data || !!data.reason || !confirmed} onClick={async () => {
          if (inFlight.current || !data) return
          inFlight.current = true; setBusy(true); setError('')
          try {
            if (isEarly) {
              if (!await requireSettingsChangePassword() || !await requireDeletePassword('удаление очищенных сторон ошибочной катушки')) return
            } else if (!await requireEditPassword('отмена ошибочно внесённой катушки')) return
            const result = await (isEarly ? cancelErroneousEarlyCoil : restoreErroneousCoil)({ data: { rootId: requestId, token: data.token, confirmedNotInstalled: confirmed } })
            scheduleWeldDataRefresh(queryClient)
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'], refetchType: 'active' }),
              queryClient.invalidateQueries({ queryKey: ['coil-restoration-history', data.rootId], refetchType: 'active' }),
              queryClient.invalidateQueries({ queryKey: ['coil-restoration-preview'], refetchType: 'none' })])
            onSaved(result.alreadyApplied ? 'Это подтверждение уже выполнено. Данные обновлены.' : isEarly ? 'Ошибочное досрочное решение отменено, очищенные стороны удалены. Продолжите исправление по ДЗ; физическое восстановление отдельно подтверждается через СП-04.' : 'Ошибочная катушка отменена. Исходное соединение восстановлено; подтверждение сохранено в истории.')
            if (!isEarly) onRestored?.()
            close()
          } catch (cause) { setError((cause as Error).message); setConfirmed(false) }
          finally { inFlight.current = false; setBusy(false) }
        }}>{isEarly ? 'Отменить решение и удалить очищенные стороны' : 'Восстановить исходное соединение'}</Button>
      </div>
    </div>
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
