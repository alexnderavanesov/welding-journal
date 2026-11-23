import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { BlockedActionHint } from '@/components/blocked-action-hint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirmAction } from '@/lib/confirm-action-context'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { formatDisplayDate, getDateInputValidationReason } from '@/lib/date-format'
import { documentContextKey, effectiveDocumentReference, useSystemDocumentContext } from '@/lib/use-system-document-context'
import {
  buildSystemDocumentDateChangePlan,
} from '@/lib/system-document-date-change'
import {
  type SystemDocumentReference,
  type SystemDocumentSourcePosition,
} from '@/lib/system-document-types'
import { useSaveCheckSettings } from '@/lib/save-check-settings'
import { scheduleWeldDataRefresh } from '@/lib/weld-query-utils'
import { useAccess } from '@/lib/security-context'
import { workflowDocumentReferenceArea } from '@/lib/workflow-document-area'
import {
  getNewChronologyRootCauseState,
  type WorkflowRootCauseAction,
} from '@/lib/workflow-root-cause-actions'
import { changeSystemDocumentDate } from '@/server/weld-mutations-api'
import type { SystemDocumentDateChangeResult } from '@/server/system-document-date-workflow'
import type { SystemDocumentDateChangeData } from '@/server/weld-contracts'
import { SPECIALIST_CORRECTION_CANCELLED, withSpecialistCorrectionConfirmation } from '@/lib/specialist-correction-confirmation'

type DocumentSaveRequest = {
  data: SystemDocumentDateChangeData
  sourcePositions: SystemDocumentSourcePosition[]
}

export type SystemDocumentDateEditorProps = {
  reference: SystemDocumentReference
  label: string
  nameLabel?: string
  nameReadOnlyReason?: string
  disabledReason?: string
  disabled?: boolean
  autoFocus?: boolean
  onMessage?: (message: string) => void
  onSaved?: (result: SystemDocumentDateChangeResult) => void
  onSavingChange?: (saving: boolean) => void
  onRunRootCauseAction?: (action: WorkflowRootCauseAction) => void
}

