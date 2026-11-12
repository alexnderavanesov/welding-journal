import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, X } from 'lucide-react'
import { LargeDialogShell } from './large-dialog-shell'
import { PreHeatTreatmentDocumentTable, preHeatTreatmentFactRows } from './pre-heat-treatment-document-table'
import type { PreHeatTreatmentFillIssue } from '@/lib/pre-heat-treatment-fill'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { SpecialistSelect, useSpecialistOptions } from './specialist-select'
import { getSpecialistDocumentProfile, type SpecialistSelection } from '@/lib/document-specialists'
import { PRE_HEAT_TREATMENT_LNK_METHODS } from '@/lib/lnk-control-stage'
import type { PreHeatTreatmentFillOptions } from '@/lib/pre-heat-treatment-fill'
import { SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS, getSystemDocumentSplitSettingId, type SystemDocumentSplitMode } from '@/lib/system-document-splitting'
import { previewPreHeatTreatmentFill, savePreHeatTreatmentFill } from '@/server/pre-heat-treatment-api'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { runDocumentSave } from '@/lib/run-document-save'
import type { WeldRow } from '@/lib/dispatcher-types'

export type PreHeatTreatmentFillDialogProps = {
  rowIds: number[]; chainRootId?: number; markRowIds?: number[]; onClose: () => void
  onConfirm?: (options: PreHeatTreatmentFillOptions) => void; onSaved?: (rows: WeldRow[]) => void
  onSave?: (options: PreHeatTreatmentFillOptions) => Promise<WeldRow[]>
}

