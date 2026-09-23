import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, LoaderCircle } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { BlockedActionHint } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { getDateInputValidationReason } from '@/lib/date-format'
import { loadSystemDocumentDateContext } from '@/lib/system-document-storage'
import {
  buildSystemDocumentDateChangePreview,
} from '@/lib/system-document-date-change'
import {
  getSystemDocumentId,
  type SystemDocumentReference,
} from '@/lib/system-document-types'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import { invalidateWeldJoints } from '@/lib/weld-query-utils'
import { useSecurityGuard } from '@/lib/security-context'
import {
  getNewChronologyRootCauseState,
  type WorkflowRootCauseAction,
} from '@/lib/workflow-root-cause-actions'
import { changeSystemDocumentDate } from '@/server/weld-mutations-api'
import type { SystemDocumentDateChangeResult } from '@/server/system-document-date-workflow'

export type SystemDocumentDateEditorProps = {
  reference: SystemDocumentReference
  label: string
  disabled?: boolean
  autoFocus?: boolean
  onMessage?: (message: string) => void
  onSaved?: (result: SystemDocumentDateChangeResult) => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
}

export function SystemDocumentDateEditor({
  reference,
  label,
  disabled = false,
  autoFocus = false,
  onMessage,
  onSaved,
  onRunRootCauseAction,
}: SystemDocumentDateEditorProps) {
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const { requireEditPassword } = useSecurityGuard()
  const saveCheckSettings = useSaveCheckSettings()
  const cycleSequencesKey = reference.cycleSequences?.join(',') ?? ''
  const effectiveReference = useMemo<SystemDocumentReference>(
    () => reference.sourceKind ? { ...reference, documentId: undefined } : reference,
    [
      cycleSequencesKey,
      reference.date,
      reference.documentId,
      reference.methodCode,
      reference.sourceKind,
      reference.title,
      reference.type,
    ],
  )
  const referenceKey = getSystemDocumentId(effectiveReference)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [nextDate, setNextDate] = useState(effectiveReference.date)
  const [serverError, setServerError] = useState<string | null>(null)
  const rowsQuery = useQuery({
    queryKey: ['system-document-date-context', referenceKey],
    queryFn: () => loadSystemDocumentDateContext(effectiveReference),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    setNextDate(effectiveReference.date)
    setServerError(null)
  }, [effectiveReference.date, referenceKey])

  const preview = useMemo(() => rowsQuery.data
    ? buildSystemDocumentDateChangePreview({
        reference: effectiveReference,
        nextDate,
        rows: rowsQuery.data.rows,
        sourcePositions: rowsQuery.data.sourcePositions,
      })
    : null, [effectiveReference, nextDate, rowsQuery.data])
  const chronology = useMemo(() => preview && rowsQuery.data
    ? getNewChronologyRootCauseState({
        previousRows: rowsQuery.data.rows,
        proposedRows: preview.rows,
        settings: saveCheckSettings,
      })
    : { message: null, actions: [] }, [preview, rowsQuery.data, saveCheckSettings])
  const dateReason = getDateInputValidationReason(nextDate, label)
  const blockReason = dateReason || chronology.message || serverError
  const hasChanges = Boolean(nextDate && nextDate !== effectiveReference.date)

  const mutation = useMutation({
    mutationFn: async () => {
      const expectedRows = rowsQuery.data?.rows ?? []
      if (expectedRows.length === 0) throw new Error('В документе больше нет позиций. Обновите данные.')
      if (!(await requireEditPassword('изменение даты документа'))) return null
      return changeSystemDocumentDate({
        data: {
          reference: effectiveReference,
          nextDate,
          expectedVersions: [...new Map(expectedRows.map((row) => [row.id, {
            id: row.id,
            version: String(row.rowVersion ?? ''),
          }])).values()],
        },
      }) as Promise<SystemDocumentDateChangeResult>
    },
    onSuccess: async (result) => {
      if (!result) return
      setServerError(null)
      setNextDate(result.nextDate)
      await invalidateWeldJoints(
        queryClient,
        { upsertRows: result.rows },
        {
          refetchLnkWorkflow:
            effectiveReference.type === 'lnkRequest' && !effectiveReference.sourceKind,
        },
      )
      const nextEffectiveReference = result.nextReference.sourceKind
        ? { ...result.nextReference, documentId: undefined }
        : result.nextReference
      const nextContextKey = [
        'system-document-date-context',
        getSystemDocumentId(nextEffectiveReference),
      ]
      const nextContext = {
        rows: result.rows,
        sourcePositions: rowsQuery.data?.sourcePositions ?? [],
      }
      queryClient.setQueryData(['system-document-date-context', referenceKey], nextContext)
      queryClient.setQueryData(nextContextKey, nextContext)
      onMessage?.(
        `Дата документа изменена у ${result.positionCount} позиций (${result.rowCount} стыков). Наименование сохранено.`,
      )
      onSaved?.(result)
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Не удалось изменить дату документа.'
      setServerError(message)
      onMessage?.(message)
      void rowsQuery.refetch()
    },
  })

  const requestSave = async () => {
    if (!preview || blockReason || !hasChanges || mutation.isPending) return
    const confirmed = await confirmAction({
      title: 'Изменить дату документа',
      itemName: effectiveReference.title,
      description: `Новая дата будет записана сразу во все позиции документа: ${preview.positionCount} поз. в ${preview.rowCount} ст.`,
      warning: 'Полное наименование документа останется без изменений, в том числе номер и дата в тексте имени.',
      confirmLabel: 'Изменить дату',
      tone: 'warning',
    })
    if (confirmed) mutation.mutate()
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-44 flex-1 space-y-1.5 text-xs font-medium text-slate-600">
          <span>{label}</span>
          <Input
            ref={dateInputRef}
            type="date"
            value={nextDate}
            autoFocus={autoFocus}
            disabled={disabled || mutation.isPending || rowsQuery.isLoading}
            onChange={(event) => {
              setNextDate(event.target.value)
              setServerError(null)
            }}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={disabled || mutation.isPending || rowsQuery.isLoading || !hasChanges || Boolean(blockReason) || !preview}
          onClick={() => void requestSave()}
        >
          {mutation.isPending || rowsQuery.isLoading
            ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            : <CalendarClock className="mr-2 h-4 w-4" />}
          Изменить дату
        </Button>
      </div>
      {preview ? (
        <p className="text-xs leading-5 text-slate-500">
          Будет изменено позиций: {preview.positionCount}; стыков: {preview.rowCount}.{' '}
          Полное наименование документа не изменится.
        </p>
      ) : rowsQuery.isError ? (
        <p className="text-xs font-medium text-rose-700">Не удалось загрузить полный состав документа.</p>
      ) : null}
      {blockReason ? (
        <BlockedActionHint
          reason={`Сохранение заблокировано: ${blockReason}`}
          tone="danger"
          actions={chronology.actions.map((action) => ({
            key: action.key,
            label: action.label,
            onAction: () => {
              if (preview && isCurrentDocumentDateTarget(
                action,
                effectiveReference,
                preview.nextTitle,
                preview.nextDate,
              )) {
                dateInputRef.current?.focus()
                return
              }
              onRunRootCauseAction?.(action)
            },
          }))}
        />
      ) : null}
    </div>
  )
}

