import { PSTO_RESULT_STATUS_OPTIONS } from '@/lib/weld-fields'

export function isSameImportValue(left: unknown, right: unknown) {
  return String(left ?? '').trim() === String(right ?? '').trim()
}

export function getPstoResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return PSTO_RESULT_STATUS_OPTIONS.includes(text as never) ? text : ''
}