export function PreHeatTreatmentFillDialog({ rowIds, chainRootId, markRowIds, onClose, onConfirm, onSaved, onSave }: PreHeatTreatmentFillDialogProps) {
  const [options, setOptions] = useState<PreHeatTreatmentFillOptions>({})
  const [page, setPage] = useState(0)
  const debounced = useDebouncedValue(options, 300)
  const input = useMemo(() => ({ rowIds, chainRootId, markRowIds, options: debounced }), [rowIds, chainRootId, markRowIds, debounced])
  const scope = JSON.stringify([chainRootId, markRowIds, rowIds])
  const preview = useQuery({ queryKey: ['pre-heat-fill-preview', scope, input],
    placeholderData: (previous, query) => query?.queryKey[1] === scope ? previous : undefined, queryFn: () => previewPreHeatTreatmentFill({ data: input }),
    retry: false, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const save = useMutation({ mutationFn: (confirmed: PreHeatTreatmentFillOptions) => onSave ? onSave(confirmed) : runDocumentSave('savePreHeatTreatmentFill', headers => savePreHeatTreatmentFill({ data: { rowIds, options: confirmed }, headers })),
    onSuccess: rows => { onSaved?.(rows); onClose() } })
  const lastPreview = useRef<{ scope: string; data: NonNullable<typeof preview.data> } | null>(null)
  if (preview.data) lastPreview.current = { scope, data: preview.data }
  const data = preview.data ?? (lastPreview.current?.scope === scope ? lastPreview.current.data : undefined)
  const updating = options !== debounced || preview.isFetching || preview.isPlaceholderData
  const fields = useRef(new Map<string, HTMLInputElement>())
  const pendingFocus = useRef<string | null>(null)
  const focusIssue = (issue: PreHeatTreatmentFillIssue) => {
    const index = data?.items.findIndex(item => issue.itemKey ? item.key === issue.itemKey : item.rowId === issue.rowId) ?? -1
    if (index < 0 || !data) return
    const key = `${data.items[index]!.key}:${issue.field ?? 'date'}`
    pendingFocus.current = key
    setPage(Math.floor(index / 50))
    const field = fields.current.get(key)
    if (field) { field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'center' }); pendingFocus.current = null }
  }
  const fieldRef = (key: string) => (node: HTMLInputElement | null) => {
    if (!node) { fields.current.delete(key); return }
    fields.current.set(key, node)
    if (pendingFocus.current === key) { node.focus({ preventScroll: true }); node.scrollIntoView({ block: 'center' }); pendingFocus.current = null }
  }
  const groupsByItem = new Map(data?.groups.flatMap(group => group.items.map(item => [item.key, group] as const)))
  const pages = Math.max(1, Math.ceil((data?.items.length ?? 0) / 50)), currentPage = Math.min(page, pages - 1)
  const updateItem = (key: string, field: 'date' | 'name', value?: string) => setOptions(current => ({ ...current,
    overrides: { ...current.overrides, [key]: { ...current.overrides?.[key], [field]: value } } }))
  const splitControls = [{ id: 'lnkRequest' as const, label: 'Заявки' }, ...PRE_HEAT_TREATMENT_LNK_METHODS.map(method => ({
    id: getSystemDocumentSplitSettingId({ type: 'lnkConclusion', methodCode: method.code }), label: `Заключения ${method.code}` }))]
  const confirm = () => {
    if (!data || preview.error || updating || data.errors.length || save.isPending) return
    const confirmed: PreHeatTreatmentFillOptions = { ...options, token: data.token, confirmedGroups: data.groups.map(group => ({
      key: group.key, name: group.name, date: group.date, itemKeys: group.items.map(item => item.key),
    })) }
    if (onConfirm) onConfirm(confirmed)
    else save.mutate(confirmed)
  }
  return <LargeDialogShell onEscape={() => { if (!save.isPending) onClose() }} ariaLabel="Заполнить недостающий НК до ТО" maxWidthClassName="max-w-[1440px]" panelClassName="h-[92vh]" overlayClassName="z-[150] bg-slate-950/30">
    <div className="flex items-start justify-between border-b px-5 py-4">
      <div><h2 className="text-lg font-semibold">Заполнить недостающий НК до ТО</h2>
        <p className="mt-1 text-sm text-slate-500">Новые заявки и заключения с результатом «Годен». Существующие документы и результаты сохраняются.</p></div>
      <Button type="button" variant="ghost" size="icon" aria-label="Закрыть" disabled={save.isPending} onClick={onClose}><X className="h-5 w-5" /></Button>
    </div>
    <fieldset disabled={save.isPending} className="min-h-0 flex-1 space-y-4 overflow-auto p-5 [overflow-anchor:none]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{splitControls.map(control => <label key={control.id} className="space-y-1 text-xs font-medium">
        <span>{control.label}</span><Select aria-label={`Разделение: ${control.label}`} value={options.splitModes?.[control.id] ?? data?.splitModes[control.id] ?? 'none'}
          onChange={event => setOptions(current => ({ ...current, splitModes: { ...current.splitModes, [control.id]: event.target.value as SystemDocumentSplitMode } }))}>
          {SYSTEM_DOCUMENT_SPLIT_MODE_OPTIONS.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
        </Select></label>)}</div>
      <p className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm text-sky-950">
        Дата по умолчанию — дата сварки каждого стыка. Дату и название любого нового документа можно изменить. Ручные значения сохраняются при пересчёте; отдельная правка выделяет позицию из общего документа.
      </p>
      {preview.error || save.error ? <p role="alert" className="whitespace-pre-line text-sm text-rose-700">{(save.error ?? preview.error)?.message}</p> : null}
      <div role="status" aria-live="polite" className="flex min-h-5 items-center justify-between text-xs text-slate-500"><span>{data ? `Подходящих стыков: ${data.selectedCount} · Новых заявок: ${data.groups.filter(group => group.action === 'request').length} · Заключений: ${data.groups.filter(group => group.action === 'result').length}` : 'Загружаем состав документов…'}</span><span>{updating && data ? 'Пересчитываем…' : ''}</span></div>
      {data ? <>
        {data.errors.length ? <div role="alert" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 shrink-0" />Исправьте отмеченные позиции</p>{data.errors.map(error => {
          const issue = data.issues.find(issue => issue.message === error && data.items.some(item => issue.itemKey ? item.key === issue.itemKey : item.rowId === issue.rowId))
          return issue ? <button type="button" key={error} className="block text-left underline decoration-rose-300 underline-offset-2 hover:decoration-rose-700" onClick={() => focusIssue(issue)}>{error}</button> : <p key={error}>{error}</p>
        })}</div> : null}
        {!data.items.length ? <p className="text-sm text-slate-600">Недостающих документов для заполнения нет.</p> : <div className="overflow-auto rounded-lg border border-slate-200"><table className="w-full min-w-[900px] table-fixed text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-[22%] p-3">Стык</th><th className="w-20 p-3">Метод</th><th className="w-28 p-3">Документ</th><th className="w-44 p-3">Дата</th><th className="p-3">Название документа</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.items.slice(currentPage * 50, (currentPage + 1) * 50).map(item => {
            const issues = data.issues.filter(issue => issue.itemKey ? issue.itemKey === item.key : issue.rowId === item.rowId && (!issue.method || item.methods.includes(issue.method as typeof item.methods[number])))
            const errors = [...new Set(issues.map(issue => issue.message))]
            const dateInvalid = issues.some(issue => issue.field === 'date'), nameInvalid = issues.some(issue => issue.field === 'name')
            const errorId = `pre-heat-fill-error-${item.key}`
            return <tr key={item.key} data-fill-item={item.key} className={errors.length ? 'bg-rose-50/70' : undefined}>
              <td className="break-words p-3 align-top"><span className={`font-medium ${errors.length ? 'text-rose-800' : ''}`}>{errors.length ? <AlertCircle className="mr-1 inline h-4 w-4" aria-hidden="true" /> : null}{item.joint}</span><div className="mt-1 text-xs text-slate-500">{item.location}</div></td>
              <td className="p-3 align-top font-medium">{item.methods.join(', ')}</td>
              <td className="p-3 align-top">{item.action === 'request' ? 'Заявка' : <><span>Заключение</span><span className="mt-1 block text-xs text-emerald-700">Годен</span></>}</td>
              <td className="p-3 align-top"><Input ref={fieldRef(`${item.key}:date`)} type="date" aria-label={`Дата ${item.key}`} aria-invalid={dateInvalid || undefined} aria-describedby={dateInvalid ? errorId : undefined} className={dateInvalid ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-200' : ''} value={options.overrides?.[item.key]?.date ?? item.date} onChange={event => updateItem(item.key, 'date', event.target.value)} />
                <button type="button" className="mt-1 text-xs text-sky-700" onClick={() => updateItem(item.key, 'date')}>{item.manualDate ? 'Вернуть дату сварки' : 'Дата сварки'}</button></td>
              <td className="p-3 align-top"><Input ref={fieldRef(`${item.key}:name`)} aria-label={`Название ${item.key}`} aria-invalid={nameInvalid || undefined} aria-describedby={errors.length ? errorId : undefined} className={nameInvalid ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-200' : ''} value={options.overrides?.[item.key]?.name ?? groupsByItem.get(item.key)?.name ?? ''} onChange={event => updateItem(item.key, 'name', event.target.value)} />
                <button type="button" className="mt-1 text-xs text-sky-700" onClick={() => updateItem(item.key, 'name')}>{item.manualName ? 'Вернуть автоматическое имя' : 'Автоматическое имя'}</button>
                {errors.length ? <div id={errorId} className="mt-2 space-y-1 text-xs text-rose-700">{errors.map(error => <p key={error}>{error}</p>)}</div> : null}</td>
            </tr>
          })}</tbody>
        </table></div>}
        {pages > 1 ? <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Назад</Button><span className="text-sm">{currentPage + 1} / {pages}</span><Button type="button" variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</Button></div> : null}
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Состав создаваемых документов · {data.groups.length}</summary><div className="mt-3"><PreHeatTreatmentDocumentTable rows={data.groups.map(group => ({ key: group.key, joint: group.items.map(item => item.joint).join(', '), method: [...new Set(group.positions.map(position => position.methodCode))].join(', '), kind: group.action, name: group.name, date: group.date, result: group.action === 'result' ? 'Годен' : null }))} /></div></details>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Специалисты новых заключений</summary><div className="mt-3 space-y-4">{PRE_HEAT_TREATMENT_LNK_METHODS.filter(method => data.groups.some(group => group.action === 'result' && group.positions[0]?.methodCode === method.code)).map(method => <FillSpecialists key={method.code} method={method.code} value={options.specialists?.[method.code] ?? data.specialists[method.code] ?? {}} onChange={selection => setOptions(current => ({ ...current, specialists: { ...current.specialists, [method.code]: selection } }))} />)}</div></details>
        {data.existing.length ? <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Существующие сведения — сохраняются</summary><div className="mt-3"><PreHeatTreatmentDocumentTable rows={preHeatTreatmentFactRows(data.existing.map(item => ({ ...item, requestDate: item.date })), data.issues.filter(issue => !issue.itemKey))} /></div></details> : null}
      </> : null}
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
      <p className="text-xs text-slate-500">{onConfirm ? 'Документы создадутся только после сохранения карточки.' : 'Весь показанный состав сохраняется одной операцией.'}</p>
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Отмена</Button><Button type="button" disabled={!data || Boolean(preview.error) || updating || Boolean(data.errors.length) || !data.groups.length || save.isPending} onClick={confirm}>{save.isPending ? 'Сохраняем…' : 'Заполнить недостающее как «Годен»'}</Button></div>
    </div>
  </LargeDialogShell>
}

function FillSpecialists({ method, value, onChange }: { method: string; value: SpecialistSelection; onChange: (value: SpecialistSelection) => void }) {
  const profile = getSpecialistDocumentProfile('lnkConclusion', method)!
  const options = useSpecialistOptions(profile)
  return <div className="grid gap-3 sm:grid-cols-[100px_1fr_1fr]"><span className="text-sm font-semibold">{method}</span>{(['first', 'second'] as const).map((role, index) => <SpecialistSelect key={role} label={profile.labels[index]} value={value[role]} profile={profile} options={options} density="compact" onChange={id => onChange({ ...value, [role]: id })} />)}</div>
}
