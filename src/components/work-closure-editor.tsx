import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { readWorkClosures, saveJointWorkClosures, saveBulkWorkClosures } from '@/server/work-closures-api'
import { compareClosureWorkTypes, jointClosureChanges, preHeatWorkTypes, replacedClosureFields, type JointWorkClosure, type WorkClosure, type WorkClosureChange } from '@/lib/work-closures'
import { closureColumns } from '@/lib/work-closure-columns'
import { WorkClosureTypeSelect } from './work-closure-type-select'
import { WORK_CLOSURE_VALUES_KEY, useWorkClosureValues } from '@/lib/use-work-closure-values'
import { AutocompleteInput } from './ui/autocomplete-input'
import { invalidateWeldPageQueries } from '@/lib/weld-page-refresh'
import type { WeldRow } from '@/lib/dispatcher-types'
import { Button } from './ui/button'

type Target = Pick<WeldRow, 'id' | 'joint' | 'line'>
export type ClosureMode = 'card' | 'rateCode' | 'actNumber'
const blank = (): WorkClosure => ({ workType: '', rateCode: '', actNumber: '' })
const label = (row: Target) => [row.line, row.joint || '№ ' + row.id].filter(Boolean).join(' · ')
const sortedPositions = (entries: WorkClosure[]) => [...entries].sort((a, b) => compareClosureWorkTypes(a.workType, b.workType))

export function WorkClosureEditor({ rows, mode, editable, onDone }: { rows: Target[]; mode: ClosureMode; editable: boolean; onDone?: () => void }) {
  const ids = rows.map(row => row.id)
  const query = useQuery({ queryKey: ['work-closures', ids], queryFn: ({ signal }) => readWorkClosures({ signal, data: { ids } }),
    staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false })
  if (query.isError) return <div role="alert" className="p-4 text-sm">{query.error.message} <Button variant="outline" onClick={() => void query.refetch()}>Повторить</Button></div>
  if (!query.data || query.isFetching) return <p role="status" className="p-4 text-sm text-slate-500">Загружаем закрытия…</p>
  return <ClosureDraft rows={rows} mode={mode} editable={editable} stored={query.data.rows} testTypes={query.data.testTypes} preHeatIds={query.data.preHeatIds} onDone={onDone} onReload={() => void query.refetch()} />
}

