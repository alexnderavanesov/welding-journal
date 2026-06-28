import type { Dispatch, RefObject, SetStateAction } from 'react'

import { WeldFormField } from '@/components/weld-form-field'
import { WeldFormSectionHeader } from '@/components/weld-form-section-header'
import type { StampSelectOptions } from '@/lib/weld-form-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type WeldFormFieldGroup = {
  section: string
  fields: Array<{
    key: WeldFieldKey
    label: string
    type: string
    options?: readonly string[]
  }>
}

type WeldFormSectionsProps = {
  fieldsByGroup: WeldFormFieldGroup[]
  collapsedSections: ReadonlySet<string>
  draft: WeldInput
  stampSelectOptions?: StampSelectOptions
  fieldRefs: RefObject<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>
  onToggleSection: (section: string) => void
  setDraft: Dispatch<SetStateAction<WeldInput>>
}

export function WeldFormSections({
  fieldsByGroup,
  collapsedSections,
  draft,
  stampSelectOptions,
  fieldRefs,
  onToggleSection,
  setDraft,
}: WeldFormSectionsProps) {
  return (
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
            onToggle={() => onToggleSection(section)}
          />
          {collapsedSections.has(section) ? null : (
            <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
              {fields.map((field) => (
                <WeldFormField
                  key={field.key}
                  field={field}
                  draft={draft}
                  stampSelectOptions={stampSelectOptions}
                  fieldRefs={fieldRefs}
                  setDraft={setDraft}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
