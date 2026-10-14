import { buildSystemNameWithNumber, hasSystemDocumentNumberField, type NamingPatternContext } from './request-conclusion-settings'

export function systemDocumentNameKey(date: string, name: string) {
  return `${date}\u0000${name.trim()}`
}

/** Shared by read-only operation previews and transactional number reservation. */
export function findAvailableSystemDocumentName({ pattern, context, date, nextNumber, occupiedNames, occupiedNumbers }: {
  pattern: string
  context: NamingPatternContext
  date: string
  nextNumber: number
  occupiedNames: ReadonlySet<string>
  occupiedNumbers?: ReadonlySet<number>
}) {
  if (!hasSystemDocumentNumberField(pattern)) {
    throw new Error('В системном имени обязательно поле «Порядковый номер». Добавьте его в настройках заявок и заключений.')
  }
  let number = Math.max(1, Math.floor(nextNumber))
  let name = buildSystemNameWithNumber(pattern, context, number)
  const occupied = () => occupiedNumbers?.has(number) || occupiedNames.has(systemDocumentNameKey(date, name))
  while (number < 1_000_000 && occupied()) {
    number += 1
    name = buildSystemNameWithNumber(pattern, context, number)
  }
  if (occupied()) throw new Error('Не удалось назначить уникальный порядковый номер системного документа.')
  return { name, number }
}
