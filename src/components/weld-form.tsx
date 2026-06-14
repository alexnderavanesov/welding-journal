import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  FINAL_STATUS_OPTIONS,
  RESULT_FIELD_KEYS,
  RESULT_STATUS_OPTIONS,
  VISIBLE_FIELD_SECTIONS,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'

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

type WeldFormProps = {
  value: WeldInput & { id?: number }
  focusField?: WeldFieldKey
  onSave: (value: WeldInput) => void
  onCancel: () => void
  busy?: boolean
}

export function WeldForm({ value, focusField, onSave, onCancel, busy }: WeldFormProps) {
  const [draft, setDraft] = useState<WeldInput>(value)
  const fieldRefs = useRef<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | null>>>({})
  const fieldsByGroup = useMemo(() => VISIBLE_FIELD_SECTIONS, [])
  const handleSave = () => {
    if (!busy) onSave(withCalculatedFinalStatus(draft))
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
  }, [busy, draft, onCancel, onSave])

  useEffect(() => {
    if (!focusField) return

    const element = fieldRefs.current[focusField]
    if (!element) return

    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element.focus()
    if (element instanceof HTMLInputElement) {
      element.select()
    }
  }, [focusField])

  useEffect(() => {
    setDraft((current) => {
      const nextFinalStatus = calculateFinalStatus(current)
      return current.finalStatus === nextFinalStatus ? current : { ...current, finalStatus: nextFinalStatus }
    })
  }, [draft])

  return (
    <div className="fixed inset-0 z-20 bg-slate-950/20 backdrop-blur-[1px]">
      <div className="ml-auto flex h-full w-full max-w-5xl flex-col bg-slate-50 shadow-2xl shadow-slate-950/10">
        <div className="flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{value.id ? 'Редактирование стыка' : 'Новый стык'}</h2>
            <p className="text-sm text-muted-foreground">{getJointTitle(draft)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-6">
          <div className="space-y-8">
            {fieldsByGroup.map(({ section, fields }) => (
              <section key={section}>
                <div className="mb-4 flex items-center gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section}</h3>
                  <div className="h-px flex-1 bg-slate-200/80" />
                </div>
                <div className="grid grid-cols-1 gap-x-3 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                  {fields.map((field) => (
                    <label key={field.key} className="space-y-1.5 text-sm">
                      <span className="text-[13px] font-medium leading-none text-slate-700">{field.label}</span>
                      {RESULT_FIELD_KEYS.has(field.key) ? (
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
                      ) : field.key === 'status' ? (
                        <Select
                          ref={(element) => {
                            fieldRefs.current[field.key] = element
                          }}
                          value={getJointStatusValue(draft[field.key])}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [field.key]: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">Пусто</option>
                          <option value="неофициальный">неофициальный</option>
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
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200/80 bg-white px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            <Check className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}

function isYesValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').toLowerCase() === 'да'
}

function getResultStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return RESULT_STATUS_OPTIONS.includes(text as never) ? text : ''
}

function getFinalStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return FINAL_STATUS_OPTIONS.includes(text as never) ? text : ''
}

function getJointStatusValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'неофициальный' ? 'неофициальный' : ''
}

function withCalculatedFinalStatus(value: WeldInput) {
  return { ...value, finalStatus: calculateFinalStatus(value) }
}

function getJointTitle(value: WeldInput) {
  const line = String(value.line ?? '').trim()
  const joint = String(value.joint ?? '').trim()

  if (!line && !joint) return 'Линия и номер стыка появятся после заполнения.'
  return `Линия: ${line || '-'} · Стык: ${joint || '-'}`
}
