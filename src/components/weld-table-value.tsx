import {
  AdditionalBadge,
  CancelledBadge,
  ReplacementBadge,
  ResultBadge,
  YesBadge,
  formatDate,
  formatDateTime,
  isCancelledText,
  isAdditionalText,
  isNoText,
  isReplacementText,
  isYesText,
} from '@/lib/weld-table-utils'
import type { WeldField, WeldFieldKey } from '@/lib/weld-fields'

const DATE_TIME_FIELD_KEYS = new Set<WeldFieldKey>(['createdAt', 'pstoCreatedAt', 'lnkCreatedAt'])

export function WeldTableValue({
  field,
  value,
  isResultField,
}: {
  field: WeldField
  value: unknown
  isResultField: boolean
}) {
  if (field.kind === 'boolean') {
    if (isCancelledText(value)) return <CancelledBadge />
    if (isReplacementText(value)) return <ReplacementBadge />
    if (isAdditionalText(value)) return <AdditionalBadge />
    if (value === true || isYesText(value)) return <YesBadge />
    return ''
  }

  return (
    <span className={field.kind === 'date' || DATE_TIME_FIELD_KEYS.has(field.key) || isResultField ? 'whitespace-nowrap' : 'line-clamp-2'}>
      {field.kind === 'date' ? (
        formatDate(value)
      ) : DATE_TIME_FIELD_KEYS.has(field.key) ? (
        formatDateTime(value)
      ) : isResultField ? (
        <ResultBadge value={value} />
      ) : field.key === 'pstoRequired' && isCancelledText(value) ? (
        <CancelledBadge />
      ) : field.key === 'pstoRequired' && isReplacementText(value) ? (
        <ReplacementBadge />
      ) : field.key === 'pstoRequired' && isAdditionalText(value) ? (
        <AdditionalBadge />
      ) : field.key === 'pstoRequired' && isYesText(value) ? (
        <YesBadge />
      ) : field.key === 'pstoRequired' && isNoText(value) ? (
        ''
      ) : (
        String(value ?? '')
      )}
    </span>
  )
}
