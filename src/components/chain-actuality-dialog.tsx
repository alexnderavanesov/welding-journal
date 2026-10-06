import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { previewChainActuality, setChainActuality } from '@/server/chain-actuality'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'

export function ChainActualityDialog({ rowId, active, onClose, onSaved }: { rowId: number; active: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient(), { requireEditPassword } = useSecurityGuard()
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false)
  const [page, setPage] = useState(0)
  const preview = useQuery({ queryKey: ['chain-actuality-preview', rowId, active, page], queryFn: () => previewChainActuality({ data: { rowId, active, page } }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!inFlight.current) onClose() } }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [onClose])
  const data = preview.data, single = data?.total === 1
  const title = single
    ? active ? 'Вернуть актуальность стыку' : 'Сделать стык неактуальным'
    : active ? 'Вернуть актуальность цепочке' : 'Сделать цепочку неактуальной'
  return <LargeDialogShell ariaLabel={title} maxWidthClassName="max-w-3xl" overlayClassName="z-[90] bg-slate-950/30">
    <div className="space-y-4 overflow-y-auto p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {data ? <>
        <p>{single
          ? active ? 'Стык снова станет актуальным по ИЗМу.' : 'Стык станет неактуальным по ИЗМу.'
          : active ? 'Все перечисленные записи снова станут актуальными по ИЗМу.' : 'Все перечисленные записи станут неактуальными по ИЗМу.'} Документы, результаты НК, назначения, официальность и факт выреза сохранятся.</p>
        {!single ? <p>Изменение относится к одному физическому соединению: исходному стыку, его ремонтам и R/W-продолжениям, включая неофициальные записи. Каждая сторона катушки — отдельное соединение со своей историей. Другие соединения этим действием не изменяются.</p> : null}
      </> : null}
      <p>Отмена и Escape ничего не сохраняют.</p>
      {preview.isFetching ? <p>Проверяем состав цепочки…</p> : preview.error ? <p role="alert">{preview.error.message}</p> : data ? <>
        <p>{single ? `Стык: ${data.rows[0]?.joint}.` : `Записей в цепочке: ${data.total}.`} Будет изменено: {data.changedCount}. Новая актуальность: {active ? 'актуален' : 'не актуален'}.</p>
        <div className="max-h-64 overflow-y-auto"><table className="w-full text-left text-sm"><thead><tr><th>Стык / ID</th><th>Официальность</th><th>Сейчас</th></tr></thead><tbody>
          {data.rows.map(row => <tr key={row.id}><td>{row.joint} / {row.id}</td><td>{row.officiality || 'официальный'}</td><td>{row.inactive ? 'не актуален' : 'актуален'}</td></tr>)}
        </tbody></table></div>
        {data.total > 100 ? <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy || data.page === 0} onClick={() => { setConfirmed(false); setPage(data.page - 1) }}>Предыдущие записи</Button>
          <span>Страница {data.page + 1} из {Math.ceil(data.total / 100)}</span>
          <Button variant="outline" disabled={busy || (data.page + 1) * 100 >= data.total} onClick={() => { setConfirmed(false); setPage(data.page + 1) }}>Следующие записи</Button>
        </div> : null}
        {data.reason ? <p role="alert">{data.reason}</p> : data.changedCount ? <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{single ? 'Подтверждаю изменение актуальности этого стыка' : 'Состав цепочки проверен; подтверждаю изменение актуальности всех перечисленных записей'}</label> : <p>{single ? 'Стык уже имеет выбранную актуальность. Изменения не нужны.' : 'Все записи уже имеют выбранную актуальность. Изменения не нужны.'}</p>}
      </> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
        <Button variant="outline" disabled={busy || preview.isFetching} onClick={() => { setConfirmed(false); setError(''); void preview.refetch() }}>Повторить проверку</Button>
        <Button disabled={busy || preview.isFetching || !data || !!data.reason || !data.changedCount || !confirmed} onClick={async () => {
          if (inFlight.current || !data) return
          inFlight.current = true; setBusy(true); setError('')
          try {
            if (!await requireEditPassword('изменение актуальности цепочки')) return
            const result = await setChainActuality({ data: { rowId, active, token: data.token, confirmed } })
            scheduleWeldDataRefresh(queryClient)
            await queryClient.invalidateQueries({ queryKey: ['weld-joint-chain'], refetchType: 'active' })
            onSaved(`Актуальность ${single ? 'стыка' : 'цепочки'} изменена. Обновлено записей: ${result.changedCount}. История работ сохранена.`); onClose()
          } catch (cause) { setError((cause as Error).message); setConfirmed(false) }
          finally { inFlight.current = false; setBusy(false) }
        }}>Подтвердить актуальность {single ? 'стыка' : 'цепочки'}</Button>
      </div>
    </div>
  </LargeDialogShell>
}
