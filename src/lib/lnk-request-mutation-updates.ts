import { LNK_METHODS } from '@/lib/report-config'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import {
  withTouchedLnkFinalStatus,
  withTouchedLnkTimestamp,
} from '@/lib/lnk-field-updates'
import {
  hasText,
  isEnabledControlValue,
} from '@/lib/report-value-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
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
