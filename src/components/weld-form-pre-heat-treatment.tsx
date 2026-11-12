import { lazy, Suspense, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { previewNewPreHeatTreatment, previewPreHeatTreatmentChain } from '@/server/pre-heat-treatment-api'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldDraft } from '@/lib/dispatcher-types'
import { getPstoLineIdentityKey } from '@/lib/psto-line-assignment'
import { useAccess } from '@/lib/security-context'
import { PreHeatTreatmentDocumentTable, preHeatTreatmentFactRows } from './pre-heat-treatment-document-table'
import { Checkbox } from './ui/checkbox'
import { Button } from './ui/button'
import { LargeDialogShell } from './large-dialog-shell'
import type { PreHeatTreatmentFillOptions } from '@/lib/pre-heat-treatment-fill'

const FillDialog = lazy(() => import('./pre-heat-treatment-fill-dialog').then(module => ({ default: module.PreHeatTreatmentFillDialog })))

type Props = {
  draft: WeldInput; setDraft: Dispatch<SetStateAction<WeldInput>>; onOpenRoot?: (id: number) => void
}

export function WeldFormPreHeatTreatment(props: Props) {
  return props.draft.id ? <SavedPreHeatTreatment {...props} /> : <NewPreHeatTreatment {...props} />
}

function NewPreHeatTreatment({ draft, setDraft }: Props) {
  const identityKey = getPstoLineIdentityKey(draft)
  const scope = JSON.stringify([identityKey, draft.joint ?? ''])
  const [settledScope, setSettledScope] = useState(scope)
  useEffect(() => { const timer = setTimeout(() => setSettledScope(scope), 200); return () => clearTimeout(timer) }, [scope])
  useEffect(() => {
    if (!draft.newPreHeatTreatmentChoice || draft.newPreHeatTreatmentChoice.identityKey === identityKey) return
    setDraft(current => {
      if (!current.newPreHeatTreatmentChoice || current.newPreHeatTreatmentChoice.identityKey === identityKey) return current
      const next = { ...current }; delete next.newPreHeatTreatmentChoice; return next
    })
  }, [identityKey, draft.newPreHeatTreatmentChoice, setDraft])
  const preview = useQuery({ queryKey: ['new-pre-heat-treatment', scope],
    queryFn: () => previewNewPreHeatTreatment({ data: { projectTitle: draft.projectTitle, subtitleCode: draft.subtitleCode, line: draft.line, joint: draft.joint } }),
    enabled: scope === settledScope && Boolean(String(draft.line ?? '').trim()), retry: false, staleTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false })
  const data = preview.data
  const checked = data?.inherited ? data.required : draft.newPreHeatTreatmentChoice?.identityKey === identityKey
  return <div className="space-y-2 border-b border-slate-200 bg-sky-50/30 px-4 py-4">
    <label className="flex items-start gap-2 text-sm font-medium"><Checkbox checked={checked}
      disabled={scope !== settledScope || preview.isFetching || !data?.applicable || data.inherited || Boolean(preview.error)}
      onChange={() => setDraft(current => {
        const next = { ...current }
        if (checked) delete next.newPreHeatTreatmentChoice
        else next.newPreHeatTreatmentChoice = { required: true, identityKey }
        return next
      })} /><span>Требуется НК до ТО</span></label>
    <p className="text-xs text-slate-600">{data?.inherited
      ? `Отметка наследуется от исходного стыка ${data.rootJoint}. Изменить её можно для всей цепочки.`
      : data?.applicable ? 'Можно включить сразу при создании стыка. При смене линии выбранная отметка сбрасывается.'
      : 'Выберите линию с назначенным ПСТО, чтобы включить НК до ТО.'}</p>
    {preview.error ? <p role="alert" className="text-sm text-rose-700">{preview.error.message}</p> : null}
  </div>
}

