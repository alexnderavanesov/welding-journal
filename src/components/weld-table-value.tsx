import { formatDate, formatDateTime } from '@/lib/weld-table-formatting'
import {
  AdditionalBadge,
  CancelledBadge,
  ResultBadge,
  YesBadge,
  isAdditionalText,
  isCancelledText,
  isNoText,
  isYesText,
} from '@/lib/weld-table-badges'
import { DATE_TIME_WELD_FIELD_KEYS, type WeldField, type WeldFieldKey } from '@/lib/weld-fields'
import { memo } from 'react'

export const WeldTableValue = memo(function WeldTableValue({
  field,
  value,
  isResultField,
}: {
  field: WeldField
  value: unknown
  isResultField: boolean
}) {
  const fieldKey = field.key as WeldFieldKey

  if (field.kind === 'boolean') {
    if (isCancelledText(value)) return <CancelledBadge />
    if (isAdditionalText(value)) return <AdditionalBadge />
    if (value === true || isYesText(value)) return <YesBadge />
    return ''
  }

  return (
    <span className={field.kind === 'date' || DATE_TIME_WELD_FIELD_KEYS.has(fieldKey) || isResultField ? 'whitespace-nowrap' : 'line-clamp-2'}>
      {field.kind === 'date' ? (
        formatDate(value)
      ) : DATE_TIME_WELD_FIELD_KEYS.has(fieldKey) ? (
        formatDateTime(value)
      ) : isResultField ? (
        <ResultBadge value={value} />
      ) : field.key === 'pstoRequired' && isCancelledText(value) ? (
        <CancelledBadge />
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
})
