import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { WeldFormFooter } from '@/components/weld-form-footer'
import { WeldFormHeader } from '@/components/weld-form-header'
import { WeldFormSections, type WeldFormTab } from '@/components/weld-form-sections'
import {
  VISIBLE_FIELD_SECTIONS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'
import { getRequiredRootStampMessage, withAutoVikForWeldDate } from '@/lib/weld-import-export'
import type { WeldDraft } from '@/lib/dispatcher-types'
import type { PageScrollPosition } from '@/lib/page-scroll-position'
import { useOtherSettings } from '@/lib/other-settings'
import { formatSaveCheckBlockReason, useSaveCheckSettings } from '@/lib/save-check-settings'
import { useSystemIndexSettings } from '@/lib/system-index-settings'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { isSystemWdiMode, withSystemWdi } from '@/lib/wdi'
import { CONTROL_BASIS_SUMMARY_FIELD_KEY } from '@/lib/control-assignment-basis'
import {
  getWeldFormAutoClearHint,
  getWeldFormCancellationResultHint,
  getWeldFormReactivationResultHint,
  getWeldFormSaveBlockReason,
  getWeldStampSaveBlockReason,
  isWeldFormFieldHidden,
  secondaryWeldFormFieldKeys,
  weldingMaterialWeldFormFieldKeys,
  withCalculatedFinalStatus,
  type StampSelectOptions,
  yesEmptyFieldKeys,
} from '@/lib/weld-form-utils'

export type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-utils'

type WeldFormProps = {
  value: WeldDraft
  focusField?: WeldFieldKey
  returnPageScrollPosition?: PageScrollPosition
  suggestionRows?: readonly WeldInput[]
  stampSelectOptions?: StampSelectOptions | ((value: WeldInput) => StampSelectOptions)
  getExternalSaveBlockReason?: (value: WeldInput) => string | null
  onLineIdentityChange?: (identity: WeldFormLineIdentity) => void
  preSaveDecision?: WeldFormPreSaveDecision | null
  onSave: (value: WeldInput) => void
  onCancel: () => void
  busy?: boolean
}

export type WeldFormLineIdentity = Pick<WeldInput, 'projectTitle' | 'subtitleCode' | 'line'>

export type WeldFormPreSaveDecision = {
  status: 'required' | 'resolved' | 'error'
  message: string
  actionLabel: string
  onAction: () => void
}

export function WeldForm({
  value,
  focusField,
  returnPageScrollPosition,
  suggestionRows,
  stampSelectOptions,
  getExternalSaveBlockReason,
  onLineIdentityChange,
  preSaveDecision,
  onSave,
  onCancel,
  busy,
}: WeldFormProps) {
  const [draft, setDraft] = useState<WeldInput>(value)
  const otherSettings = useOtherSettings()
  const saveCheckSettings = useSaveCheckSettings()
  const systemIndexSettings = useSystemIndexSettings()
  const systemWdiEnabled = isSystemWdiMode(otherSettings)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<WeldFormTab>(() => getWeldFormTabForField(focusField))
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
  const validationDraft = useDebouncedValue(draft, 120)
  const lineIdentity = useMemo<WeldFormLineIdentity>(() => ({
    projectTitle: draft.projectTitle,
    subtitleCode: draft.subtitleCode,
    line: draft.line,
  }), [draft.line, draft.projectTitle, draft.subtitleCode])
  const debouncedLineIdentity = useDebouncedValue(lineIdentity, 320)
  const [immediateSaveBlockReason, setImmediateSaveBlockReason] = useState<string | null>(null)
  const fieldsByGroup = useMemo(
    () =>
      VISIBLE_FIELD_SECTIONS.map((group) => ({
        ...group,
        fields: group.fields.filter((field) => !isWeldFormFieldHidden(field)),
      })).filter((group) => group.fields.length > 0),
    [],
  )
  const isEditing = Boolean(value.id)
  const fieldStatusLabel = isEditing ? 'Изменено' : 'Заполнено'
  const fieldStatusKeys = useMemo(
    () => getWeldFormFieldStatusKeys(draft, value, fieldsByGroup, isEditing),
    [draft, fieldsByGroup, isEditing, value],
  )
  const resolvedStampSelectOptions = useMemo(
    () => resolveStampSelectOptions(stampSelectOptions, validationDraft),
    [stampSelectOptions, validationDraft],
  )
  const externalSaveBlockReason = useMemo(
    () => getExternalSaveBlockReason?.(validationDraft) ?? null,
    [getExternalSaveBlockReason, validationDraft],
  )
  const deferredSaveBlockReason = useMemo(
    () =>
      getWeldSaveBlockReason({
        draft: validationDraft,
        initialValue: value,
        stampSelectOptions: resolvedStampSelectOptions,
        externalSaveBlockReason,
        saveCheckSettings,
        systemIndexSettings,
      }),
    [externalSaveBlockReason, resolvedStampSelectOptions, saveCheckSettings, systemIndexSettings, validationDraft, value],
  )
  const saveBlockReason = immediateSaveBlockReason ?? deferredSaveBlockReason
  const autoClearHint = saveBlockReason ? null : getWeldFormAutoClearHint(validationDraft, value)
  const cancellationResultHint = saveBlockReason ? null : getWeldFormCancellationResultHint(validationDraft, value)
  const reactivationResultHint = saveBlockReason ? null : getWeldFormReactivationResultHint(validationDraft, value)
  const saveHint = [autoClearHint, cancellationResultHint, reactivationResultHint].filter(Boolean).join('; ') || null
  const handleSave = () => {
    if (busy) return

    const currentStampSelectOptions = resolveStampSelectOptions(stampSelectOptions, draft)
    const currentExternalSaveBlockReason = getExternalSaveBlockReason?.(draft) ?? null
    const currentSaveBlockReason = getWeldSaveBlockReason({
      draft,
      initialValue: value,
      stampSelectOptions: currentStampSelectOptions,
      externalSaveBlockReason: currentExternalSaveBlockReason,
      saveCheckSettings,
      systemIndexSettings,
    })
    if (currentSaveBlockReason) {
      setImmediateSaveBlockReason(currentSaveBlockReason)
      return
    }

    onSave(withCalculatedFinalStatus(draft))
  }
  const handleSaveRef = useRef(handleSave)
  const onCancelRef = useRef(onCancel)
  handleSaveRef.current = handleSave
  onCancelRef.current = onCancel

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancelRef.current()
        return
      }

      if (event.isComposing) return

      const target = event.target
      const isTextArea = target instanceof HTMLTextAreaElement
      const isAltSave = event.altKey && (event.code === 'KeyS' || event.key.toLowerCase() === 's')
      const isSaveShortcut = event.key === 'Enter' || isAltSave
      if (!isTextArea && isSaveShortcut) {
        event.preventDefault()
        handleSaveRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (immediateSaveBlockReason) setImmediateSaveBlockReason(null)
  }, [draft])

  useEffect(() => {
    onLineIdentityChange?.(debouncedLineIdentity)
  }, [debouncedLineIdentity, onLineIdentityChange])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [value.id, focusField])

  useEffect(() => {
    if (!focusField) return
    setActiveTab(getWeldFormTabForField(focusField))

    const focusedSection = fieldsByGroup.find((group) => group.fields.some((field) => field.key === focusField))?.section
    if (focusedSection) {
      setCollapsedSections((current) => {
        if (!current.has(focusedSection)) return current
        const next = new Set(current)
        next.delete(focusedSection)
        return next
      })
    }

    window.requestAnimationFrame(() => {
      const element = fieldRefs.current[focusField]
      if (!element) return

      element.focus({ preventScroll: true })
      if (element instanceof HTMLInputElement) {
        element.select()
      }
    })
  }, [fieldsByGroup, focusField])

  useEffect(() => {
    setDraft((current) => {
      const nextDraft = systemWdiEnabled ? withSystemWdi(withAutoVikForWeldDate(current), otherSettings) : withAutoVikForWeldDate(current)
      const nextFinalStatus = calculateFinalStatus(nextDraft)
      if (current === nextDraft && current.finalStatus === nextFinalStatus) return current
      return { ...nextDraft, finalStatus: nextFinalStatus }
    })
  }, [draft, otherSettings, systemWdiEnabled])

  useEffect(() => {
    setActiveTab(getWeldFormTabForField(focusField))
  }, [value.id, focusField])

  function toggleSection(section: string) {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[min(1500px,96vw)]"
      maxHeightClassName="h-[calc(100dvh-2rem)] max-h-[96vh]"
      overlayClassName="z-40 bg-slate-950/20 py-4"
      panelShadowClassName="shadow-slate-950/10"
      panelClassName="bg-slate-50"
      returnPageScrollPosition={returnPageScrollPosition}
    >
      <WeldFormHeader draft={draft} isEditing={isEditing} onCancel={onCancel} />

      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-0">
        <WeldFormSections
          fieldsByGroup={fieldsByGroup}
          collapsedSections={collapsedSections}
          draft={draft}
          calculationDraft={validationDraft}
          suggestionRows={suggestionRows}
          stampSelectOptions={resolvedStampSelectOptions}
          stampCompatibilityReason={externalSaveBlockReason}
          systemWdiEnabled={systemWdiEnabled}
          fieldRefs={fieldRefs}
          onToggleSection={toggleSection}
          setDraft={setDraft}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          fieldStatusKeys={fieldStatusKeys}
          fieldStatusLabel={fieldStatusLabel}
        />
      </div>

      {preSaveDecision ? (
        <div className={`flex items-center gap-3 border-t px-6 py-3 text-sm ${
          preSaveDecision.status === 'resolved'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
            : preSaveDecision.status === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-950'
              : 'border-amber-200 bg-amber-50 text-amber-950'
        }`}>
          {preSaveDecision.status === 'resolved'
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            : <AlertTriangle className={`h-4 w-4 shrink-0 ${preSaveDecision.status === 'error' ? 'text-rose-700' : 'text-amber-700'}`} />}
          <span className="min-w-0 flex-1 leading-5">{preSaveDecision.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={preSaveDecision.onAction}>
            {preSaveDecision.actionLabel}
          </Button>
        </div>
      ) : null}

      <WeldFormFooter
        busy={busy}
        autoClearHint={saveHint}
        saveBlockReason={saveBlockReason}
        fieldStatusCount={fieldStatusKeys.size}
        fieldStatusLabel={fieldStatusLabel}
        onCancel={onCancel}
        onSave={handleSave}
      />
    </LargeDialogShell>
  )
}