function SavedPreHeatTreatment({ draft, setDraft, onOpenRoot }: Props) {
  const { can } = useAccess()
  const [pending, setPending] = useState<boolean | null>(null), [fill, setFill] = useState(false)
  const preview = useQuery({ queryKey: ['pre-heat-chain-preview', draft.id, pending],
    queryFn: () => previewPreHeatTreatmentChain({ data: { rowId: Number(draft.id), ...(pending === null ? {} : { required: pending }) } }),
    placeholderData: (previous, query) => query?.queryKey[1] === draft.id ? previous : undefined,
    enabled: Boolean(draft.id), retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const data = preview.data, confirmation = (draft as WeldDraft).preHeatTreatmentConfirmation
  const checked = confirmation?.required ?? data?.required ?? draft.preHeatTreatmentRequired === true
  const inherited = data && data.rootId !== draft.id
  const close = () => { setPending(null); setFill(false) }
  const confirm = (fillOptions?: PreHeatTreatmentFillOptions) => {
    if (!data || pending === null || data.reason || preview.error || preview.isFetching) return
    const next = { required: pending, token: data.token, ...(fillOptions ? { fill: fillOptions } : {}) }
    setDraft(current => ({ ...current, preHeatTreatmentConfirmation: next } as WeldDraft))
    close()
  }
  if (!draft.id) return null
  return <div className="space-y-2 border-b border-slate-200 bg-sky-50/30 px-4 py-4">
    <label className="flex items-start gap-2 text-sm font-medium"><Checkbox checked={checked}
      disabled={!draft.id || preview.isFetching || Boolean(preview.error) || Boolean(inherited) || !checked && !data?.applicable}
      onChange={() => setPending(!checked)} /><span>Требуется НК до ТО</span></label>
    {inherited ? <p className="text-sm text-slate-600">Значение унаследовано всей цепочкой от {data.rootJoint}. {onOpenRoot ? <button type="button" className="font-medium text-sky-700 underline" onClick={() => onOpenRoot(data.rootId)}>Открыть карточку {data.rootJoint}</button> : null}</p>
      : !data?.applicable ? <p className="text-xs text-slate-600">На линии ПСТО не назначено. Новое включение недоступно; сохранённую отметку можно явно снять с удалением истории.</p>
      : <p className="text-xs text-slate-500">Изменение относится к исходному стыку и его R/W-продолжениям. Катушки не входят в эту цепочку.</p>}
    {preview.error ? <p role="alert" className="text-sm text-rose-700">{preview.error.message}</p> : null}
    {confirmation ? <div className="flex items-center justify-between gap-3 text-sm text-sky-800"><span>После сохранения: {confirmation.required ? 'НК до ТО требуется' : 'НК до ТО отключён, перечисленные данные удалены'}{confirmation.fill ? '; недостающее будет заполнено как «Годен»' : ''}.</span><button type="button" className="underline" onClick={() => setDraft(current => { const next = { ...current } as WeldDraft; delete next.preHeatTreatmentConfirmation; return next })}>Отменить изменение</button></div> : null}
    {pending !== null && !fill ? <LargeDialogShell onEscape={close} ariaLabel={pending ? 'Включить НК до ТО' : 'Отключить НК до ТО'} maxWidthClassName="max-w-[1320px]" overlayClassName="z-[140] bg-slate-950/30">
      <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold">{pending ? 'Включить НК до ТО для цепочки' : 'Отключить НК до ТО для цепочки'}</h2></div>
      <div className="min-h-0 space-y-4 overflow-auto p-5">
        {preview.isFetching ? <p role="status">Проверяем цепочку и документы…</p> : preview.error ? <p role="alert" className="text-rose-700">{preview.error.message}</p> : data ? <>
          <p className="text-sm">Состав цепочки: {data.rows.map(row => row.joint).join(', ')}.</p>
          {data.reason ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{data.reason}</p> : null}
          {pending ? <p className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm">Можно оставить предварительный комплект незаполненным или подготовить недостающие заявки и заключения «Годен». При уже выполненных последующих этапах незавершённая последовательность останется видна через СП-06.</p> : <>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">После сохранения будут удалены только перечисленные данные НК до ТО. Общие документы сохранят чужие позиции; пустые документы удалятся. Сами стыки, ПСТО, ТВМТ и основной НК сохраняются.</p>
            {data.controls.length ? <section className="space-y-2"><h3 className="text-sm font-semibold">Данные НК до ТО</h3><PreHeatTreatmentDocumentTable rows={preHeatTreatmentFactRows(data.controls.map(control => ({ ...control, joint: data.rows.find(row => row.id === control.rowId)?.joint, conclusionDate: control.date })))} /></section> : null}
            {data.removals.length ? <section className="space-y-2"><h3 className="text-sm font-semibold">Что произойдёт с документами · {data.removals.length}</h3><PreHeatTreatmentDocumentTable showJoints={false} showImpact rows={data.removals.map(document => ({ key: String(document.id), kind: document.kind, name: document.name, date: document.date, method: document.methods.join(', '), removed: document.removed, remaining: document.remaining }))} /></section> : null}
            {!data.controls.length ? <p className="text-sm text-slate-500">Данных НК до ТО для удаления нет.</p> : <p className="text-xs text-slate-500">Результаты, даты, описания дефектов и реквизиты этих позиций будут очищены. Повторное включение не восстанавливает удалённые документы.</p>}
          </>}
        </> : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t p-4"><Button type="button" variant="outline" onClick={close}>Отмена</Button>
        <Button type="button" variant="outline" disabled={!data || preview.isFetching || Boolean(preview.error) || Boolean(data.reason)} onClick={() => confirm()}>{pending ? 'Оставить незаполненным' : 'Подтвердить отключение и удаление'}</Button>
        {pending && can('lnk.edit') ? <Button type="button" disabled={!data || preview.isFetching || Boolean(preview.error) || Boolean(data.reason)} onClick={() => setFill(true)}>Заполнить недостающее как «Годен»</Button> : null}</div>
    </LargeDialogShell> : null}
    {fill && data ? <Suspense fallback={<p>Открываем заполнение…</p>}><FillDialog rowIds={data.rows.map(row => row.id)} chainRootId={data.rootId} onClose={() => setFill(false)} onConfirm={confirm} /></Suspense> : null}
  </div>
}
