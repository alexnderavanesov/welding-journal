import { PSTO_RESULT_STATUS_OPTIONS, type WeldFieldKey, type WeldInput } from '@/lib/weld-fields'

export function getHeatTreatmentImportKey(record: WeldInput) {
  const line = normalizeImportKeyPart(record.line)
  const joint = normalizeImportKeyPart(record.joint)
  return line && joint ? `${line}|${joint}` : null
}

export function normalizeImportKeyPart(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function normalizeHeatTreatmentImportValue(fieldKey: WeldFieldKey, value: unknown) {
  if (fieldKey === 'pstoResult') return getPstoResultValue(value) || null
  return value === undefined ? null : value
}

export function normalizeEditableImportValue(_fieldKey: WeldFieldKey, value: unknown) {
  return value === undefined ? null : value
}

export function normalizeExistingRequestImportValue(value: unknown, allowedRequestNames: ReadonlySet<string>) {
  const requestName = String(value ?? '').trim()
  if (!requestName) return { skip: false, value: null }
  if (!allowedRequestNames.has(requestName)) return { skip: true, value: null }
  return { skip: false, value: requestName }
}

export function isSameImportValue(left: unknown, right: unknown) {
  return String(left ?? '').trim() === String(right ?? '').trim()
}

export function getPstoResultValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  return PSTO_RESULT_STATUS_OPTIONS.includes(text as never) ? text : ''
}
