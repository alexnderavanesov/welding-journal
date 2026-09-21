export const LEGACY_CONTROL_REPLACEMENT_VALUE = 'замена РК/УЗК'
export const CONTROL_ASSIGNMENT_FIELD_KEYS = new Set([
  'hasVik',
  'hasRk',
  'hasUzk',
  'hasPvk',
  'hasTvmt',
  'pstoRequired',
])

export const CONTROL_YES_NORMALIZED_VALUES = [
  'да',
  'yes',
  'true',
  '1',
  '+',
] as const

export const CONTROL_NO_NORMALIZED_VALUES = [
  'нет',
  'no',
  'false',
  '0',
] as const

export const CONTROL_ADDITIONAL_NORMALIZED_VALUES = [
  'дополнительный',
  LEGACY_CONTROL_REPLACEMENT_VALUE.toLocaleLowerCase('ru-RU'),
] as const

export const CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES = [
  ...CONTROL_YES_NORMALIZED_VALUES,
  ...CONTROL_ADDITIONAL_NORMALIZED_VALUES,
] as const

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
  return CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.includes(
    text as (typeof CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)[number],
  )
}

export function isControlDisabledValue(value: unknown) {
  if (value === false) return true
  const text = normalizeControlAvailabilityText(value)
  return CONTROL_NO_NORMALIZED_VALUES.includes(text as (typeof CONTROL_NO_NORMALIZED_VALUES)[number])
}

export function isRecognizedControlAvailabilityValue(value: unknown) {
  const text = normalizeControlAvailabilityText(value)
  return (
    !text ||
    text === '-' ||
    text === 'отменен' ||
    CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES.includes(
      text as (typeof CONTROL_ENABLED_NORMALIZED_STORAGE_VALUES)[number],
    ) ||
    CONTROL_NO_NORMALIZED_VALUES.includes(text as (typeof CONTROL_NO_NORMALIZED_VALUES)[number])
  )
}

export function normalizeControlAvailabilityFilterValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = normalizeControlAvailabilityText(value)
  if (!text || text === '-') return ''
  if (isControlAdditionalValue(text)) return 'дополнительный'
  if (isControlCancelledValue(text)) return 'отменен'
  if (isControlEnabledValue(value)) return 'да'
  if (isControlDisabledValue(value)) return 'нет'
  return text
}

export function getControlAvailabilityFilterAliases(value: unknown): readonly string[] {
  const normalized = normalizeControlAvailabilityFilterValue(value)
  if (!normalized) return ['', '-']
  if (normalized === 'да') return CONTROL_YES_NORMALIZED_VALUES
  if (normalized === 'нет') return CONTROL_NO_NORMALIZED_VALUES
  if (normalized === 'дополнительный') return CONTROL_ADDITIONAL_NORMALIZED_VALUES
  return [normalized]
}

export function normalizeControlAvailabilityStorageText(value: unknown) {
  const normalized = normalizeControlAvailabilityFilterValue(value)
  return normalized || null
}

export function normalizeControlAvailabilityFlag(value: unknown) {
  if (isControlCancelledValue(value)) return 'отменен'
  if (isControlAdditionalValue(value)) return 'дополнительный'
  if (value === true || isControlEnabledValue(value)) return 'да'
  return null
}
