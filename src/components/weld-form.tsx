import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  FIELD_BY_KEY,
  FINAL_STATUS_OPTIONS,
  RESULT_FIELD_KEYS,
  RESULT_STATUS_OPTIONS,
  VISIBLE_FIELD_SECTIONS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'
import {
  getRequiredRootStampMessage,
  withAutoVikForWeldDate,
} from '@/lib/weld-import-export'
import { hasReservedJointSystemPart, normalizeJointName, validateManualJointName } from '@/lib/joint-name'

const yesEmptyFieldKeys = new Set([
  'pstoRequired',
  'hasVik',
  'hasRk',
  'hasPvk',
  'hasUzk',
  'hasTvmt',
  'hasRfa',
  'hasStls',
  'hasMkk',
])
const weldingMethodOptions = ['РАД', 'РД', 'МП'] as const
const factualWelderStampFieldKeys = new Set<WeldFieldKey>([
  'stamp1KFact',
  'stamp1ZFact',
  'stamp1OFact',
  'stamp2KFact',
  'stamp2ZFact',
  'stamp2OFact',
])

const formHiddenFieldKeys = new Set<WeldFieldKey>([
  'status',
  'createdAt',
  'vikRequest',
  'rkRequest',
  'pvkRequest',
  'uzkRequest',
  'pstoRequest',
  'tvmtRequest',
  'rfaRequest',
  'stlsRequest',
  'mkkRequest',
  'pstoDate',
  'heatTreatmentDiagram',
  'vikResult',
  'rkResult',
  'pvkResult',
  'uzkResult',
  'pstoResult',
  'tvmtResult',
  'rfaResult',
  'stlsResult',
  'mkkResult',
  'pstoNote',
  'finalStatus',
  'pstoBoq',
  'pstoKs3',
  'pstoCreatedAt',
  'lnkCreatedAt',
  'vikBoq',
  'vikKs3',
  'rkBoq',
  'rkKs3',
  'pvkBoq',
  'pvkKs3',
  'uzkBoq',
  'uzkKs3',
  'tvmtBoq',
  'tvmtKs3',
  'rfaBoq',
  'rfaKs3',
  'stlsBoq',
  'stlsKs3',
  'mkkBoq',
  'mkkKs3',
  'vikConclusionDate',
  'vikConclusion',
  'rkConclusionDate',
  'rkConclusion',
  'pvkConclusionDate',
  'pvkConclusion',
  'uzkConclusionDate',
  'uzkConclusion',
  'tvmtConclusionDate',
  'tvmtConclusion',
  'rfaConclusionDate',
  'rfaConclusion',
  'stlsConclusionDate',
  'stlsConclusion',
  'mkkConclusionDate',
  'mkkConclusion',
  'lnkDefectDescription',
  'lnkNote',
])

type WeldFormProps = {
  value: WeldInput & { id?: number }
  focusField?: WeldFieldKey
  stampSelectOptions?: StampSelectOptions | ((value: WeldInput) => StampSelectOptions)
  getExternalSaveBlockReason?: (value: WeldInput) => string | null
  onSave: (value: WeldInput) => void
  onCancel: () => void
  busy?: boolean
}

export type StampSelectOption = {
  value: string
  disabled?: boolean
  reason?: string
}

