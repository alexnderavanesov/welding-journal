import { AlertTriangle, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type {
  PstoWeldLineMoveDisposition,
  PstoWeldLineMovePreview,
} from '@/lib/psto-line-assignment'

export type PstoWeldLineMoveDialogProps = {
  preview: PstoWeldLineMovePreview
  initialDisposition?: PstoWeldLineMoveDisposition | null
  pending: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (disposition: PstoWeldLineMoveDisposition) => void
}

export function PstoWeldLineMoveDialog({
  preview,
  initialDisposition,
  pending,
  error,
  onClose,
  onConfirm,
}: PstoWeldLineMoveDialogProps) {
  const targetIsAssigned = preview.targetState === 'assigned'
  const canPromote = preview.row.promotablePreMethods.length > 0
  const [disposition, setDisposition] = useState<PstoWeldLineMoveDisposition>(
    initialDisposition ?? 'keepPrimary',
  )
  const sourceLabel = formatLineIdentity(preview.sourceIdentity)
  const targetLabel = formatLineIdentity(preview.targetIdentity)
  const preservesPerformedHistory = preview.row.preservesPerformedHistory
  const targetIsCancelled = preview.targetState === 'cancelled'

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[940px]"
      maxHeightClassName="max-h-[90vh]"
      overlayClassName="z-[90] bg-slate-950/35"
    >
      <DialogHeader
        title={targetIsAssigned
          ? 'Перенос стыка на линию с ПСТО'
          : targetIsCancelled
            ? 'Перенос стыка на отмененную линию ПСТО'
            : 'Перенос стыка на линию без ПСТО'}
        subtitle={targetIsAssigned
          ? `Стык ${preview.row.joint || `#${preview.row.rowId}`} · выберите судьбу уже созданного основного НК`
          : `Стык ${preview.row.joint || `#${preview.row.rowId}`} · проверьте, как будет обработана сохраненная история`}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-4">
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={sourceLabel}>{sourceLabel}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900" title={targetLabel}>{targetLabel}</span>
        </div>

        {targetIsAssigned ? (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <p className="font-semibold">Найден основной комплект: {preview.row.primaryMethods.join(', ')}</p>
            <p className="mt-1 leading-5">
              Если это фактический контроль после ТО, сохраните его без изменений. Отдельный комплект «До ТО» можно оформить позднее.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCell label="Заявок ПСТО без результата" value={preview.requestOnlyCount} tone="amber" />
            <SummaryCell label="Результатов ПСТО" value={preview.completedPstoCount} />
            <SummaryCell label="Завершено НК до ТО" value={preview.completedPreControlCount} tone="sky" />
            <SummaryCell label="Заявок НК до ТО без результата" value={preview.pendingPreControlCount} tone="amber" />
            <SummaryCell label="Повторных циклов" value={preview.repeatCycleCount} />
          </div>
        )}

        {targetIsAssigned ? <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <DecisionButton
            selected={disposition === 'keepPrimary'}
            title="Сохранить существующий основной НК"
            description={`Заявки, результаты и заключения ${preview.row.primaryMethods.join(', ')} не изменятся. После сохранения отдельный НК до ТО можно заполнить в удобное время.`}
            onClick={() => setDisposition('keepPrimary')}
          />
          <DecisionButton
            selected={disposition === 'movePrimaryToBeforeHeatTreatment'}
            title="Перенести основной комплект в «До ТО»"
            description={`Заявки, результаты и заключения ${preview.row.primaryMethods.join(', ')} сохранятся на этапе «До ТО». Основной этап освободится для контроля после ПСТО и годной ТВМТ.`}
            onClick={() => setDisposition('movePrimaryToBeforeHeatTreatment')}
          />
          <DecisionButton
            selected={disposition === 'deletePrimary'}
            title="Удалить основной комплект"
            description={`Заявки, результаты и заключения ${preview.row.primaryMethods.join(', ')} будут удалены. Назначения методов и данные дубль-контроля сохранятся.`}
            onClick={() => setDisposition('deletePrimary')}
          />
        </div> : !preservesPerformedHistory ? <div className="mt-4 grid gap-3 md:grid-cols-2">
          <DecisionButton
            selected={disposition === 'keepPrimary'}
            title="Оставить основной комплект"
            description={preview.row.primaryMethods.length > 0
              ? `Сохранятся: ${preview.row.primaryMethods.join(', ')}. Комплект НК до ТО будет удален.`
              : 'Основной комплект останется пустым. Данные НК до ТО будут удалены.'}
            onClick={() => setDisposition('keepPrimary')}
          />
          <DecisionButton
            selected={disposition === 'promoteBeforeHeatTreatment'}
            disabled={!canPromote}
            title="Перенести завершенный НК до ТО"
            description={canPromote
              ? `В основном комплекте останутся завершенные позиции до ТО: ${preview.row.promotablePreMethods.join(', ')}. Прежний основной комплект ВИК/РК/УЗК/ПВК будет заменен.`
              : 'Нет завершенного результата НК до ТО, который можно перенести.'}
            onClick={() => setDisposition('promoteBeforeHeatTreatment')}
          />
        </div> : null}

        <div className={`mt-4 rounded-md border px-4 py-3 text-sm leading-5 ${
          targetIsAssigned || preservesPerformedHistory
            ? 'border-sky-200 bg-sky-50 text-sky-950'
            : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold">{targetIsAssigned ? 'После сохранения' : preservesPerformedHistory ? 'Что будет сохранено' : 'Что будет изменено'}</p>
              {targetIsAssigned ? (
                <p className="mt-1">
                  Система назначит ПСТО по целевой линии. При сохранении основного комплекта ДЗ-20 временно останется,
                  а первая заявка ПСТО будет доступна после годного НК до ТО.
                </p>
              ) : preservesPerformedHistory ? (
                <p className="mt-1">Выполненные ПСТО, ТВМТ, повторные циклы, НК до ТО и связанные документы останутся в истории стыка.</p>
              ) : (
                <p className="mt-1">Незавершенная заявка ПСТО и невыбранный комплект НК до ТО будут удалены.</p>
              )}
              {!targetIsAssigned && !preservesPerformedHistory && disposition === 'promoteBeforeHeatTreatment' ? (
                <p className="mt-1">Прежний основной комплект ВИК/РК/УЗК/ПВК будет заменен завершенным комплектом до ТО.</p>
              ) : null}
              {!targetIsAssigned && !preservesPerformedHistory && preview.row.pendingPreMethods.length > 0 ? (
                <p className="mt-1">Незавершенные заявки до ТО: {preview.row.pendingPreMethods.join(', ')}.</p>
              ) : null}
              <p className="mt-1 font-medium">Данные пока не изменятся. Решение выполнится только после сохранения карточки стыка.</p>
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
        <Button variant="outline" onClick={onClose} disabled={pending}>Вернуться к форме</Button>
        <Button
          variant={disposition === 'deletePrimary' || !targetIsAssigned ? 'destructive' : 'default'}
          onClick={() => onConfirm(disposition)}
          disabled={pending}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Применить решение
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function DecisionButton({
  selected,
  disabled = false,
  title,
  description,
  onClick,
}: {
  selected: boolean
  disabled?: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-28 rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
          : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/50'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-transparent'
        }`}>
          <Check className="h-3 w-3" />
        </span>
        {title}
      </span>
      <span className="mt-2 block text-xs leading-5 text-slate-600">{description}</span>
    </button>
  )
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
