import { FINAL_STATUS_OPTIONS, RESULT_STATUS_OPTIONS } from '@/lib/weld-fields'
import { isControlAdditionalValue, isControlEnabledValue } from '@/lib/control-availability-values'
import { DEFAULT_WELDING_TYPE_OPTIONS } from '@/lib/data-list-settings'

export const weldingMethodOptions = DEFAULT_WELDING_TYPE_OPTIONS

export function isYesValue(value: unknown) {
  return isControlEnabledValue(value)
}

export function isCancelledValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

export function isAdditionalValue(value: unknown) {
  return isControlAdditionalValue(value)
}

export function getSelectedWeldingMethods(value: unknown, options: readonly string[] = weldingMethodOptions) {
  const selected = new Set(
    String(value ?? '')
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return options.filter((option) => selected.has(option))
}

export function toggleWeldingMethodValue(value: unknown, option: string, options: readonly string[] = weldingMethodOptions) {
  const selected = new Set(getSelectedWeldingMethods(value, options))
  if (selected.has(option)) {
    selected.delete(option)
  } else {
    selected.add(option)
  }

  const next = options.filter((item) => selected.has(item)).join('+')
  return next || null
}

export function getResultStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = RESULT_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

export function getFinalStatusValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const option = FINAL_STATUS_OPTIONS.find((status) => status.toLowerCase() === text)
  return option ?? ''
}

export function getStampSelectValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text.toLowerCase() === 'пусто' ? '' : text
}
