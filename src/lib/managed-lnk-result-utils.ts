import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { getManagedLnkResultChangeKey } from '@/lib/lnk-result-draft'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { ManagedLnkResultChangeHintState } from '@/lib/use-lnk-result-modal-state'
import type { WeldFieldKey } from '@/lib/weld-fields'

type RowWithId = WeldRow

export type ManagedLnkPendingResultRow = {
  row: RowWithId
  method: {
    requestKey: WeldFieldKey
  }
  changeKey: string
}

export function getManagedLnkResultChangeHint(
  row: RowWithId,
  methodKey: WeldFieldKey,
  result: string,
): ManagedLnkResultChangeHintState {
  const method = getLnkMethodByRequestKey(methodKey)
  const currentResult = method ? String(row[method.resultKey] ?? '').trim() : ''
  const changeKey = getManagedLnkResultChangeKey(row.id, methodKey)
  if (!currentResult || currentResult === result) return null
  return { changeKey, rowId: row.id, methodKey, from: currentResult, to: result }
}

export function buildManagedLnkResultReplacementUpdates(
  pendingRows: ManagedLnkPendingResultRow[],
  pendingChanges: Record<string, string>,
) {
  return pendingRows.map(({ row, method, changeKey }) => ({
    record: row,
    methodKey: method.requestKey,
    result: pendingChanges[changeKey],
  }))
}
