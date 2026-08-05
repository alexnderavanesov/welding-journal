export const DOCUMENT_FORMATION_DATE_TOKEN = '[[DOCUMENT_FORMATION_DATE]]'
export const DOCUMENT_SEQUENCE_NUMBER_TOKEN = '[[DOCUMENT_SEQUENCE_NUMBER]]'

export function resolveGeneratedDocumentNamePattern(
  value: string,
  {
    documentNumber,
    formedAt = new Date(),
  }: {
    documentNumber: number
    formedAt?: Date
  },
) {
  return value
    .replaceAll(DOCUMENT_FORMATION_DATE_TOKEN, formatFormationDate(formedAt))
    .replaceAll(DOCUMENT_SEQUENCE_NUMBER_TOKEN, String(documentNumber))
}

export function previewGeneratedDocumentNamePattern(value: string, formedAt = new Date()) {
  return value
    .replaceAll(DOCUMENT_FORMATION_DATE_TOKEN, formatFormationDate(formedAt))
    .replaceAll(DOCUMENT_SEQUENCE_NUMBER_TOKEN, '[Порядковый номер]')
}

export function hasDocumentSequenceNumberToken(value: string) {
  return value.includes(DOCUMENT_SEQUENCE_NUMBER_TOKEN)
}

function formatFormationDate(value: Date) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}.${part('month')}.${part('year')}`
}
