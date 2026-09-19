import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Loader2,
} from 'lucide-react'

import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { formatDisplayDate } from '@/lib/date-format'
import type {
  LnkDocumentStageTransferPreview,
  LnkDocumentStageTransferResult,
  LnkStageTransferPosition,
  LnkStageTransferPositionPreview,
  LnkStageTransferStage,
} from '@/lib/lnk-stage-transfer'
import { useSecurityGuard } from '@/lib/security-context'
import type { SystemDocumentReference } from '@/lib/system-document-types'
import {
  previewLnkDocumentStageTransfer,
  transferLnkDocumentStage,
} from '@/server/lnk-document-stage-transfer'

type TransferReference = SystemDocumentReference & { documentId: number }

export type LnkStageTransferDialogProps = {
  reference: TransferReference
  onClose: () => void
  onTransferred: (result: LnkDocumentStageTransferResult) => Promise<void> | void
  onPendingChange?: (pending: boolean) => void
}

export function LnkStageTransferDialog({
  reference,
  onClose,
  onTransferred,
  onPendingChange,
}: LnkStageTransferDialogProps) {
  const { requireEditPassword } = useSecurityGuard()
  const [preview, setPreview] = useState<LnkDocumentStageTransferPreview | null>(null)
  const [review, setReview] = useState<LnkDocumentStageTransferPreview | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<'selection' | 'review'>('selection')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onPendingChange?.(pending)
  }, [onPendingChange, pending])

  useEffect(() => () => onPendingChange?.(false), [onPendingChange])

  useEffect(() => {
    let active = true
    setPending(true)
    setError(null)
    setPreview(null)
    setReview(null)
    setStep('selection')
    void previewLnkDocumentStageTransfer({ data: reference })
      .then((nextPreview) => {
        if (!active) return
        setPreview(nextPreview)
        setSelectedKeys(new Set(
          nextPreview.positions
            .filter((position) => !position.disabledReason)
            .map(getPositionKey),
        ))
      })
      .catch((failure) => {
        if (active) setError(getErrorMessage(failure, 'Не удалось подготовить перенос этапа контроля.'))
      })
      .finally(() => {
        if (active) setPending(false)
      })
    return () => {
      active = false
    }
  }, [reference])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (!pending) onClose()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onClose, pending])

  const selectedPositions = useMemo(
    () => (preview?.positions ?? [])
      .filter((position) => selectedKeys.has(getPositionKey(position)))
      .map(({ rowId, methodCode }) => ({ rowId, methodCode })),
    [preview, selectedKeys],
  )

  const togglePosition = (position: LnkStageTransferPositionPreview) => {
    if (position.disabledReason || pending) return
    setSelectedKeys((current) => {
      const next = new Set(current)
      const key = getPositionKey(position)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setError(null)
  }

  const selectAllAvailable = () => {
    if (!preview) return
    setSelectedKeys(new Set(
      preview.positions
        .filter((position) => !position.disabledReason)
        .map(getPositionKey),
    ))
    setError(null)
  }

  const clearSelection = () => {
    setSelectedKeys(new Set())
    setError(null)
  }

  const prepareReview = async () => {
    if (selectedPositions.length === 0) {
      setError('Выберите хотя бы один комплект для переноса.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const nextReview = await previewLnkDocumentStageTransfer({
        data: { ...reference, positions: selectedPositions },
      })
      setReview(nextReview)
      setStep('review')
    } catch (failure) {
      setError(getErrorMessage(failure, 'Не удалось проверить выбранные комплекты.'))
    } finally {
      setPending(false)
    }
  }

  const applyTransfer = async () => {
    if (!review || review.positionCount === 0) return
    setPending(true)
    setError(null)
    try {
      const allowed = await requireEditPassword(
        `изменение этапа контроля документа «${reference.title}»`,
      )
      if (!allowed) return
      const result = await transferLnkDocumentStage({
        data: {
          ...reference,
          positions: selectedPositions,
          expectedVersions: review.expectedVersions,
        },
      })
      await onTransferred(result)
      onClose()
    } catch (failure) {
      setError(getErrorMessage(failure, 'Не удалось изменить этап контроля.'))
    } finally {
      setPending(false)
    }
  }

  const activePreview = step === 'review' ? review : preview
  const sourceLabel = formatStage(activePreview?.sourceStage)
  const targetLabel = formatStage(activePreview?.targetStage)

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1180px]"
      maxHeightClassName="max-h-[92vh]"
      overlayClassName="z-[105] bg-slate-950/35"
      panelClassName="overflow-hidden"
    >
      <DialogHeader
        title="Изменить этап контроля"
        subtitle={reference.title}
        onClose={() => {
          if (!pending) onClose()
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-4">
        {activePreview ? (
          <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 font-semibold text-slate-800">{sourceLabel}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 text-right font-semibold text-sky-800">{targetLabel}</span>
          </div>
        ) : null}

        {pending && !preview ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Подготавливаем состав документа
          </div>
        ) : null}

        {preview && step === 'selection' ? (
          <>
            <div className="mt-4 grid overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-3">
              <SummaryCell label="Позиций в документе" value={preview.positions.length} />
              <SummaryCell label="Доступно" value={preview.transferablePositionCount} tone="sky" />
              <SummaryCell label="Недоступно" value={preview.blockedPositionCount} tone="amber" />
            </div>

            <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2.5">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-600">Комплекты контроля</p>
                  <p className="mt-0.5 text-xs text-slate-500">Выбрано: {selectedPositions.length}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={clearSelection} disabled={pending || selectedPositions.length === 0}>
                    Снять выбор
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={selectAllAvailable} disabled={pending || preview.transferablePositionCount === 0}>
                    Выбрать доступные
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-slate-200">
                {preview.positions.map((position) => (
                  <TransferPositionRow
                    key={getPositionKey(position)}
                    position={position}
                    checked={selectedKeys.has(getPositionKey(position))}
                    onToggle={() => togglePosition(position)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}

        {review && step === 'review' ? (
          <TransferReview preview={review} selectedKeys={selectedKeys} />
        ) : null}

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-5 py-4">
        <Button type="button" variant="outline" onClick={step === 'review' ? () => {
          setStep('selection')
          setReview(null)
          setError(null)
        } : onClose} disabled={pending}>
          {step === 'review' ? <ArrowLeft className="mr-2 h-4 w-4" /> : null}
          {step === 'review' ? 'Вернуться к выбору' : 'Отмена'}
        </Button>
        {step === 'selection' ? (
          <Button type="button" onClick={() => void prepareReview()} disabled={pending || selectedPositions.length === 0 || !preview}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
            Проверить перенос
          </Button>
        ) : (
          <Button type="button" onClick={() => void applyTransfer()} disabled={pending || !review}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Подтвердить перенос
          </Button>
        )}
      </div>
    </LargeDialogShell>
  )
}

function TransferReview({
  preview,
  selectedKeys,
}: {
  preview: LnkDocumentStageTransferPreview
  selectedKeys: Set<string>
}) {
  const selected = preview.positions.filter((position) => selectedKeys.has(getPositionKey(position)))
  const requestNames = uniqueText(selected.map((position) => position.source.requestName))
  const conclusionNames = uniqueText(selected.map((position) => position.source.conclusionName))
  const defectCount = selected.filter((position) => position.source.defectDescription).length
  const exposureCount = selected.filter(
    (position) => position.source.rkExposureConfirmedDiameter !== null,
  ).length

  return (
    <>
      <div className="mt-4 grid overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-4">
        <SummaryCell label="Стыков" value={preview.rowCount} />
        <SummaryCell label="Комплектов" value={preview.positionCount} tone="sky" />
        <SummaryCell label="С результатом" value={preview.completedResultCount} />
        <SummaryCell label="Методы" value={preview.methodCodes.join(', ') || '-'} />
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-semibold uppercase text-slate-600">
          Вместе с выбранными позициями
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <ReviewFact label="Заявки" value={requestNames.length} detail={requestNames.join(', ') || 'Нет'} />
          <ReviewFact label="Заключения" value={conclusionNames.length} detail={conclusionNames.join(', ') || 'Нет'} />
          <ReviewFact label="Описания дефектов" value={defectCount} detail="Переносятся без изменений" />
          <ReviewFact label="Параметры РК" value={exposureCount} detail="Переносятся вместе с РК" />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-semibold uppercase text-slate-600">
          Итоговый состав
        </div>
        <div className="divide-y divide-slate-200">
          {selected.map((position) => (
            <TransferPositionRow
              key={getPositionKey(position)}
              position={position}
              checked
              readOnly
              onToggle={() => undefined}
            />
          ))}
        </div>
      </div>

      <div className={`mt-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
        preview.resultingSystemWarningCount > 0
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-sky-200 bg-sky-50 text-sky-950'
      }`}>
        {preview.resultingSystemWarningCount > 0
          ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          : <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />}
        <div>
          <p className="font-semibold">
            {preview.resultingSystemWarningCount > 0
              ? `После переноса СП-01 будет у ${preview.resultingSystemWarningCount} стыков`
              : 'После переноса по выбранным стыкам СП-01 не будет'}
          </p>
          <p className="mt-1 leading-5">
            Операция атомарная: при конфликте или изменении данных ни один выбранный комплект не будет перенесён.
          </p>
        </div>
      </div>
    </>
  )
}

function TransferPositionRow({
  position,
  checked,
  readOnly = false,
  onToggle,
}: {
  position: LnkStageTransferPositionPreview
  checked: boolean
  readOnly?: boolean
  onToggle: () => void
}) {
  const disabled = Boolean(position.disabledReason)
  const source = position.source
  const identity = [position.projectTitle, position.subtitleCode, position.line]
    .filter(Boolean)
    .join(' · ')
  return (
    <label className={`grid gap-3 px-4 py-3 lg:grid-cols-[auto_minmax(190px,0.8fr)_minmax(0,2fr)] ${
      disabled ? 'cursor-not-allowed bg-slate-50' : readOnly ? '' : 'cursor-pointer hover:bg-sky-50/60'
    }`}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
        checked={checked}
        disabled={disabled || readOnly}
        onChange={onToggle}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{position.joint}</span>
          <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
            {position.methodCode}
          </span>
        </div>
        <p className="mt-1 break-words text-xs leading-5 text-slate-500">{identity || 'Линия не указана'}</p>
        {position.disabledReason ? (
          <p className="mt-1 text-xs font-medium leading-5 text-amber-800">{position.disabledReason}</p>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <PackageField label="Заявка" value={source.requestName} date={source.requestDate} />
        <PackageField label="Результат" value={source.result} />
        <PackageField label="Заключение" value={source.conclusionName} date={source.conclusionDate} />
        <PackageField label="Описание дефекта" value={source.defectDescription} />
        {position.methodCode === 'РК' ? (
          <PackageField
            label="Диаметр экспозиции"
            value={source.rkExposureConfirmedDiameter === null
              ? ''
              : String(source.rkExposureConfirmedDiameter)}
          />
        ) : null}
      </div>
    </label>
  )
}

function PackageField({ label, value, date }: { label: string; value: string; date?: string }) {
  const details = [value || '-', date ? formatDisplayDate(date) : ''].filter(Boolean).join(' · ')
  return (
    <div className="min-w-0">
      <p className="font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 break-words leading-5 text-slate-700" title={details}>{details}</p>
    </div>
  )
}

function SummaryCell({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number | string
  tone?: 'slate' | 'sky' | 'amber'
}) {
  return (
    <div className={`bg-white px-4 py-3 ${
      tone === 'sky' ? 'text-sky-800' : tone === 'amber' ? 'text-amber-800' : 'text-slate-800'
    }`}>
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function ReviewFact({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 break-words text-xs leading-5 text-slate-500" title={detail}>{detail}</p>
    </div>
  )
}

function getPositionKey(position: Pick<LnkStageTransferPosition, 'rowId' | 'methodCode'>) {
  return `${position.rowId}:${position.methodCode}`
}

function formatStage(stage?: LnkStageTransferStage) {
  if (stage === 'beforeHeatTreatment') return 'До ТО'
  if (stage === 'primary') return 'Основной'
  return ''
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}
