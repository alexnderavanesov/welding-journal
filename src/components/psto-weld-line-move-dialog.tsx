import { useId, useState } from 'react'
import { ArrowRight, Check, GitBranch, Loader2 } from 'lucide-react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type { PstoLineRemovalPreviewRow, PstoWeldLineMoveDecision, PstoWeldLineMovePreview } from '@/lib/psto-line-assignment'

export type PstoWeldLineMoveDialogProps = {
  preview: PstoWeldLineMovePreview
  initialDecisions?: PstoWeldLineMoveDecision[] | null
  pending: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (decisions: PstoWeldLineMoveDecision[]) => void
}

export function PstoWeldLineMoveDialog({ preview, initialDecisions, pending, error, onClose, onConfirm }: PstoWeldLineMoveDialogProps) {
  const [selection, setSelection] = useState(() => ({
    preview,
    rowIds: new Set((initialDecisions ?? [])
      .filter(decision => decision.disposition === 'movePreHeatTreatmentToPrimary')
      .map(decision => decision.rowId)),
  }))
  const correctionRows = preview.targetState === 'assigned' ? [] : preview.rows.filter(row => row.stageCorrection?.targetStage === 'primary')
  const correctionRowIds = new Set(correctionRows.map(row => row.rowId))
  const decisions: PstoWeldLineMoveDecision[] = preview.rows.map(row => ({
    rowId: row.rowId,
    disposition: selection.preview === preview && selection.rowIds.has(row.rowId) &&
      correctionRowIds.has(row.rowId) && !row.stageCorrection?.disabledReason
      ? 'movePreHeatTreatmentToPrimary' : 'keepPrimary',
  }))
  const transferRowIds = new Set(decisions.filter(decision => decision.disposition === 'movePreHeatTreatmentToPrimary').map(decision => decision.rowId))
  return <LargeDialogShell maxWidthClassName="max-w-[940px]" maxHeightClassName="max-h-[92vh]" overlayClassName="z-[90] bg-slate-950/35">
    <DialogHeader title={preview.isChainMove ? `Перенос цепочки ${preview.rootJoint}` : 'Перенос стыка на другую линию'}
      subtitle="Проверьте состав переноса и этапы контроля" closeDisabled={pending} onClose={onClose} />
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-4">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
        <span className="min-w-0 flex-1 break-words text-slate-700">{formatLineIdentity(preview.sourceIdentity)}</span>
        <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 break-words font-semibold text-slate-900">{formatLineIdentity(preview.targetIdentity)}</span>
      </div>
      <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
        <p className="flex items-center gap-2 font-semibold"><GitBranch aria-hidden="true" className="h-4 w-4" />Перенос с сохранением истории</p>
        <p className="mt-1">Назначение ПСТО будет взято с целевой линии. По умолчанию НК до ТО остаётся НК до ТО, основной НК — основным. ПСТО, ТВМТ и повторные циклы сохраняются.</p>
        <p className="mt-1">{preview.targetState === 'assigned' ? 'Для новых работ сохраняются требования к предыдущим этапам. Основной НК не заменяет НК до ТО.' : 'Если оставить исходный этап, НК до ТО останется видимым в документах и не заполнит основной НК.'}</p>
        {correctionRows.length > 0 ? <p className="mt-1">Для каждого стыка можно перенести весь комплект НК до ТО в основной этап: все методы, заявки, результаты и заключения вместе, с исходными датами и названиями. Целевой этап должен быть пустым; проверяются хронология и зависимости заявки ПСТО. Причина запрета показана у варианта переноса.</p> : null}
        {preview.isChainMove ? <p className="mt-1">Вместе с базовым стыком переносится вся цепочка. Проект, шифр и номера стыков не меняются. При любой ошибке изменения не сохранятся.</p> : null}
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
        <SummaryCell label="Стыков" value={preview.rows.length} />
        <SummaryCell label="Позиций НК до ТО" value={preview.preControlCount} tone="sky" />
        <SummaryCell label="Повторных циклов" value={preview.repeatCycleCount} />
      </div>
      {correctionRows.length > 0 ? <p role="status" className="mt-4 text-sm font-medium text-slate-700">Стыков: перенос НК в основной — {transferRowIds.size} · сохранить этапы — {preview.rows.length - transferRowIds.size}</p> : null}
      <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {preview.rows.map(row => <div key={row.rowId} className="px-4 py-3 text-sm">
          <p className="font-semibold text-slate-900">{row.joint || `#${row.rowId}`}</p>
          <p className="mt-1 text-xs text-slate-500">Спул: {row.spool || '—'} · {row.primaryMethods.length ? `Основной НК: ${row.primaryMethods.join(', ')} · ` : ''}{row.preMethods.length ? `До ТО: ${row.preMethods.join(', ')} · ` : ''}{transferRowIds.has(row.rowId) ? 'Весь НК до ТО перейдёт в основной' : 'Этапы сохраняются'}</p>
          {correctionRowIds.has(row.rowId) ? <PstoStageCorrectionChoice row={row} moveSelected={transferRowIds.has(row.rowId)} disabled={pending} onChange={move => {
            setSelection(current => {
              const rowIds = new Set(current.preview === preview ? current.rowIds : [])
              if (move) rowIds.add(row.rowId)
              else rowIds.delete(row.rowId)
              return { preview, rowIds }
            })
          }} /> : null}
        </div>)}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">Изменения сохраняются вместе с карточкой стыка. Ошибочные документы исправляются отдельно в ЛНК/ПСТО с проверкой зависимостей.</p>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
    </div>
    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onClose} disabled={pending}>Вернуться к форме</Button>
      <Button onClick={() => onConfirm(decisions)} disabled={pending}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
        {preview.isChainMove ? 'Подтвердить перенос цепочки' : 'Подтвердить перенос'}
      </Button>
    </div>
  </LargeDialogShell>
}

