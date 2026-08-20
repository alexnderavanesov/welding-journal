import type { WeldRow } from '@/lib/dispatcher-types'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import { LNK_METHODS } from '@/lib/report-config'
import { canSelectLnkResultRow } from '@/lib/report-modal-rows'
import { isFinalLnkResultValue } from '@/lib/lnk-status'
import type { WeldFieldKey } from '@/lib/weld-fields'

export type LnkResultNavigationEntry = {
  changeKey: string
  rowId: number
  methodKey: WeldFieldKey
  methodCode: string
  result: string
  requestName: string
  requestDate: string
  conclusionName: string
  conclusionDate: string
}

const LNK_RESULT_METHOD_BY_FIELD = new Map<WeldFieldKey, (typeof LNK_METHODS)[number]>(
  LNK_METHODS.flatMap((method) => [
    [method.resultKey, method] as const,
    [method.conclusionKey, method] as const,
    [method.conclusionDateKey, method] as const,
  ]),
)
const LNK_RESULT_METHOD_BY_REQUEST_FIELD = new Map<WeldFieldKey, (typeof LNK_METHODS)[number]>(
  LNK_METHODS.map((method) => [method.requestKey, method]),
)

export function getLnkResultMethodForField(fieldKey: WeldFieldKey | undefined) {
  if (!fieldKey) return undefined
  return LNK_RESULT_METHOD_BY_FIELD.get(fieldKey)
}

export function getLnkResultNavigationEntry(row: WeldRow, methodKey: WeldFieldKey) {
  const method = LNK_RESULT_METHOD_BY_REQUEST_FIELD.get(methodKey)
  if (!method || !isFinalLnkResultValue(row[method.resultKey])) return null
  return buildEntry(row, method)
}

export function getLnkResultNavigationEntryForField(row: WeldRow, fieldKey: WeldFieldKey | undefined) {
  const method = getLnkResultMethodForField(fieldKey)
  if (!method || !isFinalLnkResultValue(row[method.resultKey])) return null
  return buildEntry(row, method)
}

export function getLnkResultNavigationEntries(row: WeldRow) {
  return LNK_METHODS.flatMap((method) =>
    isFinalLnkResultValue(row[method.resultKey]) ? [buildEntry(row, method)] : [],
  )
}

export function getPendingLnkResultMethods(row: WeldRow) {
  return LNK_METHODS.filter((method) => {
    const requestName = String(row[method.requestKey] ?? '').trim()
    const requestDate = String(row[method.requestDateKey] ?? '').trim()
    return Boolean(
      requestName &&
      canSelectLnkResultRow(row, requestName, method.requestKey, requestDate),
    )
  })
}

function buildEntry(row: WeldRow, method: (typeof LNK_METHODS)[number]): LnkResultNavigationEntry {
  return {
    changeKey: getManagedLnkResultChangeKey(row.id, method.requestKey),
    rowId: row.id,
    methodKey: method.requestKey,
    methodCode: method.code,
    result: String(row[method.resultKey] ?? '').trim(),
    requestName: String(row[method.requestKey] ?? '').trim(),
    requestDate: String(row[method.requestDateKey] ?? '').trim(),
    conclusionName: String(row[method.conclusionKey] ?? '').trim(),
    conclusionDate: String(row[method.conclusionDateKey] ?? '').trim(),
  }
}
