import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { withTouchedLnkFinalStatus } from '@/lib/lnk-field-updates'
import { assertNoLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import {
  assertLnkRepairAllowed,
  assertValidLnkResultValue,
} from '@/lib/lnk-result-draft'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { hasText } from '@/lib/report-value-utils'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import { loadOtherSettings } from '@/lib/other-settings'
import { applyRkExposureResultTransition } from '@/lib/rk-exposure'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'
import type { RkExposureTableSettings } from '@/lib/other-settings'

export function buildLnkResultCorrectionRow({
  record,
  methodKey,
  result,
  rkExposureTable: suppliedRkExposureTable,
}: {
  record: RowWithId
  methodKey: WeldFieldKey
  result: string | null
  rkExposureTable?: RkExposureTableSettings | null
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const rkExposureTable = suppliedRkExposureTable === undefined
    ? loadOtherSettings().rkExposureTable
    : suppliedRkExposureTable
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите метод контроля')
  if (result) assertValidLnkResultValue(result)
  assertLnkRepairAllowed(record, result, saveCheckSettings)
  const exposureRecord = method.code === 'РК'
    ? applyRkExposureResultTransition(record, result, rkExposureTable)
    : record
  const proposedRecord = {
    ...record,
    [method.resultKey]: result,
    [method.conclusionDateKey]: result ? record[method.conclusionDateKey] : null,
    [method.conclusionKey]: result ? record[method.conclusionKey] : null,
    ...(method.code === 'РК'
      ? {
          lnkDefectDescription: exposureRecord.lnkDefectDescription,
          rkExposureConfirmedDiameter: exposureRecord.rkExposureConfirmedDiameter,
        }
      : {}),
  } as RowWithId
  const nextRecord = withTouchedLnkFinalStatus(proposedRecord)
  assertNoLnkChronologyIssues([nextRecord], saveCheckSettings)
  return nextRecord
}

export function buildLnkResultReplacementRows({
  updates,
  rkExposureTable: suppliedRkExposureTable,
}: {
  updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string }>
  rkExposureTable?: RkExposureTableSettings | null
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const rkExposureTable = suppliedRkExposureTable === undefined
    ? loadOtherSettings().rkExposureTable
    : suppliedRkExposureTable
  const updatedById = new Map<number, RowWithId>()
  for (const { record, methodKey, result } of updates) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) throw new Error('Выберите метод контроля')
    assertValidLnkResultValue(result)
    assertLnkRepairAllowed(record, result, saveCheckSettings)
    const currentRecord = updatedById.get(record.id) ?? record
    const exposureRecord = method.code === 'РК'
      ? applyRkExposureResultTransition(currentRecord, result, rkExposureTable)
      : currentRecord
    updatedById.set(record.id, {
      ...currentRecord,
      [method.resultKey]: result,
      ...(method.code === 'РК'
        ? {
            lnkDefectDescription: exposureRecord.lnkDefectDescription,
            rkExposureConfirmedDiameter: exposureRecord.rkExposureConfirmedDiameter,
          }
        : {}),
    } as RowWithId)
  }
  const proposedRecords = [...updatedById.values()].map((record) => withTouchedLnkFinalStatus(record))
  assertNoLnkChronologyIssues(proposedRecords, saveCheckSettings)
  return proposedRecords
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
  const saveCheckSettings = loadSaveCheckSettings()
  const method = getLnkMethodByRequestKey(methodKey)
  const nextConclusionName = conclusionName.trim()
  if (!method) throw new Error('Выберите метод контроля')
  if (!nextConclusionName) throw new Error('Укажите наименование заключения')

  const proposedRecords = records
    .filter((record) => hasText(record[method.resultKey]))
    .map((record) => {
      const customConclusionName = formatCustomDocumentName(nextConclusionName)
      const proposedRecord = {
        ...record,
        [method.conclusionKey]: customConclusionName,
      } as RowWithId
      return withTouchedLnkFinalStatus(proposedRecord)
    })
  assertNoLnkChronologyIssues(proposedRecords, saveCheckSettings)
  return proposedRecords
}
