import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { UserRoundCheck, WandSparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { WeldFormField } from '@/components/weld-form-field'
import { WeldFormSectionHeader } from '@/components/weld-form-section-header'
import { getWeldLineAutofillState } from '@/lib/weld-line-autofill'
import { getWeldStampAutofillState } from '@/lib/weld-stamp-autofill'
import { secondaryWeldFormSectionNames, yesEmptyFieldKeys, type StampSelectOptions } from '@/lib/weld-form-utils'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

export type WeldFormTab = 'joint' | 'control' | 'workClosure'

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
  suggestionRows?: readonly WeldInput[]
  stampSelectOptions?: StampSelectOptions
  systemWdiEnabled?: boolean
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
  suggestionRows = [],
  stampSelectOptions,
  systemWdiEnabled = false,
  fieldRefs,
  onToggleSection,
  setDraft,
  activeTab,
  onActiveTabChange,
}: WeldFormSectionsProps) {
  const controlAvailabilityFields = fieldsByGroup.flatMap(({ fields }) => fields.filter((field) => yesEmptyFieldKeys.has(field.key)))
  const workClosureFieldsByGroup = fieldsByGroup
    .filter((group) => secondaryWeldFormSectionNames.has(group.section))
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => !yesEmptyFieldKeys.has(field.key)),
    }))
    .filter((group) => group.fields.length > 0)
  const regularFieldsByGroup = fieldsByGroup
    .filter((group) => !secondaryWeldFormSectionNames.has(group.section))
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
          {workClosureFieldsByGroup.length > 0 ? (
            <button
              type="button"
              onClick={() => onActiveTabChange('workClosure')}
              className={activeTab === 'workClosure' ? 'rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white' : 'rounded px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50'}
            >
              Испытания и закрытие
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
          <div className="divide-y-2 divide-slate-200">
            {controlAvailabilityFields.map((field) => (
              <div key={field.key} className="grid grid-cols-1 gap-3 bg-white px-4 py-4 xl:grid-cols-[180px_minmax(0,1fr)]">
                <div className="border-l-4 border-slate-300 pl-3 pt-1 text-sm font-semibold text-slate-800">{field.label}</div>
                <WeldFormField
                  field={field}
                  draft={draft}
                  suggestionRows={suggestionRows}
                  stampSelectOptions={stampSelectOptions}
                  systemWdiEnabled={systemWdiEnabled}
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
      {activeTab === 'workClosure' ? (
        <div className="space-y-8">
          {workClosureFieldsByGroup.map(({ section, fields }) => (
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
                      suggestionRows={suggestionRows}
                      stampSelectOptions={stampSelectOptions}
                      systemWdiEnabled={systemWdiEnabled}
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
      {activeTab === 'joint' ? (
        <div className="space-y-8">
          {regularFieldsByGroup.map(({ section, fields }) => (
            <section key={section}>
              <WeldFormSectionHeader
                section={section}
                fieldsCount={fields.length}
                collapsed={collapsedSections.has(section)}
                onToggle={() => onToggleSection(section)}
                actions={
                  section === 'Проект' ? (
                    <LineAutofillButton draft={draft} suggestionRows={suggestionRows} setDraft={setDraft} />
                  ) : section === 'Клейма' ? (
                    <StampAutofillButton draft={draft} setDraft={setDraft} />
                  ) : undefined
                }
              />
              {collapsedSections.has(section) ? null : (
                <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                  {fields.map((field) => (
                    <WeldFormField
                      key={field.key}
                      field={field}
                      draft={draft}
                      suggestionRows={suggestionRows}
                      stampSelectOptions={stampSelectOptions}
                      systemWdiEnabled={systemWdiEnabled}
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

function StampAutofillButton({
  draft,
  setDraft,
}: {
  draft: WeldInput
  setDraft: Dispatch<SetStateAction<WeldInput>>
}) {
  const state = useMemo(() => getWeldStampAutofillState(draft), [draft])
  const isDisabled = Boolean(state.disabledReason)
  const helpText =
    'Заполняется по полям Корень_1 и Корень_2: клеймо из корня переносится в заполнение, облицовку и фактические поля своего индекса.'
  const title = state.disabledReason ? `${state.disabledReason} ${helpText}` : `${helpText} Будет заполнено полей: ${state.changedFieldsCount}.`

  function handleAutofill() {
    if (isDisabled) return
    setDraft((current) => ({ ...current, ...state.values }))
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      title={title}
      onClick={handleAutofill}
      className="h-7 border-emerald-200 bg-white px-2.5 text-xs text-emerald-800 shadow-sm shadow-emerald-100 hover:bg-emerald-50 hover:text-emerald-950 disabled:bg-slate-100 disabled:text-slate-400"
    >
      <UserRoundCheck className="mr-1.5 h-3.5 w-3.5" />
      Заполнить клейма
    </Button>
  )
}

function LineAutofillButton({
  draft,
  suggestionRows,
  setDraft,
}: {
  draft: WeldInput
  suggestionRows: readonly WeldInput[]
  setDraft: Dispatch<SetStateAction<WeldInput>>
}) {
  const state = useMemo(() => getWeldLineAutofillState(draft, suggestionRows), [draft, suggestionRows])
  const isDisabled = Boolean(state.disabledReason)
  const helpText =
    'Заполняется по уже существующим стыкам этой линии: Проект/Титул, Шифр/Подтитул, Группа, Категория, Контроль швов (%) и назначения контроля.'
  const sourceText = state.sourceRowsCount > 0 ? `Источник: ${formatSourceRowsCount(state.sourceRowsCount)} линии ${state.line}.` : ''
  const title = state.disabledReason ? `${state.disabledReason} ${helpText}` : `${helpText} ${sourceText} Будет заполнено полей: ${state.changedFieldsCount}.`

  function handleAutofill() {
    if (isDisabled) return
    setDraft((current) => ({ ...current, ...state.values }))
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      title={title}
      onClick={handleAutofill}
      className="h-7 border-sky-200 bg-white px-2.5 text-xs text-sky-800 shadow-sm shadow-sky-100 hover:bg-sky-50 hover:text-sky-950 disabled:bg-slate-100 disabled:text-slate-400"
    >
      <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
      Заполнить по линии
    </Button>
  )
}

function formatSourceRowsCount(count: number) {
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit === 1 && lastTwoDigits !== 11) return `${count} стык`
  if ([2, 3, 4].includes(lastDigit) && ![12, 13, 14].includes(lastTwoDigits)) return `${count} стыка`
  return `${count} стыков`
}