export type StampSelectOptions = Partial<Record<WeldFieldKey, readonly StampSelectOption[]>>

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/20 px-4 py-4 backdrop-blur-[1px]">
      <div className="flex max-h-[96vh] w-full max-w-[min(1500px,96vw)] flex-col rounded-md border border-slate-200 bg-slate-50 shadow-2xl shadow-slate-950/10">
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{value.id ? 'Редактирование стыка' : 'Новый стык'}</h2>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span>{getJointTitle(draft)}</span>
              <OfficialityBadge value={draft} />
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-8">
            {fieldsByGroup.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                Нет доступных полей для редактирования этой записи.
              </div>
            ) : null}
            {fieldsByGroup.map(({ section, fields }) => (
              <section key={section}>
                <button
                  type="button"
                  onClick={() => toggleSection(section)}
                  className="mb-4 flex w-full items-center gap-3 rounded-sm text-left transition-colors hover:text-slate-900"
                  aria-expanded={!collapsedSections.has(section)}
                >
                  {collapsedSections.has(section) ? (
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  )}
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section}</h3>
                  <div className="h-px flex-1 bg-slate-200/80" />
                  <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {collapsedSections.has(section) ? 'Скрыто' : `${fields.length}`}
                  </span>
                </button>
                {collapsedSections.has(section) ? null : (
                  <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                    {fields.map((field) => (
                      <div key={field.key} className="space-y-1.5 text-sm">
                        <span className="text-[13px] font-medium leading-none text-slate-700">{field.label}</span>
                        {resolvedStampSelectOptions?.[field.key] ? (
                          <Select
                            ref={(element) => {
                              fieldRefs.current[field.key] = element
                            }}
                            value={getStampSelectValue(draft[field.key])}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [field.key]: event.target.value || null,
                              }))
                            }
                          >
                            <option value="">Пусто</option>
                            {resolvedStampSelectOptions[field.key]?.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={option.disabled}
                                title={option.reason}
                                className={option.disabled ? 'bg-slate-100 text-slate-400' : undefined}
                              >
                                {option.value}
                              </option>
                            ))}
                          </Select>
                        ) : field.key === 'weldingMethod' ? (
                          <div
                            className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-white px-2 py-1.5 shadow-sm"
                            role="group"
                            aria-label="Тип сварки"
                          >
                            {weldingMethodOptions.map((option, index) => {
                              const selected = getSelectedWeldingMethods(draft.weldingMethod).includes(option)
                              return (
                                <button
                                  key={option}
                                  ref={(element) => {
                                    if (index === 0) fieldRefs.current[field.key] = element
                                  }}
                                  type="button"
                                  onClick={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      weldingMethod: toggleWeldingMethodValue(current.weldingMethod, option),
                                    }))
                                  }
                                  className={[
                                    'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                                    selected
                                      ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-sm'
                                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-200 hover:bg-sky-50',
                                  ].join(' ')}
                                  aria-pressed={selected}
                                >
                                  {option}
                                </button>
                              )
                            })}
                            {getSelectedWeldingMethods(draft.weldingMethod).length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    weldingMethod: null,
                                  }))
                                }
                                className="ml-auto rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50"
                              >
                                Очистить
                              </button>
                            ) : null}
                          </div>
                        ) : RESULT_FIELD_KEYS.has(field.key) ? (
                          <Select
                            ref={(element) => {
                              fieldRefs.current[field.key] = element
                            }}
                            value={
                              field.key === 'finalStatus'
                                ? getFinalStatusValue(calculateFinalStatus(draft))
                                : getResultStatusValue(draft[field.key])
                            }
                            disabled={field.key === 'finalStatus'}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [field.key]: event.target.value || null,
                              }))
                            }
                          >
                            <option value="">Пусто</option>
                            {(field.key === 'finalStatus' ? FINAL_STATUS_OPTIONS : RESULT_STATUS_OPTIONS).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        ) : yesEmptyFieldKeys.has(field.key) ? (
                          <Select
                            ref={(element) => {
                              fieldRefs.current[field.key] = element
                            }}
                            value={isYesValue(draft[field.key]) ? 'yes' : ''}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [field.key]: event.target.value === 'yes' ? (field.kind === 'boolean' ? true : 'да') : null,
                              }))
                            }
                          >
                            <option value="yes">да</option>
                            <option value="">пусто</option>
                          </Select>
                        ) : field.kind === 'boolean' ? (
                          <Select
                            ref={(element) => {
                              fieldRefs.current[field.key] = element
                            }}
                            value={draft[field.key] === true ? 'true' : draft[field.key] === false ? 'false' : ''}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [field.key]: event.target.value === '' ? null : event.target.value === 'true',
                              }))
                            }
                          >
                            <option value="">Пусто</option>
                            <option value="true">да</option>
                            <option value="false">нет</option>
                          </Select>
                        ) : (
                          <Input
                            ref={(element) => {
                              fieldRefs.current[field.key] = element
                            }}
                            type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
                            step={field.kind === 'number' ? '0.001' : undefined}
                            value={String(draft[field.key] ?? '')}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 bg-white px-6 py-4">
          <div className="min-h-6 min-w-0 flex-1 text-sm text-slate-500">
            {saveBlockReason ? (
              <span className="inline-flex max-w-full rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-800 shadow-sm">
                <span className="truncate">Чтобы сохранить: {saveBlockReason}</span>
              </span>
            ) : autoFillMessages[0] ? (
              <span className="inline-flex max-w-full rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-800 shadow-sm">
                <span className="truncate">{autoFillMessages[0]}</span>
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={busy || Boolean(saveBlockReason)} title={saveBlockReason ?? undefined}>
              <Check className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function isYesValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').toLowerCase() === 'да'
}

function getSelectedWeldingMethods(value: unknown) {
  const selected = new Set(
    String(value ?? '')
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return weldingMethodOptions.filter((option) => selected.has(option))
}

function toggleWeldingMethodValue(value: unknown, option: (typeof weldingMethodOptions)[number]) {
  const selected = new Set(getSelectedWeldingMethods(value))
  if (selected.has(option)) {
    selected.delete(option)
  } else {
    selected.add(option)
  }

  const next = weldingMethodOptions.filter((item) => selected.has(item)).join('+')
  return next || null
}

function getResultStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

function getFinalStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = FINAL_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

function OfficialityBadge({ value }: { value: WeldInput }) {
  if (String(value.status ?? '').trim().toLowerCase() !== 'неофициальный') return null
  return (
    <span className="inline-flex items-center rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
      неофициальный
    </span>
  )
}


function withCalculatedFinalStatus(value: WeldInput) {
  const nextValue = withAutoVikForWeldDate(value)
  return { ...nextValue, finalStatus: calculateFinalStatus(nextValue) }
}

function getJointTitle(value: WeldInput) {
  const project = String(value.projectTitle ?? '').trim()
  const subtitle = String(value.subtitleCode ?? '').trim()
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!project && !subtitle && !line && !joint) return 'Проект, шифр, линия и стык появятся после заполнения.'
  return `${project || '-'} · ${subtitle || '-'} · ${line || '-'} · ${joint || '-'}`
}

function getWeldFormSaveBlockReason(draft: WeldInput, initialValue: WeldInput & { id?: number }) {
  if (isFutureWeldDate(draft.weldDate)) {
    return 'дата сварки не может быть позже сегодняшней.'
  }

  const currentJoint = normalizeJointName(draft.joint)
  const initialJoint = normalizeJointName(initialValue.joint)
  if (initialValue.id && currentJoint === initialJoint) return null

  if (initialValue.id && hasReservedJointSystemPart(initialValue.joint)) {
    return 'стык с системными индексами R/W/Y нельзя переименовывать вручную. Используйте подсказки диспетчера задач.'
  }

  return validateManualJointName(draft.joint)
}

function getWeldStampSaveBlockReason(
  draft: WeldInput,
  stampSelectOptions: StampSelectOptions | undefined,
) {
  if (!stampSelectOptions) return null

  for (const [fieldKey, options] of Object.entries(stampSelectOptions) as Array<[WeldFieldKey, readonly StampSelectOption[]]>) {
    if (factualWelderStampFieldKeys.has(fieldKey)) continue

    const value = getStampSelectValue(draft[fieldKey])
    if (!value) continue

    const selectedOption = options.find((option) => option.value.trim() === value)
    if (!selectedOption) {
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} должно быть выбрано из активного реестра клейм.`
    }
    if (selectedOption.disabled) {
      const reason = selectedOption.reason ? `: ${selectedOption.reason}` : ''
      return `${FIELD_BY_KEY.get(fieldKey)?.label ?? 'поле клейма'} не подходит по реестру клейм${reason}.`
    }
  }

  return null
}

function getStampSelectValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text.toLowerCase() === 'пусто' ? '' : text
}

function isFutureWeldDate(value: unknown) {
  const date = String(value ?? '').trim()
  if (!date) return false
  return date > getTodayIsoDate()
}

function getTodayIsoDate() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
