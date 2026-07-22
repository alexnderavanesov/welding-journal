import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { AlertTriangle, CheckCircle2, Info, UserRoundCheck, WandSparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { WeldFormField } from '@/components/weld-form-field'
import { WeldFormSectionHeader } from '@/components/weld-form-section-header'
import { OFFICIAL_WELDER_STAMP_FIELD_KEYS } from '@/lib/report-config'
import { getWeldLineAutofillState } from '@/lib/weld-line-autofill'
import { getWeldStampAutofillState } from '@/lib/weld-stamp-autofill'
import { getStampSelectValue, secondaryWeldFormSectionNames, yesEmptyFieldKeys, type StampSelectOptions } from '@/lib/weld-form-utils'
import { parseOfficialStampWeldingMethods, normalizeStampForCompare } from '@/lib/welder-stamp-compatibility-utils'
import { FIELD_BY_KEY, type WeldField, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

export type WeldFormTab = 'joint' | 'control' | 'workClosure'

type WeldFormEditableField = WeldField & { key: WeldFieldKey }

type WeldFormFieldGroup = {
  section: string
  fields: WeldFormEditableField[]
}

type WeldFormSectionsProps = {
  fieldsByGroup: WeldFormFieldGroup[]
  collapsedSections: ReadonlySet<string>
  draft: WeldInput
  suggestionRows?: readonly WeldInput[]
  stampSelectOptions?: StampSelectOptions
  stampCompatibilityReason?: string | null
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
  stampCompatibilityReason,
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
                <>
                  {section === 'Клейма' ? (
                    <OfficialStampDiagnostics draft={draft} stampSelectOptions={stampSelectOptions} stampCompatibilityReason={stampCompatibilityReason} />
                  ) : null}
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
                </>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type StampDiagnosticStatus = 'ok' | 'warning' | 'error'

type StampDiagnosticRow = {
  fieldKey: WeldFieldKey
  label: string
  value: string
  status: StampDiagnosticStatus
  message: string
}

function OfficialStampDiagnostics({
  draft,
  stampSelectOptions,
  stampCompatibilityReason,
}: {
  draft: WeldInput
  stampSelectOptions?: StampSelectOptions
  stampCompatibilityReason?: string | null
}) {
  const rows = useMemo(() => getOfficialStampDiagnostics(draft, stampSelectOptions), [draft, stampSelectOptions])
  if (rows.length === 0 && !stampCompatibilityReason) return null

  const hasWarning = rows.some((row) => row.status === 'warning')
  const hasError = rows.some((row) => row.status === 'error') || (Boolean(stampCompatibilityReason) && !hasWarning)
  const summaryStatus: StampDiagnosticStatus = hasError ? 'error' : hasWarning ? 'warning' : 'ok'
  const methods = parseOfficialStampWeldingMethods(draft.weldingMethod)
  const uniqueStampCount = new Set(rows.map((row) => normalizeStampForCompare(row.value))).size
  const summaryText = getOfficialStampSummaryText(summaryStatus, rows, methods, uniqueStampCount, stampCompatibilityReason)
  const teamText = getOfficialStampTeamText(summaryStatus, methods, uniqueStampCount, stampCompatibilityReason)
  const primaryText = teamText || summaryText

  return (
    <div className={getDiagnosticContainerClassName(summaryStatus)}>
      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="flex min-w-0 items-center gap-2">
          <div className={getDiagnosticIconClassName(summaryStatus)}>
            {summaryStatus === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : summaryStatus === 'warning' ? <Info className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-slate-900">Проверка клейм</span>
              <span className="text-sm leading-snug text-slate-600">{primaryText}</span>
            </div>
            {teamText && summaryStatus !== 'ok' ? <div className="mt-0.5 text-xs text-slate-500">{summaryText}</div> : null}
          </div>
        </div>
        {rows.length > 0 ? (
          <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-[repeat(3,max-content)] xl:justify-end">
            {rows.map((row) => (
              <span key={row.fieldKey} title={`${row.label}: ${row.value}. ${row.message}`} className={getDiagnosticChipClassName(row.status)}>
                <span className="shrink-0 font-semibold">{row.label}</span>
                <span className="shrink-0">{row.value}</span>
                <span className={getDiagnosticMiniBadgeClassName(row.status)}>{getDiagnosticBadgeText(row.status)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {rows.some((row) => row.status !== 'ok') ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter((row) => row.status !== 'ok')
            .map((row) => (
              <span key={`${row.fieldKey}:reason`} className={getDiagnosticReasonClassName(row.status)}>
                <span className={getDiagnosticReasonLabelClassName(row.status)}>{row.label}</span>
                <span className="min-w-0 truncate py-1 pr-2">{row.message}</span>
              </span>
            ))}
        </div>
      ) : null}
    </div>
  )
}

function getOfficialStampDiagnostics(draft: WeldInput, stampSelectOptions?: StampSelectOptions): StampDiagnosticRow[] {
  return OFFICIAL_WELDER_STAMP_FIELD_KEYS.flatMap<StampDiagnosticRow>((fieldKey) => {
    const value = getStampSelectValue(draft[fieldKey])
    if (!value) return []

    const option = stampSelectOptions?.[fieldKey]?.find((item) => normalizeStampForCompare(item.value) === normalizeStampForCompare(value))
    const fieldLabel = FIELD_BY_KEY.get(fieldKey)?.label ?? fieldKey
    if (!option) {
      return [
        {
          fieldKey,
          label: fieldLabel,
          value,
          status: 'error' as const,
          message: 'Клеймо не найдено в текущем списке реестра.',
        },
      ]
    }

    if (option.disabled) {
      return [
        {
          fieldKey,
          label: fieldLabel,
          value,
          status: 'error' as const,
          message: option.reason || 'Клеймо нельзя выбрать по текущим данным стыка.',
        },
      ]
    }

    if (option.reason) {
      return [
        {
          fieldKey,
          label: fieldLabel,
          value,
          status: 'warning' as const,
          message: option.reason,
        },
      ]
    }

    return [
      {
        fieldKey,
        label: fieldLabel,
        value,
        status: 'ok' as const,
        message: 'Подходит по текущим данным стыка.',
      },
    ]
  })
}

function getOfficialStampSummaryText(
  status: StampDiagnosticStatus,
  rows: StampDiagnosticRow[],
  methods: readonly string[],
  uniqueStampCount: number,
  stampCompatibilityReason?: string | null,
) {
  if (stampCompatibilityReason && status === 'error') return stampCompatibilityReason
  if (status === 'error') return 'Есть выбранные клейма, которые нельзя использовать. Исправьте клеймо или данные стыка перед сохранением.'
  if (status === 'warning') return 'Клейма можно выбрать, но есть условия для проверки. Обычно нужно уточнить дату сварки или данные стыка.'
  if (rows.length > 0) return 'Выбранные официальные клейма проходят текущие проверки.'
  return 'Выберите официальные клейма, чтобы увидеть проверку по реестру, НАКС, ДЛС, способу, группе материалов, D/T и срокам.'
}

function getOfficialStampTeamText(
  status: StampDiagnosticStatus,
  methods: readonly string[],
  uniqueStampCount: number,
  stampCompatibilityReason?: string | null,
) {
  if (methods.length <= 1) return ''
  if (stampCompatibilityReason?.includes('Команда официальных клейм не покрывает')) return stampCompatibilityReason
  if (status === 'warning') return `Командная сварка ${methods.join(' + ')}: укажите недостающие данные, чтобы завершить проверку команды.`
  const teamPrefix = uniqueStampCount > 1 ? 'Команда клейм покрывает способ сварки' : 'Выбранное клеймо покрывает способ сварки'
  return `${teamPrefix}: ${methods.join(' + ')}.`
}

function getDiagnosticContainerClassName(status: StampDiagnosticStatus) {
  const base = 'mb-3 rounded-md border px-3 py-2 shadow-sm'
  if (status === 'error') return `${base} border-rose-200 bg-rose-50/70 shadow-rose-100/40`
  if (status === 'warning') return `${base} border-amber-200 bg-amber-50/70 shadow-amber-100/40`
  return `${base} border-emerald-200 bg-emerald-50/60 shadow-emerald-100/40`
}

function getDiagnosticIconClassName(status: StampDiagnosticStatus) {
  if (status === 'error') return 'shrink-0 rounded border border-rose-200 bg-white p-1 text-rose-600'
  if (status === 'warning') return 'shrink-0 rounded border border-amber-200 bg-white p-1 text-amber-600'
  return 'shrink-0 rounded border border-emerald-200 bg-white p-1 text-emerald-600'
}

function getDiagnosticChipClassName(status: StampDiagnosticStatus) {
  const base = 'inline-flex min-w-0 items-center gap-1 rounded border bg-white px-1.5 py-0.5 text-xs text-slate-700 shadow-sm'
  if (status === 'error') return `${base} border-rose-200 shadow-rose-100/40`
  if (status === 'warning') return `${base} border-amber-200 shadow-amber-100/40`
  return `${base} border-emerald-100 shadow-emerald-100/30`
}

function getDiagnosticMiniBadgeClassName(status: StampDiagnosticStatus) {
  const base = 'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none'
  if (status === 'error') return `${base} border-rose-200 bg-rose-50 text-rose-700`
  if (status === 'warning') return `${base} border-amber-200 bg-amber-50 text-amber-700`
  return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`
}

function getDiagnosticReasonClassName(status: StampDiagnosticStatus) {
  const base = 'inline-flex min-w-0 items-center overflow-hidden rounded border bg-white/80 text-xs shadow-sm'
  if (status === 'error') return `${base} border-rose-200 text-rose-700`
  if (status === 'warning') return `${base} border-amber-200 text-amber-800`
  return `${base} border-emerald-200 text-emerald-800`
}

function getDiagnosticReasonLabelClassName(status: StampDiagnosticStatus) {
  const base = 'mr-2 shrink-0 border-r px-2 py-1 font-semibold'
  if (status === 'error') return `${base} border-rose-200 bg-rose-50 text-rose-800`
  if (status === 'warning') return `${base} border-amber-200 bg-amber-50 text-amber-900`
  return `${base} border-emerald-200 bg-emerald-50 text-emerald-900`
}

function getDiagnosticBadgeText(status: StampDiagnosticStatus) {
  if (status === 'error') return 'нельзя'
  if (status === 'warning') return 'уточнить'
  return 'ок'
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
    'Заполняется по уже существующим стыкам этой линии: Проект, Шифр, группа трубопровода, категория трубопровода, Контроль швов (%) и назначения контроля.'
  const sourceText = state.sourceRowsCount > 0 ? `Источник: ${formatSourceRowsCount(state.sourceRowsCount)} линии ${state.line}.` : ''
  const resultText = state.changedFieldsCount > 0 ? `Будет заполнено полей: ${state.changedFieldsCount}.` : 'Данные по линии уже совпадают.'
  const title = state.disabledReason ? `${state.disabledReason} ${helpText}` : `${helpText} ${sourceText} ${resultText}`

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
