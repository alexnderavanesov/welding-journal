import type { WeldInput } from '@/lib/weld-fields'

export function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

export function isYesText(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'да' || text === 'дополнительный' || isLegacyReplacementControlValue(value)
}

export const CONTROL_REPLACEMENT_VALUE = 'замена РК/УЗК'

export function isCancelledControlValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'отменен'
}

export function isAdditionalControlValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'дополнительный' || isLegacyReplacementControlValue(value)
}

export function isLegacyReplacementControlValue(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === CONTROL_REPLACEMENT_VALUE.toLowerCase()
}

export function getCancelledLnkResultDisplay(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'годен' || result === 'да' || result === 'годен (отменен)' ? 'годен (отменен)' : 'отменен'
}

export function isPendingLnkResultValue(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'ожидает нк' || result === 'ожидает' || result === 'ожидает заявку'
}

export function hasRealLnkResultValue(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'годен' || result === 'ремонт' || result === 'вырез'
}

export function getCancelledPstoResultDisplay(value: unknown) {
  const result = String(value ?? '').trim().toLowerCase()
  return result === 'проведено' || result === 'да' || result === 'проведено (отменен)' ? 'проведено (отменен)' : 'отменен'
}

export function normalizeControlAvailabilityValue(value: unknown) {
  if (isCancelledControlValue(value)) return 'отменен'
  if (isAdditionalControlValue(value)) return 'дополнительный'
  if (value === true || isYesText(value)) return 'да'
  return null
}

export function formatControlAvailabilityForExport(value: unknown) {
  return normalizeControlAvailabilityValue(value) ?? ''
}

export function hasWeldDate(row: WeldInput) {
  return hasText(row.weldDate)
}

export function isEnabledControlValue(value: unknown) {
  if (value === true) return true
  const text = String(value ?? '').trim().toLowerCase()
  return text === 'да' || text === 'дополнительный' || isLegacyReplacementControlValue(value)
}
