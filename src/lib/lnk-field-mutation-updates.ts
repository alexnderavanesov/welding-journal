import {
  getLnkMethodByResultKey,
  getLnkMethodByRequestKey,
} from '@/lib/lnk-status'
import {
  applyLnkFieldUpdate,
  clearDisabledLnkRequests,
  clearLnkGeneratedData,
  hasLnkGeneratedDataChanged,
  isLnkRequestField,
  withLnkFinalStatus,
  withTouchedLnkTimestamp,
} from '@/lib/lnk-field-updates'
import { hasText, isEnabledControlValue } from '@/lib/report-value-utils'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'

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
    throw new Error('Нельзя указать заявку ЛНК без назначения этого вида контроля')
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