export function PstoStageCorrectionChoice({ row, moveSelected, disabled, onChange }: {
  row: PstoLineRemovalPreviewRow
  moveSelected: boolean
  disabled: boolean
  onChange: (move: boolean) => void
}) {
  const id = useId()
  const correction = row.stageCorrection
  if (!correction) return null
  const toPrimary = correction.targetStage === 'primary'
  return <fieldset className="mt-3" disabled={disabled}>
    <legend className="sr-only">Этап НК для стыка {row.joint || `#${row.rowId}`}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {([false, true] as const).map(move => {
        const blocked = move && Boolean(correction.disabledReason)
        return <label key={String(move)} className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs leading-5 ${blocked || disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${moveSelected === move ? 'border-sky-300 bg-sky-50 text-sky-950' : 'border-slate-200 bg-white text-slate-600'}`}>
          <input type="radio" name={id} checked={moveSelected === move} disabled={blocked}
            aria-describedby={blocked ? `${id}-reason` : undefined}
            onChange={() => onChange(move)} className="mt-1 h-3.5 w-3.5 shrink-0 accent-sky-600" />
          <span>{move
            ? toPrimary ? 'Весь НК до ТО → основной' : 'Весь основной НК → до ТО'
            : toPrimary ? 'Оставить НК до ТО' : 'Оставить основной НК'}</span>
        </label>
      })}
    </div>
    {correction.disabledReason ? <p id={`${id}-reason`} className="mt-2 text-xs leading-5 text-amber-800">Перенос недоступен: {correction.disabledReason}</p> : null}
  </fieldset>
}

function SummaryCell({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: 'slate' | 'amber' | 'sky'
}) {
  const valueClass = tone === 'amber'
    ? 'text-amber-700'
    : tone === 'sky'
      ? 'text-sky-700'
      : 'text-slate-900'
  return (
    <div className="min-h-20 bg-white px-3 py-3">
      <p className="text-[11px] leading-4 text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}

function formatLineIdentity(identity: PstoWeldLineMovePreview['sourceIdentity']) {
  return [identity.projectTitle, identity.subtitleCode, identity.line || 'Линия не указана']
    .filter(Boolean)
    .join(' · ')
}
