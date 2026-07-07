import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { WeldFormWeldingMethodField } from '@/components/weld-form-welding-method-field'
import { MIN_ALLOWED_DATE_ISO } from '@/lib/date-format'
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
  CONTROL_REPLACEMENT_VALUE,
  isAdditionalValue,
  isCancelledValue,
  isReplacementValue,
  isYesValue,
  percentageControlFieldKeys,
  replacementControlFieldKeys,
  yesEmptyFieldKeys,
  type StampSelectOptions,
} from '@/lib/weld-form-utils'

type WeldFormFieldProps = {
  field: WeldField & { key: WeldFieldKey }
  draft: WeldInput
  stampSelectOptions?: StampSelectOptions
  fieldRefs: MutableRefObject<Partial<Record<WeldFieldKey, HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null>>>
  setDraft: Dispatch<SetStateAction<WeldInput>>
}

export function WeldFormField({ field, draft, stampSelectOptions, fieldRefs, setDraft }: WeldFormFieldProps) {
  const hasReplacementControl = hasReplacementControlValue(draft)
  const hasActivePercentageControl = hasActivePercentageControlValue(draft)
  const isPercentageControlField = percentageControlFieldKeys.has(field.key)
  const isReplacementControlField = replacementControlFieldKeys.has(field.key)
  const blockPercentageControlByReplacement = isPercentageControlField && hasReplacementControl
  const blockReplacementByPercentageControl = isReplacementControlField && hasActivePercentageControl

  return (
    <div className="space-y-1.5 text-sm">
      <span className="text-[13px] font-medium leading-none text-slate-700">{field.label}</span>
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
        <Select
          ref={(element) => {
            fieldRefs.current[field.key] = element
          }}
          title={getControlAvailabilitySelectTitle({
            blockPercentageControlByReplacement,
            blockReplacementByPercentageControl,
          })}
          value={
            isReplacementValue(draft[field.key])
              ? 'replacement'
              : isAdditionalValue(draft[field.key])
              ? 'additional'
              : isYesValue(draft[field.key])
                ? 'yes'
                : isCancelledValue(draft[field.key])
                  ? 'cancelled'
                  : ''
          }
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              [field.key]:
                event.target.value === 'yes'
                  ? field.kind === 'boolean'
                    ? true
                    : 'да'
                  : event.target.value === 'replacement'
                    ? CONTROL_REPLACEMENT_VALUE
                  : event.target.value === 'additional'
                    ? 'дополнительный'
                    : event.target.value === 'cancelled'
                      ? 'отменен'
                      : null,
            }))
          }
        >
          <option value="">пусто</option>
          <option
            value="yes"
            disabled={blockPercentageControlByReplacement}
            title={blockPercentageControlByReplacement ? 'Сначала уберите «замена РК/УЗК» в другом виде контроля.' : undefined}
          >
            да
          </option>
          <option value="cancelled">отменен</option>
          <option
            value="additional"
            disabled={blockPercentageControlByReplacement}
            title={blockPercentageControlByReplacement ? 'Сначала уберите «замена РК/УЗК» в другом виде контроля.' : undefined}
          >
            дополнительный
          </option>
          {isReplacementControlField ? (
            <option
              value="replacement"
              disabled={blockReplacementByPercentageControl}
              title={blockReplacementByPercentageControl ? 'Сначала уберите «да» или «дополнительный» в РК/УЗК.' : undefined}
            >
              замена РК/УЗК
            </option>
          ) : null}
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

function hasReplacementControlValue(draft: WeldInput) {
  return Array.from(replacementControlFieldKeys).some((fieldKey) => isReplacementValue(draft[fieldKey]))
}

function hasActivePercentageControlValue(draft: WeldInput) {
  return Array.from(percentageControlFieldKeys).some((fieldKey) => isOrdinaryOrAdditionalControlValue(draft[fieldKey]))
}

function isOrdinaryOrAdditionalControlValue(value: unknown) {
  if (value === true) return true
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'да' || text === 'дополнительный'
}

function getControlAvailabilitySelectTitle({
  blockPercentageControlByReplacement,
  blockReplacementByPercentageControl,
}: {
  blockPercentageControlByReplacement: boolean
  blockReplacementByPercentageControl: boolean
}) {
  if (blockPercentageControlByReplacement) return 'Сначала уберите «замена РК/УЗК», затем назначайте РК или УЗК.'
  if (blockReplacementByPercentageControl) return 'Замена РК/УЗК доступна только если РК и УЗК не назначены как «да» или «дополнительный».'
  return undefined
}
