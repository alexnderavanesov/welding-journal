import { createElement, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LnkResultChangesSummary } from '@/components/lnk-result-changes-summary'
import { savePreHeatTreatmentLnkResultEdits } from '@/server/pre-heat-treatment-lnk-workflow'
import type { WeldRow } from './dispatcher-types'
import type { PreHeatTreatmentControlRecord } from './lnk-control-stage'
import type { LnkResultEditChange, PreHeatTreatmentResultEditDraft } from './lnk-result-edit-plan'
import { buildPreHeatTreatmentResultEditWrites, type PreHeatTreatmentResultEditBatch } from './pre-heat-treatment-result-edit-plan'
import { useConfirmAction } from './confirm-action-context'
import { withSpecialistCorrectionConfirmation } from './specialist-correction-confirmation'
import { scheduleWeldDataRefresh } from './weld-query-utils'

export function usePreHeatTreatmentResultEditActions({ isOpen, onClose, setMessage, onSaved }: {
  isOpen: boolean
  onClose: () => void
  setMessage: (message: string) => void
  onSaved: (rows: WeldRow[]) => void
}) {
  const confirm = useConfirmAction()
  const client = useQueryClient()
  const originals = useRef(new Map<number, WeldRow>())
  const busy = useRef(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [pendingResultChanges, setPending] = useState<Record<string, PreHeatTreatmentResultEditDraft | null>>({})
  const clear = () => { originals.current.clear(); setPending({}) }
  // Parent navigation/unmount cannot turn a discarded editor into a stored draft.
  useEffect(() => { if (!isOpen && !busy.current) clear() }, [isOpen])
  const mutation = useMutation({
    mutationFn: (payload: PreHeatTreatmentResultEditBatch) => withSpecialistCorrectionConfirmation(
      confirmation => savePreHeatTreatmentLnkResultEdits({ data: { ...payload, specialistCorrectionConfirmation: confirmation } }) as Promise<WeldRow[]>, confirm),
    onSuccess: rows => {
      clear()
      scheduleWeldDataRefresh(client, { upsertRows: rows })
      onSaved(rows)
      setMessage(`Изменения результатов НК до ТО сохранены для стыков: ${rows.length}`)
      onClose()
    },
    onError: error => setMessage((error as Error).message),
  })

  const stageResultChange = (row: WeldRow, control: PreHeatTreatmentControlRecord, patch: PreHeatTreatmentResultEditDraft | null) => {
    if (busy.current) return
    if (!originals.current.has(row.id)) originals.current.set(row.id, structuredClone(row))
    const original = originals.current.get(row.id)!.preHeatTreatmentControls?.find(item => item.id === control.id)
    if (!original) { setMessage('Исходный результат недоступен. Обновите отчет.'); return }
    setPending(current => {
      const next = { ...current }
      if (patch !== null && patch.result === original.result) delete next[control.id]
      else next[control.id] = patch === null ? null : { result: patch.result,
        conclusionName: String(original.conclusionName ?? ''), conclusionDate: String(original.conclusionDate ?? '') }
      return next
    })
  }

  const saveChanges = async () => {
    if (busy.current || Object.keys(pendingResultChanges).length === 0) return
    const rows = structuredClone([...originals.current.values()])
    const targets = new Map(rows.flatMap(row => (row.preHeatTreatmentControls ?? []).map(control => [String(control.id), { row, control }] as const)))
    const summary: LnkResultEditChange[] = []
    const payload: PreHeatTreatmentResultEditBatch = { changes: [] }
    for (const [key, draft] of Object.entries(pendingResultChanges)) {
      const target = targets.get(key)
      if (!target) { setMessage('Исходный результат недоступен. Сбросьте изменения.'); return }
      const { row, control } = target
      payload.changes.push({ rowId: row.id, relationId: control.id, expectedVersion: String(row.rowVersion ?? ''), result: draft?.result ?? null })
      summary.push({ key, rowId: row.id, joint: String(row.joint ?? row.id), line: String(row.line ?? ''), subtitleCode: String(row.subtitleCode ?? ''),
        project: String(row.projectTitle ?? ''), method: `${control.method} до ТО`, from: String(control.result ?? ''), to: draft?.result ?? null })
    }
    try { buildPreHeatTreatmentResultEditWrites({ rows, changes: payload.changes }) }
    catch (error) { setMessage((error as Error).message); return }
    busy.current = true
    setIsConfirming(true)
    try {
      if (!await confirm({ title: 'Подтвердить изменения результатов',
        tone: 'neutral',
        description: createElement(LnkResultChangesSummary, { changes: summary }),
        confirmLabel: 'Применить изменения', cancelLabel: 'Вернуться к редактированию' })) return
      await mutation.mutateAsync(payload)
    } catch { /* The mutation reports errors; preserve every pending choice. */ }
    finally { busy.current = false; setIsConfirming(false) }
  }
  const discardAndClose = () => { if (!busy.current) { clear(); onClose() } }
  const resetChanges = () => { if (!busy.current) clear() }
  return { pendingResultChanges, pendingResultCount: Object.keys(pendingResultChanges).length,
    isPending: isConfirming || mutation.isPending, stageResultChange, saveChanges, discardAndClose, resetChanges }
}
