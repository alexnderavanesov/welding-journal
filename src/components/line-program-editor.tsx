import { PROGRAM_DEMAND_LABELS } from '@/lib/line-program-labels'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Info, Link2, SlidersHorizontal, X } from 'lucide-react'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hasLineProgramIdentityChanges, type LineProgramRecord, type LineProgramSaveRequest } from '@/lib/line-program'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY } from '@/lib/dispatcher-accepted-warning-query'
import { useSecurityGuard } from '@/lib/security-context'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { shouldDeferModalEscape } from '@/lib/use-report-modal-escape-key'
import { saveLineProgram, type getLineProgramSection } from '@/server/line-program'

export function LineProgramEditor({ value, onClose, onSaved }: {
  value: LineProgramSaveRequest; onClose: () => void; onSaved: (line: LineProgramRecord) => void
}) {
  const [draft, setDraft] = useState(value)
  const [separatePvk, setSeparatePvk] = useState(value.pvkControlPercent !== value.weldControlPercent)
  const formRef = useRef<HTMLFormElement>(null)
  const { requireEditPassword } = useSecurityGuard()
  const confirmAction = useConfirmAction()
  const queryClient = useQueryClient()
  const mutation = useMutation({ mutationFn: async () => {
    if (draft.id && hasLineProgramIdentityChanges(value, draft) && !await confirmAction({
      title: 'Изменить данные всей линии?',
      tone: 'warning',
      description: <div className="space-y-2">{([['projectTitle', 'Проект'], ['subtitleCode', 'Шифр'], ['line', 'Линия']] as const)
        .filter(([key]) => value[key].trim() !== draft[key].trim())
        .map(([key, label]) => <p key={key}><span className="font-medium">{label}:</span> {value[key] || 'Не указан'} → {draft[key].trim() || 'Не указан'}</p>)}</div>,
      warning: 'Изменения применятся ко всем стыкам линии, включая ремонты, катушки, неофициальные и неактуальные записи. Результаты, назначения и связи с документами сохранятся.',
      confirmLabel: 'Изменить всю линию',
    })) return null
    return await requireEditPassword('настройка программы линии') ? saveLineProgram({ data: draft }) : null
  },
    onSuccess: async (line) => {
      if (!line) return
      // The generic invalidator intentionally does not await refetches. Keep
      // this editor pending until its own active views finish refreshing, so
      // immediately reopening it cannot capture the pre-save version.
      await queryClient.cancelQueries({ queryKey: ['line-program', 'section'] })
      queryClient.setQueryData<Awaited<ReturnType<typeof getLineProgramSection>>>(['line-program', 'section'], previous => previous
        ? { ...previous, rows: previous.rows.map(row => row.id === line.id ? { ...row, ...line } : row) }
        : previous)
      scheduleWeldDataRefresh(queryClient, undefined, { skipLineProgramRefetch: true })
      await queryClient.invalidateQueries({
        queryKey: ['line-program'], refetchType: 'active',
        predicate: query => query.queryKey[1] === 'section' || query.queryKey[2] === line.id,
      })
      if (value.id && hasLineProgramIdentityChanges(value, line)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['psto-line-assignments'], refetchType: 'none' }),
          queryClient.invalidateQueries({ queryKey: DISPATCHER_ACCEPTED_WARNINGS_QUERY_KEY, refetchType: 'none' }),
        ])
      }
      onSaved(line)
    } })
  useEffect(() => {
    const previous = document.activeElement
    formRef.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <LargeDialogShell ariaLabel={draft.id ? 'Настройка линии' : 'Новая линия'} maxWidthClassName="max-w-[560px]" maxHeightClassName="max-h-[92dvh]" panelRadiusClassName="rounded-2xl" panelClassName="overflow-hidden">
    <form ref={formRef} className="flex max-h-[92dvh] min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate() }}
      onKeyDown={(event) => {
        if (shouldDeferModalEscape() || mutation.isPending || !formRef.current?.contains(document.activeElement)) return
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const fields = Array.from(formRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
          const first = fields[0], last = fields.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <div className="flex shrink-0 items-start gap-3 border-b border-sky-100/70 bg-gradient-to-r from-sky-50/80 to-white px-6 py-5">
        <span className="rounded-xl border border-sky-100 bg-white p-2.5 text-sky-600"><SlidersHorizontal className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-slate-900">{draft.id ? 'Настройка линии' : 'Новая линия'}</h2>
          <p className="mt-1 text-sm text-slate-500">Данные и требования для всех стыков линии</p></div>
        <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Закрыть настройку линии" disabled={mutation.isPending} onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
        <section aria-label="Сведения о линии" className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="grid grid-cols-2 gap-4">
          {([['projectTitle', 'Проект'], ['subtitleCode', 'Шифр'], ['line', 'Линия']] as const).map(([key, label]) =>
            <label key={key} className={`space-y-1.5 text-sm font-medium text-slate-700 ${key === 'line' ? 'col-span-2' : ''}`}>{label}
              <Input aria-label={label} className="rounded-lg" required={key === 'line'} value={draft[key]} disabled={mutation.isPending}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        </div>
        <p className="mt-3 border-t border-slate-200/70 pt-3 text-xs leading-5 text-slate-500">{draft.id
          ? 'Проект, шифр и название изменятся у всех стыков этой линии. Результаты и документы сохранятся.'
          : 'Линию можно создать заранее, до добавления стыков.'}</p>
        </section>
        <div className="grid grid-cols-2 gap-4">
          {([['category', 'Категория'], ['groupName', 'Группа']] as const).map(([key, label]) =>
            <label key={key} className="space-y-1.5 text-sm font-medium text-slate-700">{label}
              <Input aria-label={label} className="rounded-lg" value={draft[key] ?? ''} disabled={mutation.isPending}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        </div>
        <section aria-label="Проценты контроля" className="space-y-3 rounded-xl border border-sky-100 bg-sky-50/40 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-2 flex h-7 items-center text-sm font-medium text-slate-700">Базовый % контроля</div>
              <Input aria-label="Базовый % контроля" className="h-11 rounded-lg bg-white text-base font-semibold tabular-nums" type="number" min={0} max={100} step="0.001" value={draft.weldControlPercent ?? ''} disabled={mutation.isPending}
                onChange={(event) => { const percent = event.target.value === '' ? null : Number(event.target.value); setDraft({ ...draft, weldControlPercent: percent, ...(!separatePvk ? { pvkControlPercent: percent } : {}) }) }} />
              <p className="mt-2 text-xs leading-5 text-slate-500">Норма {PROGRAM_DEMAND_LABELS.common}</p>
            </div>
            <div>
              <div className="mb-2 flex h-7 items-center justify-between gap-1">
                <span className="text-sm font-medium text-slate-700">% ПВК</span>
                <Button type="button" variant="ghost" size="sm" aria-label="ПВК как базовый" aria-pressed={!separatePvk} disabled={mutation.isPending}
                  className={`h-7 gap-1 rounded-md px-1.5 text-xs text-sky-700 hover:bg-sky-100 hover:text-sky-900 ${!separatePvk ? 'bg-sky-100/80' : 'bg-white'}`}
                  onClick={() => { setSeparatePvk(false); setDraft({ ...draft, pvkControlPercent: draft.weldControlPercent }) }}>
                  <Link2 className="h-3.5 w-3.5" />Как базовый
                </Button>
              </div>
              <Input aria-label="% ПВК" aria-describedby="line-program-pvk-mode" className="h-11 rounded-lg bg-white text-base font-semibold tabular-nums" type="number" min={draft.weldControlPercent === 100 ? 1 : 0} max={draft.weldControlPercent ?? 100} step="0.001" value={draft.pvkControlPercent ?? ''} disabled={mutation.isPending}
                onChange={(event) => { setSeparatePvk(true); setDraft({ ...draft, pvkControlPercent: event.target.value === '' ? null : Number(event.target.value) }) }} />
              <p id="line-program-pvk-mode" className="mt-2 text-xs leading-5 text-slate-500">{separatePvk ? 'Отдельное значение' : 'Меняется вместе с базовым'}</p>
            </div>
          </div>
          <p className="border-t border-sky-100 pt-3 text-xs leading-5 text-slate-500">Для отдельного ПВК просто введите свой процент. При базовых 100% допустимо 1–100%; иначе — от 0 до базового.</p>
        </section>
        <div className="flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p>Пустое значение — «не настроено», а не 0%. До заполнения требований линия отмечается СП-02.</p>
        </div>
        {mutation.error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{mutation.error.message}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200/70 bg-slate-50/70 px-6 py-4">
        <Button type="button" variant="outline" className="min-w-24 rounded-lg border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100" disabled={mutation.isPending} onClick={onClose}>Отмена</Button>
        <Button className="min-w-48 gap-2" disabled={mutation.isPending}><Check className="h-4 w-4" />{mutation.isPending ? 'Сохранение…' : 'Сохранить программу'}</Button>
      </div>
    </form>
  </LargeDialogShell>
}
