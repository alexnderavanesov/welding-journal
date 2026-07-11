import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { WeldFormConnectionTypeField } from '@/components/weld-form-connection-type-field'
import { WeldFormWeldingMethodField } from '@/components/weld-form-welding-method-field'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
import { cn } from '@/lib/utils'
import {
  FINAL_STATUS_OPTIONS,
  RESULT_FIELD_KEYS,
  RESULT_STATUS_OPTIONS,
  type WeldField,
  type WeldFieldKey,
  type WeldInput,
  calculateFinalStatus,
} from '@/lib/weld-fields'
import {
  getFinalStatusValue,
  getResultStatusValue,
  getStampSelectValue,
  isAdditionalValue,
  isCancelledValue,
  isYesValue,
  yesEmptyFieldKeys,
  type StampSelectOptions,
} from '@/lib/weld-form-utils'

type WeldFormFieldProps = {
  field: WeldField & { key: WeldFieldKey }
  draft: WeldInput
  stampSelectOptions?: StampSelectOptions
  fieldRefs: MutableRefObject<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>
  setDraft: Dispatch<SetStateAction<WeldInput>>
  hideLabel?: boolean
  controlPickerLayout?: 'grid' | 'row'
}

export function WeldFormField({ field, draft, stampSelectOptions, fieldRefs, setDraft, hideLabel = false, controlPickerLayout = 'grid' }: WeldFormFieldProps) {
  return (
    <div className="space-y-1.5 text-sm">
      {hideLabel ? null : <span className="text-[13px] font-medium leading-none text-slate-700">{getFormFieldLabel(field)}</span>}
      {stampSelectOptions?.[field.key] ? (
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
          {stampSelectOptions[field.key]?.map((option) => (
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
        <WeldFormWeldingMethodField
          value={draft.weldingMethod}
          inputRef={(element) => {
            fieldRefs.current[field.key] = element
          }}
          onChange={(weldingMethod) =>
            setDraft((current) => ({
              ...current,
              weldingMethod,
            }))
          }
        />
      ) : field.key === 'connectionType' ? (
        <WeldFormConnectionTypeField
          value={draft.connectionType}
          inputRef={(element) => {
            fieldRefs.current[field.key] = element
          }}
          onChange={(connectionType) =>
            setDraft((current) => ({
              ...current,
              connectionType,
            }))
          }
        />
      ) : field.key === 'revisionActuality' ? (
        <Select
          ref={(element) => {
            fieldRefs.current[field.key] = element
          }}
          value={String(draft[field.key] ?? '')}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              [field.key]: event.target.value || null,
            }))
          }
        >
          <option value="">Пусто</option>
          <option value="не актуален">не актуален</option>
        </Select>
      ) : RESULT_FIELD_KEYS.has(field.key) ? (
        <Select
          ref={(element) => {
            fieldRefs.current[field.key] = element
          }}
          value={field.key === 'finalStatus' ? getFinalStatusValue(calculateFinalStatus(draft)) : getResultStatusValue(draft[field.key])}
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
        <ControlAvailabilityPicker
          value={getControlAvailabilityValue(draft[field.key])}
          layout={controlPickerLayout}
          inputRef={(element) => {
            fieldRefs.current[field.key] = element
          }}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              [field.key]:
                value === 'yes'
                  ? field.kind === 'boolean'
                    ? true
                    : 'да'
                  : value === 'additional'
                      ? 'дополнительный'
                      : value === 'cancelled'
                        ? 'отменен'
                        : null,
            }))
          }
        />
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
          min={field.kind === 'date' ? MIN_ALLOWED_DATE_ISO : undefined}
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
  )
}

type ControlAvailabilityValue = '' | 'yes' | 'cancelled' | 'additional'

type ControlAvailabilityOption = {
  value: ControlAvailabilityValue
  label: string
  shortLabel: string
  description: string
  disabled?: boolean
  disabledReason?: string
}

function ControlAvailabilityPicker({
  value,
  layout,
  inputRef,
  onChange,
}: {
  value: ControlAvailabilityValue
  layout: 'grid' | 'row'
  inputRef: (element: HTMLButtonElement | null) => void
  onChange: (value: ControlAvailabilityValue) => void
}) {
  const options = getControlAvailabilityOptions()

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 shadow-sm shadow-slate-200/30">
      <div className={cn('grid gap-1.5', layout === 'row' ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-5' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3')}>
        {options.map((option, index) => {
          const active = value === option.value
          return (
            <button
              key={option.value || 'empty'}
              ref={index === 0 ? inputRef : undefined}
              type="button"
              disabled={option.disabled}
              title={option.disabledReason}
              onClick={() => {
                if (!option.disabled) onChange(option.value)
              }}
              className={cn(
                'min-h-[58px] rounded-md border bg-white px-2.5 py-2 text-left transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300',
                active
                  ? 'border-sky-300 bg-sky-50 text-sky-900 shadow-sm'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-white',
                option.disabled
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100/80 text-slate-400 hover:border-slate-200 hover:bg-slate-100/80'
                  : '',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold leading-tight">{option.label}</span>
                {active ? <span className="h-2 w-2 rounded-full bg-sky-500" /> : null}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">{option.disabled ? option.disabledReason : option.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getControlAvailabilityOptions(): ControlAvailabilityOption[] {
  return [
    {
      value: '',
      label: 'Пусто',
      shortLabel: 'пусто',
      description: 'Контроль не назначен.',
    },
    {
      value: 'yes',
      label: 'Да',
      shortLabel: 'да',
      description: 'Обычный обязательный контроль.',
    },
    {
      value: 'additional',
      label: 'Дополнительный',
      shortLabel: 'доп.',
      description: 'Контроль сверх проекта или процента.',
    },
    {
      value: 'cancelled',
      label: 'Отменен',
      shortLabel: 'отменен',
      description: 'Контроль официально отменен.',
    },
  ]
}

function getControlAvailabilityValue(value: unknown): ControlAvailabilityValue {
  if (isAdditionalValue(value)) return 'additional'
  if (isYesValue(value)) return 'yes'
  if (isCancelledValue(value)) return 'cancelled'
  return ''
}

function getFormFieldLabel(field: WeldField & { key: WeldFieldKey }) {
  return field.label
}
