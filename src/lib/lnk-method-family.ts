import { isTConnectionType } from './connection-type'
import type { WeldInput } from './weld-field-definitions'

/** Applies to scheduling and facts alike, including customer duplicates. */
export function getLnkMethodFamilyBlockReason(row: WeldInput, methodCode: string) {
  const method = String(methodCode).trim().toLocaleUpperCase('ru-RU').split(/\s/)[0]
  return isTConnectionType(row.connectionType) && method === 'РК'
    ? 'Для Т РК запрещён, включая дубль-контроль.'
    : undefined
}