function ClosureDraft({ rows, mode, editable, stored, testTypes, preHeatIds, onDone, onReload }: {
  rows: Target[]; mode: ClosureMode; editable: boolean; stored: JointWorkClosure[]; testTypes: string[]; preHeatIds: number[]; onDone?: () => void; onReload: () => void
}) {
  const client = useQueryClient()
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestions = useWorkClosureValues(editable && showSuggestions)
  const loadSuggestions = () => setShowSuggestions(true)
  const [draft, setDraft] = useState<WorkClosure[]>(() => mode === 'card' ? sortedPositions(stored) : [blank()])
  const [act, setAct] = useState('')
  const [overwriteExisting, setOverwriteExisting] = useState(false)
  const [conflictLimit, setConflictLimit] = useState(50)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const bulk = mode !== 'card'
  const update = (index: number, key: keyof WorkClosure, value: string) => {
    setDraft(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row))
    setNotice(''); setError('')
  }
  const ids = rows.map(row => row.id)
  const rowLabels = new Map(rows.map(row => [row.id, label(row)]))
  const changes: WorkClosureChange[] = []
  const conflicts: string[] = []
  let validation = ''
  try {
    if (mode === 'card') changes.push(...jointClosureChanges(ids[0], stored, draft))
    else {
      const existing = new Map(stored.map(row => [[row.weldJointId, row.workType].join(':'), row]))
      const seen = new Set<string>()
      for (const entry of draft) {
        const workType = entry.workType.trim(), value = (mode === 'actNumber' ? act : entry.rateCode).trim()
        if (!workType || !value) { validation = 'Укажите вид работы и ' + (mode === 'rateCode' ? 'код расценки.' : 'номер КС3.'); continue }
        if (seen.has(workType)) { validation = 'Вид работы выбран дважды.'; break }
        seen.add(workType)
        for (const id of preHeatWorkTypes.has(workType) ? preHeatIds : ids) {
          const key = [id, workType].join(':')
          const before = existing.get(key) ?? null
          const rateCode = entry.rateCode.trim() || before?.rateCode || ''
          const actNumber = mode === 'actNumber' ? value : before?.actNumber || ''
          const after = { workType, rateCode, actNumber }
          const replaced = replacedClosureFields(before, after)
          if (before && replaced.length) {
            const values = replaced.map(field => closureColumns[field].label + ' ' + before[field] + ' → ' + after[field])
            conflicts.push([rowLabels.get(id), workType, ...values].join(' · '))
            if (!overwriteExisting) continue
          }
          if (before?.rateCode === rateCode && before.actNumber === actNumber) continue
          changes.push({ weldJointId: id, workType, before, after })
        }
      }
    }
  } catch (reason) { validation = reason instanceof Error ? reason.message : String(reason) }

  const save = async () => {
    if (saving.current || !editable || validation || !changes.length) return
    saving.current = true; setBusy(true); setError('')
    try {
      const result = mode === 'card'
        ? await saveJointWorkClosures({ data: { changes } })
        : await saveBulkWorkClosures({ data: { changes, overwriteExisting } })
      if (result.rows) {
        client.setQueryData(['work-closures', ids], { rows: result.rows, testTypes, preHeatIds })
        setDraft(sortedPositions(result.rows))
      }
      setNotice('Сохранено позиций: ' + result.count)
      void invalidateWeldPageQueries(client)
      void client.invalidateQueries({ queryKey: ['weld-column-filter-options'], refetchType: 'none' })
      void client.invalidateQueries({ queryKey: ['work-closures'], refetchType: 'none' })
      void client.invalidateQueries({ queryKey: WORK_CLOSURE_VALUES_KEY })
      onDone?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { saving.current = false; setBusy(false) }
  }
  return <section aria-label="Позиции закрытия работ" className="work-closure-editor space-y-3 text-sm">
    {mode === 'actNumber' && <label className="block max-w-sm font-medium">Номер КС3<AutocompleteInput value={act} disabled={busy}
      options={suggestions.data?.actNumber ?? []} listLabel="Сохранённые номера КС3" placeholder="Выберите или введите номер"
      onFocus={loadSuggestions} onValueChange={setAct} /></label>}
    {draft.length === 0 && <p className="rounded-lg border border-dashed p-5 text-slate-500">По этому стыку пока нет записей о закрытии работ.</p>}
    {draft.map((row, index) => <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 font-medium">Вид работы<WorkClosureTypeSelect value={row.workType} testTypes={testTypes}
          beforeHeatTreatment={preHeatIds.length > 0}
          previous={!bulk && stored.some(entry => entry.workType === row.workType) ? [row.workType] : []}
          placeholder="Выберите работу" disabled={busy || !editable} onChange={name => update(index, 'workType', name)} /></label>
        <label className="min-w-32 flex-1">Код работ<AutocompleteInput value={row.rateCode} readOnly={!editable} disabled={busy}
          options={suggestions.data?.rateCode ?? []} listLabel="Сохранённые коды работ"
          placeholder={mode === 'actNumber' ? 'Необязательно' : editable ? 'Выберите или введите код' : undefined}
          onFocus={loadSuggestions} onValueChange={value => update(index, 'rateCode', value)} /></label>
        {!bulk && <label className="min-w-32 flex-1">КС3<AutocompleteInput value={row.actNumber} readOnly={!editable} disabled={busy}
          options={suggestions.data?.actNumber ?? []} listLabel="Сохранённые номера КС3" placeholder={editable ? 'Выберите или введите номер' : undefined}
          onFocus={loadSuggestions} onValueChange={value => update(index, 'actNumber', value)} /></label>}
        {editable && <Button variant="ghost" size="icon" aria-label={'Убрать работу ' + (row.workType || index + 1)} disabled={busy} onClick={() => {
          setDraft(draft.filter((_, i) => i !== index)); setNotice('')
        }}><Trash2 size={15} /></Button>}
      </div>
    </div>)}
    {editable && <Button variant="outline" disabled={busy} onClick={() => { setDraft([...draft, blank()]); setNotice('') }}><Plus size={15} />Добавить работу</Button>}
    {bulk && preHeatIds.length < ids.length && draft.some(row => preHeatWorkTypes.has(row.workType)) &&
      <p className="text-slate-600">НК до ТО доступен для {preHeatIds.length} из {ids.length} выбранных стыков.</p>}
    {bulk && <p aria-live="polite">Позиций к сохранению: {changes.length} · стыков: {new Set(changes.map(change => change.weldJointId)).size}</p>}
    {conflicts.length > 0 && <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Уже заполнено другим значением: {conflicts.length}</span>
        <div role="group" aria-label="Действие для этих позиций" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {[{ overwrite: false, label: 'Пропустить' }, { overwrite: true, label: 'Перезаписать' }].map(({ overwrite, label }) =>
            <Button key={label} type="button" size="sm" variant="ghost" disabled={busy || !editable}
              aria-pressed={overwriteExisting === overwrite} onClick={() => setOverwriteExisting(overwrite)}
              className="h-7 px-3 aria-pressed:bg-white aria-pressed:text-sky-800 aria-pressed:shadow-sm">{label}</Button>)}
        </div>
      </div>
      <details><summary className="w-fit cursor-pointer text-sm text-slate-600">Показать позиции</summary>
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">{conflicts.slice(0, conflictLimit).map((text, i) => <li key={i}>{text}</li>)}</ul>
        {conflicts.length > conflictLimit && <Button type="button" size="sm" variant="ghost" onClick={() => setConflictLimit(limit => limit + 50)}>Показать ещё</Button>}
      </details>
    </div>}
    {error && <p role="alert" className="text-rose-700">{error} <Button variant="outline" onClick={onReload}>Перечитать данные</Button></p>}
    {notice && <p role="status" className="text-emerald-700">{notice}</p>}
    {editable && <div className="flex items-center justify-end gap-3 border-t pt-3">{validation && <span className="text-xs text-slate-500">{validation}</span>}
      <Button disabled={busy || !!validation || !changes.length} onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить закрытия'}</Button></div>}
  </section>
}