export function getWeldFormFieldStatusKeys(
  draft: WeldInput,
  initialValue: WeldDraft,
  fieldsByGroup: Array<{ fields: Array<{ key: WeldFieldKey }> }>,
  isEditing: boolean,
) {
  const keys = new Set<WeldFieldKey>()
  for (const group of fieldsByGroup) {
    for (const field of group.fields) {
      const currentValue = draft[field.key]
      if (isEditing ? !areWeldFormValuesEqual(currentValue, initialValue[field.key]) : hasWeldFormValue(currentValue)) {
        keys.add(field.key)
      }
    }
  }
  return keys
}

function areWeldFormValuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  if ((left === null || left === undefined || left === '') && (right === null || right === undefined || right === '')) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  }
  return false
}

function hasWeldFormValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function formatRequiredRootStampMessage(message: string | null) {
  return message ? formatSaveCheckBlockReason('requiredRootStampWithWeldDate', message) : null
}

function resolveStampSelectOptions(
  stampSelectOptions: WeldFormProps['stampSelectOptions'],
  draft: WeldInput,
) {
  return typeof stampSelectOptions === 'function' ? stampSelectOptions(draft) : stampSelectOptions
}

function getWeldSaveBlockReason({
  draft,
  initialValue,
  stampSelectOptions,
  externalSaveBlockReason,
  saveCheckSettings,
  systemIndexSettings,
}: {
  draft: WeldInput
  initialValue: WeldDraft
  stampSelectOptions?: StampSelectOptions
  externalSaveBlockReason?: string | null
  saveCheckSettings: ReturnType<typeof useSaveCheckSettings>
  systemIndexSettings: ReturnType<typeof useSystemIndexSettings>
}) {
  return (
    externalSaveBlockReason ??
    getWeldStampSaveBlockReason(draft, stampSelectOptions) ??
    (saveCheckSettings.requiredRootStampWithWeldDate
      ? formatRequiredRootStampMessage(getRequiredRootStampMessage(draft))
      : null) ??
    getWeldFormSaveBlockReason(draft, initialValue, saveCheckSettings, { systemIndexSettings })
  )
}

export function getWeldFormTabForField(fieldKey?: WeldFieldKey): WeldFormTab {
  if (!fieldKey) return 'joint'
  if (fieldKey === CONTROL_BASIS_SUMMARY_FIELD_KEY || yesEmptyFieldKeys.has(fieldKey)) return 'control'
  if (weldingMaterialWeldFormFieldKeys.has(fieldKey)) return 'weldingMaterials'
  if (secondaryWeldFormFieldKeys.has(fieldKey)) return 'workClosure'
  return 'joint'
}
