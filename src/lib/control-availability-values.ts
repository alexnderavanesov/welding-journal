export const LEGACY_CONTROL_REPLACEMENT_VALUE = 'замена РК/УЗК'

export function normalizeControlAvailabilityText(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return text === LEGACY_CONTROL_REPLACEMENT_VALUE.toLowerCase() ? 'дополнительный' : text
}

export function isControlCancelledValue(value: unknown) {
  return normalizeControlAvailabilityText(value) === 'отменен'
}

export function isControlAdditionalValue(value: unknown) {
  return normalizeControlAvailabilityText(value) === 'дополнительный'
}

export function isControlEnabledValue(value: unknown) {
  if (value === true) return true
  const text = normalizeControlAvailabilityText(value)
  return text === 'да' || text === 'дополнительный'
}

export function normalizeControlAvailabilityFlag(value: unknown) {
  if (isControlCancelledValue(value)) return 'отменен'
  if (isControlAdditionalValue(value)) return 'дополнительный'
  if (value === true || isControlEnabledValue(value)) return 'да'
  return null
}
