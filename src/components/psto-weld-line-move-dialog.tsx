import { AlertTriangle, ArrowRight, Check, GitBranch, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type {
  PstoWeldLineMoveDecision,
  PstoWeldLineMoveDisposition,
  PstoWeldLineMovePreview,
  PstoWeldLineMovePreviewRow,
} from '@/lib/psto-line-assignment'

export type PstoWeldLineMoveDialogProps = {
  preview: PstoWeldLineMovePreview
  initialDecisions?: PstoWeldLineMoveDecision[] | null
  pending: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (decisions: PstoWeldLineMoveDecision[]) => void
}

export function PstoWeldLineMoveDialog({
  preview,
  initialDecisions,
  pending,
  error,
  onClose,
  onConfirm,
}: PstoWeldLineMoveDialogProps) {
  const targetIsAssigned = preview.targetState === 'assigned'
  const targetIsCancelled = preview.targetState === 'cancelled'
  const [decisions, setDecisions] = useState<PstoWeldLineMoveDecision[]>(() =>
    buildInitialDecisions(preview, initialDecisions),
  )
  const sourceLabel = formatLineIdentity(preview.sourceIdentity)
  const targetLabel = formatLineIdentity(preview.targetIdentity)
  const decisionRowCount = preview.rows.filter((row) => row.requiresDisposition).length
  const hasDestructiveDecision = decisions.some((decision) => decision.disposition === 'deletePrimary')
  const hasLifecycleDecision = !targetIsAssigned && decisionRowCount > 0

  const setDisposition = (rowId: number, disposition: PstoWeldLineMoveDisposition) => {
    setDecisions((current) => current.map((decision) =>
      decision.rowId === rowId ? { ...decision, disposition } : decision,
    ))
  }

  return (
    <LargeDialogShell
      maxWidthClassName={preview.isChainMove ? 'max-w-[1120px]' : 'max-w-[940px]'}
      maxHeightClassName="max-h-[92vh]"
      overlayClassName="z-[90] bg-slate-950/35"
    >
      <DialogHeader
        title={preview.isChainMove
          ? `Перенос цепочки ${preview.rootJoint}`
          : targetIsAssigned
            ? 'Перенос стыка на линию с ПСТО'
            : targetIsCancelled
              ? 'Перенос стыка на отмененную линию ПСТО'
              : 'Перенос стыка на линию без ПСТО'}
        subtitle={preview.isChainMove
          ? `Будут одновременно перенесены все записи цепочки: ${preview.rows.length}`
          : targetIsAssigned
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

        {preview.isChainMove ? (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <div className="flex items-start gap-2.5">
              <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
              <div className="min-w-0">
                <p className="font-semibold">Вместе с {preview.rootJoint} изменится линия у всей цепочки</p>
                <p className="mt-1 break-words leading-5">
                  {preview.rows.map((row) => row.joint || `#${row.rowId}`).join(', ')}
                </p>
                <p className="mt-1 leading-5 text-sky-900">
                  Проект, шифр и номера стыков не изменятся. Если цепочка уже содержит разрыв,
                  задача диспетчера сохранится на новой линии.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {!preview.isChainMove && targetIsAssigned ? (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <p className="font-semibold">Найден основной комплект: {preview.row.primaryMethods.join(', ')}</p>
            <p className="mt-1 leading-5">
              Если это фактический контроль после ТО, сохраните его без изменений. Отдельный комплект «До ТО» можно оформить позднее.
            </p>
          </div>
        ) : null}

        {!targetIsAssigned ? (
          <div className="mt-4 grid overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCell label="Заявок ПСТО без результата" value={preview.requestOnlyCount} tone="amber" />
            <SummaryCell label="Результатов ПСТО" value={preview.completedPstoCount} />
            <SummaryCell label="Завершено НК до ТО" value={preview.completedPreControlCount} tone="sky" />
            <SummaryCell label="Заявок НК до ТО без результата" value={preview.pendingPreControlCount} tone="amber" />
            <SummaryCell label="Повторных циклов" value={preview.repeatCycleCount} />
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-600">
            <span>{preview.isChainMove ? 'Стыки цепочки' : 'Стык'}</span>
            <span>{decisionRowCount > 0 ? `Требуют решения: ${decisionRowCount}` : 'Дополнительных решений нет'}</span>
          </div>
          {preview.rows.map((row) => (
            <MoveRow
              key={row.rowId}
              row={row}
              targetIsAssigned={targetIsAssigned}
              disposition={getDisposition(decisions, row.rowId)}
              onDispositionChange={(disposition) => setDisposition(row.rowId, disposition)}
            />
          ))}
        </div>

        <div className={`mt-4 rounded-md border px-4 py-3 text-sm leading-5 ${
          targetIsAssigned
            ? 'border-sky-200 bg-sky-50 text-sky-950'
            : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <p className="font-semibold">После сохранения</p>
              {targetIsAssigned ? (
                <p className="mt-1">
                  Назначение ПСТО будет взято с целевой линии. Для каждого затронутого комплекта применяется
                  решение, показанное напротив конкретного стыка.
                </p>
              ) : (
                <p className="mt-1">
                  Выполненные ПСТО, ТВМТ, повторные циклы, заключения и документы останутся в истории.
                  Незавершенные данные будут обработаны отдельно для каждого стыка по выбранному варианту.
                </p>
              )}
              {!preview.isChainMove ? (
                <p className="mt-1">
                  Решение выполнится только после сохранения карточки стыка.
                </p>
              ) : null}
              <p className="mt-1 font-medium">
                Операция неделима: при любой ошибке ни один стык цепочки не будет изменен.
              </p>
            </div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
        <Button variant="outline" onClick={onClose} disabled={pending}>Вернуться к форме</Button>
        <Button
          variant={hasDestructiveDecision || hasLifecycleDecision ? 'destructive' : 'default'}
          onClick={() => onConfirm(decisions)}
          disabled={pending}
        >
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          {preview.isChainMove ? 'Подтвердить перенос цепочки' : 'Применить решение'}
        </Button>
      </div>
    </LargeDialogShell>
  )
}

function MoveRow({
  row,
  targetIsAssigned,
  disposition,
  onDispositionChange,
}: {
  row: PstoWeldLineMovePreviewRow
  targetIsAssigned: boolean
  disposition: PstoWeldLineMoveDisposition
  onDispositionChange: (disposition: PstoWeldLineMoveDisposition) => void
}) {
  const canPromote = row.promotablePreMethods.length > 0 && !row.preservesPerformedHistory
  const transferBlocked = row.activationTransferBlockedMethods.length > 0
  const details = [
    row.primaryMethods.length > 0 ? `Основной НК: ${row.primaryMethods.join(', ')}` : '',
    row.preMethods.length > 0 ? `До ТО: ${row.preMethods.join(', ')}` : '',
    row.pstoResult ? `ПСТО: ${row.pstoResult}` : row.pstoRequest ? 'Есть заявка ПСТО' : '',
    row.repeatCycleCount > 0 ? `Циклов: ${row.repeatCycleCount + 1}` : '',
  ].filter(Boolean)

  return (
    <div className="border-b border-slate-200 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{row.joint || `#${row.rowId}`}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {row.spool ? `Спул: ${row.spool}` : 'Спул не указан'}
            {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
          </p>
        </div>
        {!row.requiresDisposition ? (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
            Перенос без дополнительного решения
          </span>
        ) : row.preservesPerformedHistory && !targetIsAssigned ? (
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
            Выполненная история сохраняется
          </span>
        ) : null}
      </div>

      {row.requiresDisposition && targetIsAssigned ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          <DecisionButton
            selected={disposition === 'keepPrimary'}
            title="Сохранить существующий основной НК"
            description="Существующие заявки, результаты и заключения останутся на основном этапе."
            onClick={() => onDispositionChange('keepPrimary')}
          />
          <DecisionButton
            selected={disposition === 'movePrimaryToBeforeHeatTreatment'}
            disabled={transferBlocked}
            title="Перенести основной комплект в «До ТО»"
            description={transferBlocked
              ? `До ТО уже заняты методы: ${row.activationTransferBlockedMethods.join(', ')}.`
              : 'Основной этап освободится, а комплект целиком сохранится на этапе «До ТО».'}
            onClick={() => onDispositionChange('movePrimaryToBeforeHeatTreatment')}
          />
          <DecisionButton
            selected={disposition === 'deletePrimary'}
            title="Удалить основной комплект"
            description="Заявки, результаты и заключения основного этапа будут удалены."
            tone="danger"
            onClick={() => onDispositionChange('deletePrimary')}
          />
        </div>
      ) : row.requiresDisposition && !row.preservesPerformedHistory ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <DecisionButton
            selected={disposition === 'keepPrimary'}
            title="Оставить основной комплект"
            description="Основной комплект сохранится, незавершенный комплект «До ТО» будет удален."
            onClick={() => onDispositionChange('keepPrimary')}
          />
          <DecisionButton
            selected={disposition === 'promoteBeforeHeatTreatment'}
            disabled={!canPromote}
            title="Перенести завершенный НК до ТО"
            description={canPromote
              ? `Основным станет завершенный комплект: ${row.promotablePreMethods.join(', ')}.`
              : 'Нет завершенного результата НК до ТО, который можно перенести.'}
            onClick={() => onDispositionChange('promoteBeforeHeatTreatment')}
          />
        </div>
      ) : null}
    </div>
  )
}

function DecisionButton({
  selected,
  disabled = false,
  title,
  description,
  tone = 'default',
  onClick,
}: {
  selected: boolean
  disabled?: boolean
  title: string
  description: string
  tone?: 'default' | 'danger'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-24 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? tone === 'danger'
            ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300'
            : 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
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
      <span className="mt-1.5 block text-xs leading-5 text-slate-600">{description}</span>
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

function buildInitialDecisions(
  preview: PstoWeldLineMovePreview,
  initialDecisions?: PstoWeldLineMoveDecision[] | null,
) {
  const initialByRowId = new Map((initialDecisions ?? []).map((decision) => [decision.rowId, decision.disposition]))
  return preview.rows.map((row) => ({
    rowId: row.rowId,
    disposition: initialByRowId.get(row.rowId) ?? 'keepPrimary',
  }))
}

function getDisposition(decisions: PstoWeldLineMoveDecision[], rowId: number) {
  return decisions.find((decision) => decision.rowId === rowId)?.disposition ?? 'keepPrimary'
}

function formatLineIdentity(identity: PstoWeldLineMovePreview['sourceIdentity']) {
  return [identity.projectTitle, identity.subtitleCode, identity.line || 'Линия не указана']
    .filter(Boolean)
    .join(' · ')
}
