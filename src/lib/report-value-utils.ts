import type { WeldInput } from '@/lib/weld-fields'

export function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

export function isYesText(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'да'
}

export function hasWeldDate(row: WeldInput) {
  return hasText(row.weldDate)
}

export function isEnabledControlValue(value: unknown) {
  if (value === true) return true
  return String(value ?? '').trim().toLowerCase() === 'да'
}
