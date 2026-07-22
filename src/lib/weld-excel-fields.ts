import {
  WELD_FIELDS,
  normalizeHeader,
} from './weld-field-definitions'

const EXCLUDED_EXCEL_FIELD_KEYS = new Set(['materialId1', 'materialId2', 'createdAt', 'pstoCreatedAt', 'lnkCreatedAt'])

export const EXCEL_FIELDS = WELD_FIELDS.filter((field) => !EXCLUDED_EXCEL_FIELD_KEYS.has(field.key))
export const FULL_EXCEL_HEADERS = EXCEL_FIELDS.map((field) => field.label)

export function isKnownHeaderSet(headers: string[]) {
  const normalized = headers
    .map(normalizeHeader)
    .filter(Boolean)
  return FULL_EXCEL_HEADERS.every((header) => normalized.includes(header))
}
