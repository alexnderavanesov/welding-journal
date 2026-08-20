import { LNK_METHODS } from '@/lib/report-config'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { assertNoLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import {
  applyLnkFieldUpdate,
  withTouchedLnkFinalStatus,
  withTouchedLnkTimestamp,
} from '@/lib/lnk-field-updates'
import { hasCompletedLnkRequestPosition } from '@/lib/report-control-state'
import {
  hasText,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'
import { isSameRequestDocument } from '@/lib/request-document-identity'

export type LnkRequestManagerAction = 'rename' | 'delete'

export function buildLnkRequestRows({
  records,
  methodKeys,
  requestName,
  requestDate,
}: {
  records: RowWithId[]
  methodKeys: WeldFieldKey[]
  requestName: string
  requestDate: string
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const proposedRecords = buildLnkRequestDraftRows({ records, methodKeys, requestName, requestDate })
  assertNoLnkChronologyIssues(proposedRecords, saveCheckSettings)
  return proposedRecords
}

export function buildLnkRequestDraftRows({
  records,
  methodKeys,
  requestName,
  requestDate,
}: {
  records: RowWithId[]
  methodKeys: WeldFieldKey[]
  requestName: string
  requestDate: string
}) {
  const normalizedRequestDate = normalizeDateLikeForStorage(requestDate)
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
      nextRecord[method.requestDateKey] = normalizedRequestDate
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
  const saveCheckSettings = loadSaveCheckSettings()
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите вид контроля')
  if (requestName && !isEnabledControlValue(record[method.enabledKey])) {
    throw new Error('Нельзя указать заявку ЛНК без назначения этого вида контроля')
  }

  if (requestName) {
    const proposedRecord = { ...record } as RowWithId
    proposedRecord[method.requestKey] = requestName
    if (!hasText(proposedRecord[method.resultKey])) {
      proposedRecord[method.resultKey] = 'ожидает НК'
    }
    const nextRecord = withTouchedLnkFinalStatus(proposedRecord)
    assertNoLnkChronologyIssues([nextRecord], saveCheckSettings)
    return nextRecord
  }

  const nextRecord = buildLnkRequestPositionRemovalRow(record, methodKey)
  assertNoLnkChronologyIssues([nextRecord], saveCheckSettings)
  return nextRecord
}

export function getLnkRequestPositionRemovalBlockReason(
  record: RowWithId,
  methodKey: WeldFieldKey,
) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method || !hasCompletedLnkRequestPosition(record, method)) return null
  const joint = String(record.joint ?? '').trim() || `№${record.id}`
  return `Нельзя исключить ${method.code} стыка ${joint} из заявки: по этой позиции уже внесен результат или заключение. Сначала удалите результат в отчете ЛНК.`
}

export function buildLnkRequestPositionRemovalRow(
  record: RowWithId,
  methodKey: WeldFieldKey,
) {
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите вид контроля')
  const blockReason = getLnkRequestPositionRemovalBlockReason(record, methodKey)
  if (blockReason) throw new Error(blockReason)
  return withTouchedLnkFinalStatus(
    withTouchedLnkTimestamp(applyLnkFieldUpdate(record, method.requestKey, null)),
  )
}

export function buildLnkRequestManagerRows({
  records,
  requestName,
  requestDate,
  nextRequestName,
  action,
}: {
  records: RowWithId[]
  requestName: string
  requestDate: string
  nextRequestName: string
  action: LnkRequestManagerAction
}) {
  if (action === 'delete') {
    for (const record of records) {
      for (const method of LNK_METHODS) {
        if (!isSameRequestDocument(record[method.requestKey], record[method.requestDateKey], {
          name: requestName,
          date: requestDate,
        })) continue
        const blockReason = getLnkRequestPositionRemovalBlockReason(record, method.requestKey)
        if (blockReason) throw new Error(blockReason)
      }
    }
  }

  const proposedRecords = records.flatMap((record) => {
    let nextRecord = { ...record } as RowWithId
    let changed = false
    for (const method of LNK_METHODS) {
      if (
        !isSameRequestDocument(record[method.requestKey], record[method.requestDateKey], {
          name: requestName,
          date: requestDate,
        })
      ) {
        continue
      }
      if (action === 'rename') {
        nextRecord[method.requestKey] = nextRequestName
      } else {
        nextRecord = applyLnkFieldUpdate(nextRecord, method.requestKey, null)
      }
      changed = true
    }
    return changed ? [withTouchedLnkFinalStatus(nextRecord)] : []
  })
  if (action === 'rename') {
    assertNoLnkChronologyIssues(proposedRecords, loadSaveCheckSettings())
  }
  return proposedRecords
}
