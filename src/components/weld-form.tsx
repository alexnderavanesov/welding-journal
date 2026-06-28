import { useEffect, useMemo, useRef, useState } from 'react'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { WeldFormFooter } from '@/components/weld-form-footer'
import { WeldFormField } from '@/components/weld-form-field'
import { WeldFormHeader } from '@/components/weld-form-header'
import { WeldFormSectionHeader } from '@/components/weld-form-section-header'
import {
  VISIBLE_FIELD_SECTIONS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'
import { getRequiredRootStampMessage, withAutoVikForWeldDate } from '@/lib/weld-import-export'
import {
  formHiddenFieldKeys,
  getWeldFormSaveBlockReason,
  getWeldStampSaveBlockReason,
  withCalculatedFinalStatus,
  type StampSelectOptions,
} from '@/lib/weld-form-utils'

export type { StampSelectOption, StampSelectOptions } from '@/lib/weld-form-utils'

type WeldFormProps = {
  value: WeldInput & { id?: number }
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
  const autoFillMessages: string[] = []
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
        <div className="space-y-8">
          {fieldsByGroup.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              Нет доступных полей для редактирования этой записи.
            </div>
          ) : null}
          {fieldsByGroup.map(({ section, fields }) => (
            <section key={section}>
              <WeldFormSectionHeader
                section={section}
                fieldsCount={fields.length}
                collapsed={collapsedSections.has(section)}
                onToggle={() => toggleSection(section)}
              />
              {collapsedSections.has(section) ? null : (
                <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                  {fields.map((field) => (
                    <WeldFormField
                      key={field.key}
                      field={field}
                      draft={draft}
                      stampSelectOptions={resolvedStampSelectOptions}
                      fieldRefs={fieldRefs}
                      setDraft={setDraft}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>

      <WeldFormFooter
        busy={busy}
        saveBlockReason={saveBlockReason}
        autoFillMessage={autoFillMessages[0]}
        onCancel={onCancel}
        onSave={handleSave}
      />
    </LargeDialogShell>
  )
}
