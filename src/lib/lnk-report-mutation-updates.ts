import { LNK_EMPTY_RESULT_VALUE, LNK_METHODS } from '@/lib/report-config'
import {
  getLnkMethodByResultKey,
  getLnkMethodByRequestKey,
  hasRejectedLnkResult,
} from '@/lib/lnk-status'
import {
  applyLnkFieldUpdate,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  isLnkRequestField,
  withLnkFinalStatus,
  withTouchedLnkFinalStatus,
  withTouchedLnkTimestamp,
} from '@/lib/lnk-field-updates'
import {
  assertLnkRepairAllowed,
  assertValidLnkResultValue,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import {
  hasText,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

export type LnkRequestManagerAction = 'rename' | 'delete'

export function buildLnkRequestRows({
  records,
  methodKeys,
  requestName,
}: {
  records: RowWithId[]
  methodKeys: WeldFieldKey[]
  requestName: string
}) {
  return records.flatMap((record) => {
    const nextRecord = { ...record }
    let changed = false
    for (const requestKey of methodKeys) {
      const method = getLnkMethodByRequestKey(requestKey)
      if (!method) continue
      if (!isEnabledControlValue(record[method.enabledKey])) continue
      const existingRequestName = String(record[method.requestKey] ?? '').trim()
      if (existingRequestName) continue
      nextRecord[method.requestKey] = requestName
      if (!hasText(nextRecord[method.resultKey])) {
        nextRecord[method.resultKey] = 'ожидает НК'
      }
      changed = true
    }
    return changed ? [withTouchedLnkTimestamp(nextRecord)] : []
  })
}

export function buildLnkRequestCorrectionRow({
  record,
  methodKey,
  requestName,
}: {
  record: RowWithId
  methodKey: WeldFieldKey
  requestName: string | null
}) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите вид контроля')
  if (requestName && !isEnabledControlValue(record[method.enabledKey])) {
    throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
  }

  const proposedRecord = { ...record } as RowWithId
  if (requestName) {
    proposedRecord[method.requestKey] = requestName
    if (!hasText(proposedRecord[method.resultKey])) {
      proposedRecord[method.resultKey] = 'ожидает НК'
    }
  } else {
    proposedRecord[method.requestKey] = null
    proposedRecord[method.resultKey] = null
    proposedRecord[method.conclusionDateKey] = null
    proposedRecord[method.conclusionKey] = null
  }

  return withTouchedLnkFinalStatus(proposedRecord)
}

export function buildLnkRequestManagerRows({
  records,
  requestName,
  nextRequestName,
  action,
}: {
  records: RowWithId[]
  requestName: string
  nextRequestName: string
  action: LnkRequestManagerAction
}) {
  return records.flatMap((record) => {
    const nextRecord = { ...record } as RowWithId
    let changed = false
    for (const method of LNK_METHODS) {
      if (String(record[method.requestKey] ?? '').trim() !== requestName) continue
      if (action === 'rename') {
        nextRecord[method.requestKey] = nextRequestName
      } else {
        nextRecord[method.requestKey] = null
        nextRecord[method.resultKey] = null
        nextRecord[method.conclusionDateKey] = null
        nextRecord[method.conclusionKey] = null
      }
      changed = true
    }
    return changed ? [withTouchedLnkFinalStatus(nextRecord)] : []
  })
}

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

export function buildLnkOfficialityRows({
  records,
  status,
}: {
  records: RowWithId[]
  status: 'official' | 'unofficial'
}) {
  if (status === 'unofficial') {
    const invalidRecords = records.filter((record) => !hasRejectedLnkResult(record))
    if (invalidRecords.length > 0) {
      throw new Error('Неофициальный статус можно назначить только после результата контроля "ремонт" или "вырез"')
    }
  }
  const nextStatus = status === 'unofficial' ? 'неофициальный' : null
  return records
    .map((record) => ({ ...record, status: nextStatus }))
    .filter((record, index) => String(records[index].status ?? '').trim() !== String(nextStatus ?? '').trim()) as RowWithId[]
}

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

export function buildLnkFieldRow({
  record,
  fieldKey,
  value,
  lnkRequestOptions,
}: {
  record: RowWithId
  fieldKey: WeldFieldKey
  value: string | null
  lnkRequestOptions: string[]
}) {
  const resultMethod = getLnkMethodByResultKey(fieldKey)
  if (resultMethod && value && !hasText(record[resultMethod.requestKey])) {
    throw new Error('Сначала создайте заявку ЛНК для этого вида контроля')
  }
  const requestMethod = getLnkMethodByRequestKey(fieldKey)
  if (requestMethod && value && !isEnabledControlValue(record[requestMethod.enabledKey])) {
    throw new Error('Нельзя указать заявку ЛНК без наличия этого вида контроля')
  }
  if (isLnkRequestField(fieldKey) && value && !lnkRequestOptions.includes(value)) {
    throw new Error('Можно выбрать только существующую заявку ЛНК или очистить поле')
  }

  const proposedRecord = clearDisabledLnkRequests(withTouchedLnkTimestamp(applyLnkFieldUpdate(record, fieldKey, value)))
  return withLnkFinalStatus(proposedRecord)
}

export function buildClearLnkGeneratedRows(targetRows: WeldRow[]) {
  return targetRows.flatMap((row) => {
    const cleanedRow = clearLnkGeneratedData(row)
    return hasLnkGeneratedDataChanged(row, cleanedRow) ? [withLnkFinalStatus(cleanedRow)] : []
  })
}
