import type { Dispatch, RefObject, SetStateAction } from 'react'

import { WeldFormField } from '@/components/weld-form-field'
import { WeldFormSectionHeader } from '@/components/weld-form-section-header'
import { yesEmptyFieldKeys, type StampSelectOptions } from '@/lib/weld-form-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type WeldFormTab = 'joint' | 'control'

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
  activeTab: WeldFormTab
  onActiveTabChange: (tab: WeldFormTab) => void
}

export function WeldFormSections({
  fieldsByGroup,
  collapsedSections,
  draft,
  stampSelectOptions,
  fieldRefs,
  onToggleSection,
  setDraft,
  activeTab,
  onActiveTabChange,
}: WeldFormSectionsProps) {
  const controlAvailabilityFields = fieldsByGroup.flatMap(({ fields }) => fields.filter((field) => yesEmptyFieldKeys.has(field.key)))
  const regularFieldsByGroup = fieldsByGroup
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !yesEmptyFieldKeys.has(field.key)),
    }))
    .filter((group) => group.fields.length > 0)

  return (
    <div className="space-y-5">
      {fieldsByGroup.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Нет доступных полей для редактирования этой записи.
        </div>
      ) : null}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 pb-3 backdrop-blur">
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm shadow-slate-200/50">
          <button
            type="button"
            onClick={() => onActiveTabChange('joint')}
            className={activeTab === 'joint' ? 'rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white' : 'rounded px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'}
          >
            Стык
          </button>
          {controlAvailabilityFields.length > 0 ? (
            <button
              type="button"
              onClick={() => onActiveTabChange('control')}
              className={activeTab === 'control' ? 'rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white' : 'rounded px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'}
            >
              Назначение контроля
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === 'control' && controlAvailabilityFields.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Назначение контроля</div>
            <div className="mt-1 text-sm text-slate-500">Выберите состояние для каждого вида контроля. Правила замены РК/УЗК применяются сразу.</div>
          </div>
          <div className="divide-y divide-slate-100">
            {controlAvailabilityFields.map((field) => (
              <div key={field.key} className="grid grid-cols-1 gap-3 px-4 py-4 xl:grid-cols-[180px_minmax(0,1fr)]">
                <div className="pt-1 text-sm font-semibold text-slate-700">{field.label}</div>
                <WeldFormField
                  field={field}
                  draft={draft}
                  stampSelectOptions={stampSelectOptions}
                  fieldRefs={fieldRefs}
                  setDraft={setDraft}
                  hideLabel
                  controlPickerLayout="row"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {activeTab === 'joint' ? (
        <div className="space-y-8">
          {regularFieldsByGroup.map(({ section, fields }) => (
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
      ) : null}
    </div>
  )
}
