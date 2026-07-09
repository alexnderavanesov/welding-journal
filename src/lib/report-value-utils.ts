import type { WeldInput } from '@/lib/weld-fields'
import {
  isControlAdditionalValue,
  isControlCancelledValue,
  isControlEnabledValue,
  normalizeControlAvailabilityFlag,
} from '@/lib/control-availability-values'

export function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

export function isYesText(value: unknown) {
  return isControlEnabledValue(value)
}

export function isCancelledControlValue(value: unknown) {
  return isControlCancelledValue(value)
}

export function isAdditionalControlValue(value: unknown) {
  return isControlAdditionalValue(value)
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
  return normalizeControlAvailabilityFlag(value)
}

export function formatControlAvailabilityForExport(value: unknown) {
  return normalizeControlAvailabilityValue(value) ?? ''
}

export function hasWeldDate(row: WeldInput) {
  return hasText(row.weldDate)
}

export function isEnabledControlValue(value: unknown) {
  return isControlEnabledValue(value)
}