export function SystemDocumentDateEditor({
  reference,
  label,
  nameLabel = 'Название всего документа',
  nameReadOnlyReason,
  disabledReason,
  disabled = false,
  autoFocus = false,
  onMessage,
  onSaved,
  onSavingChange,
  onRunRootCauseAction,
}: SystemDocumentDateEditorProps) {
  const queryClient = useQueryClient()
  const confirmAction = useConfirmAction()
  const { can } = useAccess()
  const area = workflowDocumentReferenceArea(reference)
  const editAllowed = can(`${area}.edit`)
  const permissionReason = editAllowed ? null : `Нет права изменения в ${area === 'lnk' ? 'ЛНК' : 'ПСТО'}. Обратитесь к администратору.`
  const saveCheckSettings = useSaveCheckSettings()
  const cycleSequencesKey = reference.cycleSequences?.join(',') ?? ''
  const effectiveReference = useMemo<SystemDocumentReference>(
    () => effectiveDocumentReference(reference),
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
  const referenceKey = documentContextKey(effectiveReference)[1]
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [nextDate, setNextDate] = useState(effectiveReference.date)
  const [nextTitle, setNextTitle] = useState(effectiveReference.title)
  const [serverError, setServerError] = useState<string | null>(null)
  const saveInProgress = useRef(false)
  const [saving, setSaving] = useState(false)
  const rowsQuery = useSystemDocumentContext(effectiveReference)

  useEffect(() => {
    setNextDate(effectiveReference.date)
    setNextTitle(effectiveReference.title)
    setServerError(null)
  }, [effectiveReference.date, effectiveReference.title, referenceKey])

  const targetDate = nextDate
  const normalizedTitle = formatCustomDocumentName(nextTitle)
  const hasChanges = (normalizedTitle !== effectiveReference.title) ||
    (nextDate !== effectiveReference.date)
  const dateReason = getDateInputValidationReason(targetDate, label)
  const nameReason = !normalizedTitle ? 'Укажите наименование документа' : null
  const preparation = useMemo(() => {
    if (dateReason || !rowsQuery.data) return { preview: null, error: null }
    try {
      // Name edits do not change chronology. Validate the full composition and
      // date once per context/date, keeping name keystrokes independent of size.
      return { preview: buildSystemDocumentDateChangePlan({
        reference: effectiveReference,
        nextDate: targetDate,
        rows: rowsQuery.data.rows,
        sourcePositions: rowsQuery.data.sourcePositions,
        allowUnchangedForPreview: true,
      }), error: null }
    } catch (error) {
      return { preview: null, error: error instanceof Error ? error.message : 'Не удалось подготовить изменения документа.' }
    }
  }, [effectiveReference, targetDate, dateReason, rowsQuery.data])
  const preview = preparation.preview
  const chronology = useMemo(() => preview && rowsQuery.data && preview.nextDate !== effectiveReference.date
    ? getNewChronologyRootCauseState({
        previousRows: rowsQuery.data.rows,
        proposedRows: preview.rows,
        settings: saveCheckSettings,
      })
    : { message: null, actions: [] }, [preview, rowsQuery.data, saveCheckSettings, effectiveReference.date])
  const blockReason = permissionReason || dateReason || nameReason || chronology.message || preparation.error || serverError ||
    (rowsQuery.isError ? 'Не удалось загрузить полный состав документа. Повторите загрузку.' : null) ||
    (disabled ? disabledReason || 'Дождитесь завершения текущего действия.' : null)

  const mutation = useMutation({
    mutationFn: async ({ data }: DocumentSaveRequest) => {
      if (data.expectedVersions.length === 0) throw new Error('В документе больше нет позиций. Обновите данные.')
      if (!can(`${workflowDocumentReferenceArea(data.reference)}.edit`)) throw new Error('Нет права изменения документа в соответствующем рабочем разделе.')
      return withSpecialistCorrectionConfirmation(specialistCorrectionConfirmation => changeSystemDocumentDate({
        data: {
          ...data,
          specialistCorrectionConfirmation,
        },
      }) as Promise<SystemDocumentDateChangeResult>, confirmAction)
    },
    onSuccess: async (result, request) => {
      if (!result) return
      setServerError(null)
      setNextDate(result.nextDate)
      setNextTitle(result.nextTitle)
      scheduleWeldDataRefresh(
        queryClient,
        { upsertRows: result.rows },
        {
          refetchLnkWorkflow:
            request.data.reference.type === 'lnkRequest' && !request.data.reference.sourceKind,
        },
      )
      const nextEffectiveReference = result.nextReference.sourceKind
        ? { ...result.nextReference, documentId: undefined }
        : result.nextReference
      const nextContextKey = documentContextKey(nextEffectiveReference)
      const nextContext = {
        rows: result.rows,
        sourcePositions: request.sourcePositions,
      }
      queryClient.setQueryData(nextContextKey, nextContext)
      onMessage?.(`Реквизиты документа сохранены у ${result.positionCount} позиций (${result.rowCount} стыков). Состав документа сохранён.`)
      onSaved?.(result)
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить изменения документа.'
      onMessage?.(message)
      if (message === SPECIALIST_CORRECTION_CANCELLED) return
      setServerError(message)
      void rowsQuery.refetch()
    },
  })

  const requestSave = async () => {
    if (!preview || blockReason || !hasChanges || saveInProgress.current || !rowsQuery.data) return
    // Confirm one immutable draft and membership snapshot. A background refresh
    // must not silently extend the operation the user has already reviewed.
    const request: DocumentSaveRequest = {
      data: {
        reference: effectiveReference,
        nextDate: targetDate,
        nextTitle: normalizedTitle,
        expectedVersions: [...new Map(rowsQuery.data.rows.map(row => [row.id, {
          id: row.id, version: String(row.rowVersion ?? ''),
        }])).values()],
      },
      sourcePositions: rowsQuery.data.sourcePositions,
    }
    saveInProgress.current = true
    setSaving(true)
    onSavingChange?.(true)
    try {
      const confirmed = await confirmAction({
      title: 'Сохранить изменения документа',
      itemName: effectiveReference.title,
      description: [
        normalizedTitle !== effectiveReference.title ? `Название: «${effectiveReference.title}» → «${normalizedTitle}».` : '',
        preview.nextDate !== effectiveReference.date ? `Дата: ${formatDisplayDate(effectiveReference.date) || 'не указана'} → ${formatDisplayDate(preview.nextDate)}.` : '',
        `Изменения получат все позиции документа: ${preview.positionCount} поз. в ${preview.rowCount} ст.`,
      ].filter(Boolean).join(' '),
      warning: 'Состав документа и результаты сохранятся. Стыки не выделяются в отдельный документ. При изменении даты система проверит хронологию и удостоверения специалистов.',
      confirmLabel: 'Сохранить изменения',
      tone: 'warning',
      })
      if (confirmed) await mutation.mutateAsync(request)
    } catch {
      // Mutation errors are displayed by onError; cancellation keeps the draft.
    } finally {
      saveInProgress.current = false
      setSaving(false)
      // The editor can unmount when another document is selected. Keep the
      // shared workflow locked until this operation actually settles.
      onSavingChange?.(false)
    }
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
            disabled={disabled || !editAllowed || saving || rowsQuery.isLoading}
            onChange={(event) => {
              setNextDate(event.target.value)
              setServerError(null)
            }}
          />
        </label>
        <label className="min-w-44 flex-[2] space-y-1.5 text-xs font-medium text-slate-600">
          <span>{nameLabel}</span>
          <Input value={nextTitle} disabled={disabled || !editAllowed || saving || rowsQuery.isLoading || Boolean(nameReadOnlyReason)}
            onChange={(event) => { setNextTitle(event.target.value); setServerError(null) }} />
        </label>
      </div>
      {nameReadOnlyReason ? <p className="text-xs text-slate-500">{nameReadOnlyReason}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <p className="text-xs text-slate-500">{hasChanges ? 'Дата и название сохранятся вместе у всего документа.' : 'Нет изменений документа.'}</p>
        <Button
          type="button"
          size="sm"
          aria-label="Сохранить изменения документа"
          disabled={disabled || saving || rowsQuery.isLoading || !hasChanges || Boolean(blockReason) || !preview}
          onClick={() => void requestSave()}
        >
          {saving || rowsQuery.isLoading
            ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            : <Check className="mr-2 h-4 w-4" />}
          Сохранить изменения
        </Button>
      </div>
      {hasChanges && preview ? (
        <p className="text-xs leading-5 text-slate-500">
          Будет изменено позиций: {preview.positionCount}; стыков: {preview.rowCount}.{' '}
          Состав документа и результаты не изменятся.
        </p>
      ) : null}
      {rowsQuery.isError || preparation.error || serverError ? <Button type="button" size="sm" variant="outline"
        disabled={rowsQuery.isFetching || saving}
        onClick={() => { setServerError(null); void rowsQuery.refetch() }}>Повторить загрузку состава</Button> : null}
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
