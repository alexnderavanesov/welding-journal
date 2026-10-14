import { getDateInputValidationReason } from '@/lib/date-format'

/** Validate the final document values, independently of legacy settings. */
export function getDocumentRequisiteErrors({
  name, date, nameLabel = 'наименование заключения', dateLabel = 'Дата контроля',
}: { name: unknown; date: unknown; nameLabel?: string; dateLabel?: string }) {
  return [
    getDateInputValidationReason(date, dateLabel, { required: true }),
    String(name ?? '').trim() ? '' : `Укажите ${nameLabel}.`,
  ].filter(Boolean)
}

export function assertDocumentRequisites(values: Parameters<typeof getDocumentRequisiteErrors>[0]) {
  const errors = getDocumentRequisiteErrors(values)
  if (errors.length) throw new Error(errors.join('\n'))
}

export function getDuplicateControlRequisiteErrors(record: { conclusion: unknown; controlDate: unknown; conclusionDate: unknown }) {
  return [...getDocumentRequisiteErrors({ name: record.conclusion, date: record.controlDate,
    dateLabel: 'Дата контроля дубль-контроля' }),
    getDateInputValidationReason(record.conclusionDate, 'Дата заключения дубль-контроля', { required: true }),
  ].filter(Boolean)
}
