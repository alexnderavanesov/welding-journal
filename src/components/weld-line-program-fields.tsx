import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import type { WeldInput } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import { isAngularConnectionType } from '@/lib/connection-type'
import { getLayeredControlSaveError } from '@/lib/layered-control-rules'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { getExpectedWeldRowVersions } from '@/lib/weld-save-utils'
import { findLineProgram } from '@/server/line-program'
import { changeLayeredControl } from '@/server/line-program-control'
import { useSecurityGuard } from '@/lib/security-context'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { EXCLUDED_CONTROL_ASSIGNMENT_REASON, isActiveOfficialWeld } from '@/lib/control-assignment-eligibility'

export function WeldLineProgramFields({ draft, setDraft }: { draft: WeldInput; setDraft: Dispatch<SetStateAction<WeldInput>> }) {
  const identity = useMemo(() => ({ projectTitle: String(draft.projectTitle ?? '').trim(), subtitleCode: String(draft.subtitleCode ?? '').trim(), line: String(draft.line ?? '').trim() }), [draft.projectTitle, draft.subtitleCode, draft.line])
  const debounced = useDebouncedValue(identity, 200)
  const query = useQuery({ queryKey: ['line-program', 'identity', debounced], queryFn: () => findLineProgram({ data: debounced }), enabled: Boolean(debounced.line),
    staleTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false })
  const current = identity === debounced
  useEffect(() => {
    if (!current || !query.isSuccess) return
    const line = query.data
    const values = { category: line?.category ?? null, groupName: line?.groupName ?? null,
      weldControlPercent: line?.weldControlPercent ?? null, pvkControlPercent: line?.pvkControlPercent ?? null,
      lineProgramId: line?.id ?? null, hasVik: 'да' }
    setDraft((row) => {
      // A response for the previous line must not overwrite the current draft.
      if (String(row.projectTitle ?? '').trim() !== identity.projectTitle ||
          String(row.subtitleCode ?? '').trim() !== identity.subtitleCode ||
          String(row.line ?? '').trim() !== identity.line) return row
      return Object.entries(values).every(([key, value]) => Object.is(row[key as keyof WeldInput], value))
        ? row : { ...row, ...values }
    })
  }, [query.data, query.isSuccess, current, identity, setDraft])
  return <span className="text-xs text-slate-600">{query.error ? 'Не удалось прочитать программу линии. Повторите открытие.' :
    !current || query.isFetching ? 'Читаем программу линии…' : query.data ?
      `Программа линии: базовый ${query.data.weldControlPercent ?? '—'}%, ПВК ${query.data.pvkControlPercent ?? '—'}%. ${query.data.configurationIssue ?? 'Общие свойства изменяются в программе линий.'}` :
      'Новая линия появится в программе после сохранения. Настройте её общие свойства в «Программе линий» (СП-02).'}</span>
}

export function WeldLayeredControlField({ draft, setDraft }: { draft: WeldInput; setDraft: Dispatch<SetStateAction<WeldInput>> }) {
  const { requireEditPassword } = useSecurityGuard()
  const confirmAction = useConfirmAction()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const queryClient = useQueryClient()
  const assigned = draft.layeredControlAssigned || draft.layeredControlRequest?.assigned
  const excluded = !isActiveOfficialWeld(draft)
  const reason = getLayeredControlSaveError({ ...draft, hasPvk: 'да', layeredControlAssigned: true } as WeldRow)
  if (!isAngularConnectionType(draft.connectionType) && !assigned) return null
  return <div className="space-y-2 border-t bg-sky-50 p-4 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" aria-label="Послойная замена РК/УЗК" checked={Boolean(assigned)} disabled={Boolean(draft.layeredControlAssigned) || busy || excluded}
      onChange={async (event) => {
        if (inFlight.current) return
        if (!event.target.checked) { setDraft((row) => ({ ...row, layeredControlRequest: undefined })); return }
        if (reason) { setError(reason); return }
        inFlight.current = true
        setBusy(true)
        setError('')
        try {
          if (['отменен', 'дополнительный'].includes(String(draft.hasPvk)) && !await confirmAction({
            title: 'Назначить послойный контроль?',
            itemName: `${draft.line || 'Без линии'} · ${draft.joint || draft.id || 'Новый стык'}`,
            description: `Назначение ПВК изменится с «${draft.hasPvk}» на «да». Это необходимо для послойного контроля.`,
            warning: 'Изменения применятся при сохранении стыка.',
            confirmLabel: 'Перевести ПВК в «да»',
            tone: 'warning',
          })) return
          setDraft((row) => ({ ...row, hasPvk: 'да', layeredControlRequest: { assigned: true, confirmPvk: true } }))
        } finally { inFlight.current = false; setBusy(false) }
      }} />Послойная замена РК/УЗК</label>
    <p>Только У-стыки. Четыре послойных заключения создаются после собственного основного ПВК; одна отметка назначает ВИК и ПВК кромок и слоёв.</p>
    {excluded ? <p>{EXCLUDED_CONTROL_ASSIGNMENT_REASON}</p> : null}
    {draft.layeredControlAssigned && draft.id ? <Button type="button" variant="outline" disabled={busy || excluded} onClick={async () => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setError('')
      try {
        if (!await confirmAction({
          title: 'Убрать послойный контроль?',
          itemName: `${draft.line || 'Без линии'} · ${draft.joint || draft.id}`,
          description: 'Будут сняты послойная отметка и четыре заключения: ВИК и ПВК кромок и слоёв. Обычные назначения, результаты, заявки и документы сохранятся.',
          warning: 'Действие применяется сразу после подтверждения, только к этому стыку. Остальные изменения карточки сохраняются отдельно.',
          confirmLabel: 'Убрать послойный контроль',
          tone: 'warning',
        })) return
        if (!await requireEditPassword('удаление послойного комплекта')) return
        const saved = await changeLayeredControl({ data: { targets: getExpectedWeldRowVersions([draft as WeldRow]), assigned: false, confirmedRemoval: true } })
        setDraft((row) => ({ ...row, layeredControlAssigned: false, layeredControlRequest: undefined, rowVersion: saved[0].rowVersion }))
        scheduleWeldDataRefresh(queryClient, { upsertRows: saved })
      } catch (cause) { setError((cause as Error).message) } finally { inFlight.current = false; setBusy(false) }
    }}>Убрать послойный контроль</Button> : null}
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
  </div>
}
