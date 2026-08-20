import {
  WELD_FIELDS,
  isVirtualWeldField,
  normalizeHeader,
} from './weld-field-definitions'
import { CONTROL_BASIS_FIELD_KEYS } from './control-assignment-basis'

const EXCLUDED_EXCEL_FIELD_KEYS = new Set([
  'id',
  'materialId1',
  'materialId2',
  'createdAt',
  'weldingUpdatedAt',
  'pstoCreatedAt',
  'pstoUpdatedAt',
  'lnkCreatedAt',
  'lnkUpdatedAt',
  'rkExposureConfirmedDiameter',
])

export const EXCEL_FIELDS = WELD_FIELDS.filter(
  (field) => !isVirtualWeldField(field) && !EXCLUDED_EXCEL_FIELD_KEYS.has(field.key),
)
export const FULL_EXCEL_HEADERS = EXCEL_FIELDS.map((field) => field.label)
export const REQUIRED_EXCEL_HEADERS = EXCEL_FIELDS
  .filter((field) => !CONTROL_BASIS_FIELD_KEYS.includes(field.key as (typeof CONTROL_BASIS_FIELD_KEYS)[number]))
  .map((field) => field.label)

export function isKnownHeaderSet(headers: string[]) {
  const normalized = headers
    .map(normalizeHeader)
    .filter(Boolean)
  return REQUIRED_EXCEL_HEADERS.every((header) => normalized.includes(header))
}
