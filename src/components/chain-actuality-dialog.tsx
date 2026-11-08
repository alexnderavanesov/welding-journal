import { AlertTriangle, Info, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { previewChainActuality } from '@/server/chain-actuality'
import type { ChainActualityConfirmation } from '@/lib/chain-actuality'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { formatControlRequestRemovals } from '@/lib/control-request-removal-preview'

export function ChainActualityDialog({ rowId, active, onClose, onConfirm }: { rowId: number; active: boolean; onClose: () => void; onConfirm: (confirmation: ChainActualityConfirmation) => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [page, setPage] = useState(0)
  const preview = useQuery({ queryKey: ['chain-actuality-preview', rowId, active, page], queryFn: () => previewChainActuality({ data: { rowId, active, page } }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })

  const data = preview.data, single = data?.total === 1
  const title = single
    ? active ? 'Вернуть актуальность стыку' : 'Сделать стык неактуальным'
    : active ? 'Вернуть актуальность цепочке' : 'Сделать цепочку неактуальной'
  const NoticeIcon = active ? Info : AlertTriangle
  return <LargeDialogShell onEscape={onClose} ariaLabel={title} maxWidthClassName="max-w-3xl"
    panelRadiusClassName="rounded-xl" panelClassName="overflow-hidden" overlayClassName="z-[120] bg-slate-950/30">
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-6 text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">{single ? 'Проверьте последствия изменения.' : 'Единая актуальность для всех записей физического соединения.'}</p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="-mr-2 -mt-1 shrink-0 text-slate-400" aria-label="Закрыть" onClick={onClose}><X className="h-5 w-5" /></Button>
    </div>

    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
      {preview.isFetching ? <p role="status" className="py-6 text-center text-sm text-slate-500">Проверяем состав цепочки…</p> : preview.error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{preview.error.message}</p> : data ? <>
        <dl className="grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/70 py-3 text-sm">
          <div className="min-w-0 px-3 sm:px-4"><dt className="text-xs text-slate-500">Записей</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{data.total}</dd></div>
          <div className="min-w-0 px-3 sm:px-4"><dt className="text-xs text-slate-500">Изменится</dt><dd className="mt-1 font-semibold tabular-nums text-slate-900">{data.changedCount}</dd></div>
          <div className="min-w-0 px-3 sm:px-4"><dt className="text-xs text-slate-500">После сохранения</dt><dd className="mt-1 font-semibold text-sky-800">{active ? 'Актуален' : 'Не актуален'}</dd></div>
        </dl>

        <div role={!active && data.pendingRequestCount > 0 ? 'alert' : undefined}
          className={`flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${active ? 'border-sky-100 bg-sky-50/70 text-sky-950' : 'border-amber-200 bg-amber-50/80 text-amber-950'}`}>
          <NoticeIcon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-sky-600' : 'text-amber-600'}`} aria-hidden="true" />
          <div className="min-w-0 space-y-2 text-sm leading-5">
            <p className="font-semibold">{active ? 'Что будет с заявками' : 'Снятие стыков из заявок'}</p>
            {active ? <>
              <p>Снятые ранее позиции заявок автоматически не восстанавливаются.</p>
              <p className="text-slate-600">При переводе в «не актуален» стыки без результата исключаются из заявок. Если заявка становится пустой, она аннулируется и удаляется.</p>
            </> : <>
              <p>Стыки без результата будут исключены из заявок. Если в заявке не останется стыков, она будет аннулирована и удалена. Остальные позиции сохранятся.</p>
              {data.pendingRequestCount > 0 ? <>
                <p className="font-medium">Из заявок будут удалены позиции без результата: {data.pendingRequestCount}.</p>
                {data.requestRemovals.length || data.hiddenRemovalCount ? <div className="max-h-40 overflow-y-auto rounded-md border border-amber-200/70 bg-white/70 p-3 whitespace-pre-line">{formatControlRequestRemovals(data.requestRemovals, data.hiddenRemovalCount)}</div> : null}
                <p className="text-xs leading-5 text-amber-800">Сведения о заявке без сохранённого документа также будут очищены.</p>
              </> : <p className="text-slate-600">По текущей проверке позиций заявок к снятию нет.</p>}
            </>}
          </div>
        </div>
        <p className="text-sm leading-5 text-slate-600">Готовые результаты НК и ПСТО/ТВМТ, их заявки и заключения сохранятся. Назначения, официальность и факт выреза не изменятся.</p>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{single ? 'Стык' : 'Состав цепочки'}</h3>
          {!single ? <p className="text-xs leading-5 text-slate-500">Исходный стык, его R/W-продолжения и неофициальные повторы. Каждая сторона катушки — отдельное соединение со своей цепочкой.</p> : null}
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[420px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500"><tr><th className="px-3 py-2.5 font-medium">Стык / ID</th><th className="px-3 py-2.5 font-medium">Официальность</th><th className="px-3 py-2.5 font-medium">Сейчас</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{data.rows.map(row => <tr key={row.id} className="even:bg-slate-50/40">
                <td className="px-3 py-2.5 font-medium text-slate-800">{row.joint} / {row.id}</td>
                <td className="px-3 py-2.5 text-slate-500">{row.officiality || 'официальный'}</td>
                <td className="px-3 py-2.5"><span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${row.inactive ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{row.inactive ? 'не актуален' : 'актуален'}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          {data.total > 100 ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <Button variant="outline" size="sm" disabled={data.page === 0} onClick={() => { setConfirmed(false); setPage(data.page - 1) }}>Предыдущие записи</Button>
            <span>Страница {data.page + 1} из {Math.ceil(data.total / 100)}</span>
            <Button variant="outline" size="sm" disabled={(data.page + 1) * 100 >= data.total} onClick={() => { setConfirmed(false); setPage(data.page + 1) }}>Следующие записи</Button>
          </div> : null}
        </div>
        {data.reason ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{data.reason}</p> :
          <label className="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <Checkbox className="m-0 mt-0.5" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            <span className="min-w-0 text-sm leading-5 text-slate-700">{single ? 'Подтверждаю изменение актуальности этого стыка' : 'Состав цепочки проверен; подтверждаю изменение актуальности всех перечисленных записей'}</span>
          </label>}
      </> : null}
    </div>

    <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
      <p className="text-xs leading-5 text-slate-500">Изменение применится при сохранении карточки стыка. Отмена и Escape оставят прежний выбор.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose}>Отмена</Button>
        <Button variant="outline" disabled={preview.isFetching} onClick={() => { setConfirmed(false); void preview.refetch() }}>Повторить проверку</Button>
        <Button aria-label={`Подтвердить актуальность ${single ? 'стыка' : 'цепочки'}`} disabled={preview.isFetching || !data || !!data.reason || !confirmed} onClick={() => {
          if (!data || !confirmed) return
          onConfirm({ active, token: data.token, confirmed: true })
        }}>Подтвердить</Button>
      </div>
    </div>
  </LargeDialogShell>
}
