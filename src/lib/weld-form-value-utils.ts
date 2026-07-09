import { FINAL_STATUS_OPTIONS, RESULT_STATUS_OPTIONS } from '@/lib/weld-fields'
import { isControlAdditionalValue, isControlEnabledValue } from '@/lib/control-availability-values'

export const weldingMethodOptions = ['РАД', 'РД', 'МП'] as const

export function isYesValue(value: unknown) {
  return isControlEnabledValue(value)
}

export function isCancelledValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

export function isAdditionalValue(value: unknown) {
  return isControlAdditionalValue(value)
}

export function getSelectedWeldingMethods(value: unknown) {
  const selected = new Set(
    String(value ?? '')
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  return weldingMethodOptions.filter((option) => selected.has(option))
}

export function toggleWeldingMethodValue(value: unknown, option: (typeof weldingMethodOptions)[number]) {
  const selected = new Set(getSelectedWeldingMethods(value))
  if (selected.has(option)) {
    selected.delete(option)
  } else {
    selected.add(option)
  }

  const next = weldingMethodOptions.filter((item) => selected.has(item)).join('+')
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
