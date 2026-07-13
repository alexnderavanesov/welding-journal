import { useEffect, useMemo, useRef, useState } from 'react'
import { LargeDialogShell } from '@/components/large-dialog-shell'
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
import {
  formHiddenFieldKeys,
  getWeldFormAutoClearHint,
  getWeldFormCancellationResultHint,
  getWeldFormReactivationResultHint,
  getWeldFormSaveBlockReason,
  getWeldStampSaveBlockReason,
  secondaryWeldFormFieldKeys,
  withCalculatedFinalStatus,
  type StampSelectOptions,
  yesEmptyFieldKeys,
} from '@/lib/weld-form-utils'

export type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-utils'

type WeldFormProps = {
  value: WeldDraft
  focusField?: WeldFieldKey
  stampSelectOptions?: StampSelectOptions | ((value: WeldInput) => StampSelectOptions)
  getExternalSaveBlockReason?: (value: WeldInput) => string | null
  onSave: (value: WeldInput) => void
  onCancel: () => void
  busy?: boolean
}

export function WeldForm({ value, focusField, stampSelectOptions, getExternalSaveBlockReason, onSave, onCancel, busy }: WeldFormProps) {
  const [draft, setDraft] = useState<WeldInput>(value)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<WeldFormTab>(() => getWeldFormTabForField(focusField))
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>({})
  const fieldsByGroup = useMemo(
    () =>
      VISIBLE_FIELD_SECTIONS.map((group) => ({
        ...group,
        fields: group.fields.filter((field) => !formHiddenFieldKeys.has(field.key)),
      })).filter((group) => group.fields.length > 0),
    [],
  )
  const resolvedStampSelectOptions = typeof stampSelectOptions === 'function' ? stampSelectOptions(draft) : stampSelectOptions
  const preparedDraft = draft
  const saveBlockReason =
    getWeldStampSaveBlockReason(preparedDraft, resolvedStampSelectOptions) ??
    getExternalSaveBlockReason?.(preparedDraft) ??
    getRequiredRootStampMessage(preparedDraft) ??
    getWeldFormSaveBlockReason(draft, value)
  const autoClearHint = saveBlockReason ? null : getWeldFormAutoClearHint(draft, value)
  const cancellationResultHint = saveBlockReason ? null : getWeldFormCancellationResultHint(draft, value)
  const reactivationResultHint = saveBlockReason ? null : getWeldFormReactivationResultHint(draft, value)
  const saveHint = [autoClearHint, cancellationResultHint, reactivationResultHint].filter(Boolean).join('; ') || null
  const handleSave = () => {
    if (!busy && !saveBlockReason) onSave(withCalculatedFinalStatus(preparedDraft))
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
        return
      }

      if (event.isComposing) return

      const target = event.target
      const isTextArea = target instanceof HTMLTextAreaElement
      const isAltSave = event.altKey && (event.code === 'KeyS' || event.key.toLowerCase() === 's')
      const isSaveShortcut = event.key === 'Enter' || isAltSave
      if (!isTextArea && isSaveShortcut) {
        event.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, draft, onCancel, onSave, saveBlockReason])

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
      const nextDraft = withAutoVikForWeldDate(current)
      const nextFinalStatus = calculateFinalStatus(nextDraft)
      if (current === nextDraft && current.finalStatus === nextFinalStatus) return current
      return { ...nextDraft, finalStatus: nextFinalStatus }
    })
  }, [draft])

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
      maxHeightClassName="max-h-[96vh]"
      overlayClassName="z-40 bg-slate-950/20 py-4"
      panelShadowClassName="shadow-slate-950/10"
      panelClassName="bg-slate-50"
    >
      <WeldFormHeader draft={draft} isEditing={Boolean(value.id)} onCancel={onCancel} />

      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <WeldFormSections
          fieldsByGroup={fieldsByGroup}
          collapsedSections={collapsedSections}
          draft={draft}
          stampSelectOptions={resolvedStampSelectOptions}
          fieldRefs={fieldRefs}
          onToggleSection={toggleSection}
          setDraft={setDraft}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
        />
      </div>

      <WeldFormFooter
        busy={busy}
        autoClearHint={saveHint}
        saveBlockReason={saveBlockReason}
        onCancel={onCancel}
        onSave={handleSave}
      />
    </LargeDialogShell>
  )
}

function getWeldFormTabForField(fieldKey?: WeldFieldKey): WeldFormTab {
  if (!fieldKey) return 'joint'
  if (yesEmptyFieldKeys.has(fieldKey)) return 'control'
  if (secondaryWeldFormFieldKeys.has(fieldKey)) return 'workClosure'
  return 'joint'
}
