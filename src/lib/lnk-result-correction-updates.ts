import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { withTouchedLnkFinalStatus } from '@/lib/lnk-field-updates'
import {
  assertLnkRepairAllowed,
  assertValidLnkResultValue,
} from '@/lib/lnk-result-draft'
import { hasText } from '@/lib/report-value-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export function buildLnkResultCorrectionRow({
  record,
  methodKey,
  result,
}: {
  record: RowWithId
  methodKey: WeldFieldKey
  result: string | null
}) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите метод контроля')
  if (result) assertValidLnkResultValue(result)
  assertLnkRepairAllowed(record, result)
  const proposedRecord = {
    ...record,
    [method.resultKey]: result,
    [method.conclusionDateKey]: result ? record[method.conclusionDateKey] : null,
    [method.conclusionKey]: result ? record[method.conclusionKey] : null,
  } as RowWithId
  return withTouchedLnkFinalStatus(proposedRecord)
}

export function buildLnkResultReplacementRows({
  updates,
}: {
  updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
}) {
  const updatedById = new Map<number, RowWithId>()
  for (const { record, methodKey, result } of updates) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) throw new Error('Выберите метод контроля')
    assertValidLnkResultValue(result)
    assertLnkRepairAllowed(record, result)
    const currentRecord = updatedById.get(record.id) ?? record
    updatedById.set(record.id, {
      ...currentRecord,
      [method.resultKey]: result,
    } as RowWithId)
  }
  return [...updatedById.values()].map((record) => withTouchedLnkFinalStatus(record))
}

export function buildLnkConclusionCorrectionRows({
  records,
  methodKey,
  conclusionName,
}: {
  records: RowWithId[]
  methodKey: WeldFieldKey
  conclusionName: string
}) {
  const method = getLnkMethodByRequestKey(methodKey)
  const nextConclusionName = conclusionName.trim()
  if (!method) throw new Error('Выберите метод контроля')
  if (!nextConclusionName) throw new Error('Укажите наименование заключения')

  return records
    .filter((record) => hasText(record[method.resultKey]))
    .map((record) => {
      const proposedRecord = {
        ...record,
        [method.conclusionKey]: nextConclusionName,
      } as RowWithId
      return withTouchedLnkFinalStatus(proposedRecord)
    })
}
