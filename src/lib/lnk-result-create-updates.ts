import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { withLnkFinalStatus } from '@/lib/lnk-field-updates'
import {
  assertLnkRepairAllowed,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export function buildLnkResultRows({
  records,
  methodKey,
  controlDate,
  resultById,
  conclusionName,
}: {
  records: RowWithId[]
  methodKey: WeldFieldKey
  controlDate: string
  resultById: Record<number, string>
  conclusionName: string
}) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите метод контроля')
  const results = records.map((record) => resultById[record.id] ?? '')
  const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
  if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
  if (hasNonEmptyResult && !controlDate) throw new Error('Укажите дату контроля')
  if (hasNonEmptyResult && !conclusionName.trim()) throw new Error('Укажите наименование заключения')
  records.forEach((record) => assertLnkRepairAllowed(record, resultById[record.id] ?? ''))

  const lnkUpdatedAt = new Date().toISOString()
  return records.map((record) => {
    const result = resultById[record.id] ?? ''
    const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
    const proposedRecord = {
      ...record,
      [method.resultKey]: shouldClearResult ? null : result,
      [method.conclusionDateKey]: shouldClearResult ? null : controlDate,
      [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
      lnkCreatedAt: lnkUpdatedAt,
    }
    return withLnkFinalStatus(proposedRecord)
  })
}
