import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { previewPreHeatTreatmentBatch, savePreHeatTreatmentBatch } from '@/server/pre-heat-treatment-api'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PreHeatTreatmentFillOptions } from '@/lib/pre-heat-treatment-fill'
import { useAccess } from '@/lib/security-context'
import { runDocumentSave } from '@/lib/run-document-save'
import { LargeDialogShell } from './large-dialog-shell'
import { Button } from './ui/button'
import { PreHeatTreatmentDocumentTable, preHeatTreatmentFactRows } from './pre-heat-treatment-document-table'

const FillDialog = lazy(() => import('./pre-heat-treatment-fill-dialog').then(m => ({ default: m.PreHeatTreatmentFillDialog })))
export function PreHeatTreatmentBatchDialog({ rowIds, required, onClose, onSaved }: {
  rowIds: number[]; required: boolean; onClose: () => void; onSaved: (rows: WeldRow[]) => void
}) {
  const { can } = useAccess()
  const [fillToken, setFillToken] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const preview = useQuery({ queryKey: ['pre-heat-batch', rowIds, required],
    queryFn: () => previewPreHeatTreatmentBatch({ data: { rowIds, required } }),
    retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const data = preview.data
  const saveBatch = (token: string, fill?: PreHeatTreatmentFillOptions) => runDocumentSave('savePreHeatTreatmentBatch', headers =>
    savePreHeatTreatmentBatch({ data: { rowIds, required, token, ...(fill ? { fill } : {}) }, headers }))
  const save = useMutation({ mutationFn: () => saveBatch(data!.token), onSuccess: rows => { onSaved(rows); onClose() } })
  const blocked = !data || preview.isFetching || Boolean(preview.error) || data.chains.some(chain => chain.reason)
    || !can('welding.edit') || !required && data.controls.length > 0 && !can('lnk.delete')
  const title = required ? 'Поставить отметку НК до ТО' : 'Снять отметку НК до ТО'
  if (fillToken) return <Suspense fallback={<p role="status">Открываем заполнение…</p>}><FillDialog rowIds={rowIds} markRowIds={rowIds}
    onClose={() => setFillToken(null)} onSave={fill => saveBatch(fillToken, fill)} onSaved={rows => { onSaved(rows); onClose() }} /></Suspense>
  return <LargeDialogShell ariaLabel={title} onEscape={onClose} escapeDisabled={save.isPending} maxWidthClassName="max-w-[1320px]">
    <header className="border-b px-5 py-4"><h2 className="text-lg font-semibold">{title}</h2></header>
    <div className="min-h-0 space-y-4 overflow-auto p-5">
      {preview.isFetching ? <p role="status">Проверяем цепочки и документы…</p> : null}
      {preview.error || save.error ? <p role="alert" className="text-sm text-rose-700">{(preview.error ?? save.error)?.message}</p> : null}
      {data ? <>
        <p className="text-sm">Выбрано записей: {data.selectedCount}. Цепочек: {data.chains.length}. Затронуто записей: {data.affectedCount}.</p>
        <p className="rounded-md border border-sky-100 bg-sky-50 p-3 text-sm">Отметка меняется для всей показанной цепочки, включая невыделенные ремонты и переварки. Катушки имеют собственные цепочки.</p>
        <table className="w-full border-collapse text-left text-sm"><thead className="bg-slate-50"><tr><th className="border p-2">Проект · Шифр · Линия</th><th className="border p-2">Состав цепочки</th><th className="border p-2">Изменение</th></tr></thead>
          <tbody>{data.chains.slice(page * 50, page * 50 + 50).map(chain => <tr key={chain.rootId} className={chain.reason ? 'bg-rose-50' : ''}>
            <td className="border p-2">{chain.location}</td><td className="border p-2">{chain.rows.map(row => row.joint).join(', ')}</td>
            <td className="border p-2">{chain.reason ?? (chain.required === required ? 'Отметка уже в этом состоянии' : required ? 'Поставить отметку' : 'Снять отметку')}</td>
          </tr>)}</tbody></table>
        {data.chains.length > 50 ? <div className="flex items-center gap-3"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Назад</Button><span>{page + 1} / {Math.ceil(data.chains.length / 50)}</span><Button variant="outline" disabled={(page + 1) * 50 >= data.chains.length} onClick={() => setPage(page + 1)}>Далее</Button></div> : null}
        {data.chains.some(chain => chain.reason) ? <p role="alert" className="text-sm text-rose-700">Есть цепочки с запретом. Проверьте причины в таблице и измените выбор стыков. Ничего не сохранено.</p> : null}
        {required ? <p className="text-sm text-slate-600">Можно включить только необходимость этапа или сразу заполнить недостающее как «Годен» для показанных цепочек. Существующие результаты сохраняются.</p> : <>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">Будут удалены перечисленные данные НК до ТО. Общие документы сохранят другие позиции; пустые документы удалятся. Стыки, ПСТО, ТВМТ и основной НК сохраняются. Повторная установка отметки документы не восстановит.</p>
          {data.controls.length ? <PreHeatTreatmentDocumentTable rows={preHeatTreatmentFactRows(data.controls)} /> : <p className="text-sm text-slate-500">Данных НК до ТО для удаления нет.</p>}
          {data.removals.length ? <PreHeatTreatmentDocumentTable showJoints={false} showImpact rows={data.removals.map(doc => ({ key: String(doc.id), kind: doc.kind, name: doc.name, date: doc.date, method: doc.methods.join(', '), removed: doc.removed, remaining: doc.remaining }))} /> : null}
          {data.controls.length && !can('lnk.delete') ? <p role="alert" className="text-sm text-rose-700">Для удаления существующих данных необходимо право удаления ЛНК.</p> : null}
        </>}
      </> : null}
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t p-4"><Button variant="outline" disabled={save.isPending} onClick={onClose}>Отмена</Button>
      <Button variant="outline" disabled={blocked || save.isPending} onClick={() => save.mutate()}>{required ? 'Поставить, оставить незаполненным' : 'Подтвердить снятие и удаление'}</Button>
      {required ? <Button disabled={blocked || save.isPending || !can('lnk.edit')} onClick={() => setFillToken(data!.token)}>Поставить и заполнить как «Годен»</Button> : null}
    </footer>
  </LargeDialogShell>
}
