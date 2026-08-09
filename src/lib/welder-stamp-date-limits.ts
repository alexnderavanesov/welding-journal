import { getDateInputValidationReason } from '@/lib/date-format'

export const WELDER_STAMP_MIN_ALLOWED_DATE_ISO = '2023-01-01'
export const WELDER_STAMP_MIN_ALLOWED_DATE_DISPLAY = '01.01.2023'

export function getWelderStampDateInputValidationReason(value: unknown, label: string) {
  return getDateInputValidationReason(value, label, {
    minDateIso: WELDER_STAMP_MIN_ALLOWED_DATE_ISO,
    minDateDisplay: WELDER_STAMP_MIN_ALLOWED_DATE_DISPLAY,
  })
}