function isCurrentDocumentDateTarget(
  action: WorkflowRootCauseAction,
  reference: SystemDocumentReference,
  nextTitle: string,
  nextDate: string,
) {
  const target = action.target
  if (target.kind !== 'lnk-control' && target.kind !== 'psto-cycle') return false
  if (target.documentName !== nextTitle || target.documentDate !== nextDate) return false
  if (target.kind === 'lnk-control') {
    const expectedPart = reference.type === 'lnkRequest'
      ? 'request'
      : reference.type === 'lnkConclusion'
        ? 'conclusion'
        : null
    const expectedStage = reference.sourceKind === 'beforeHeatTreatment'
      ? 'beforeHeatTreatment'
      : 'primary'
    return Boolean(
      expectedPart &&
      target.documentPart === expectedPart &&
      target.stage === expectedStage &&
      (!reference.methodCode || target.methodCode === reference.methodCode),
    )
  }
  if (target.kind !== 'psto-cycle') return false
  const isTvmt = reference.methodCode === 'ТВМТ'
  const expectedStage = reference.type === 'pstoRequest'
    ? 'pstoRequest'
    : reference.type === 'pstoConclusion'
      ? 'pstoResult'
      : reference.type === 'lnkRequest' && isTvmt
        ? 'tvmtRequest'
        : reference.type === 'lnkConclusion' && isTvmt
          ? 'tvmtResult'
          : null
  return Boolean(
    expectedStage &&
    target.stage === expectedStage &&
    (!reference.cycleSequences?.length || reference.cycleSequences.includes(target.sequence)),
  )
}
