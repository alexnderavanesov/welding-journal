import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { assertDocumentRequisites } from '@/lib/document-requisites'
import { normalizeDateLikeForStorage } from '@/lib/date-format'
import { withTouchedLnkFinalStatus } from '@/lib/lnk-field-updates'
import { assertNoNewLnkChronologyIssues, getLnkResultRemovalBlockReason } from '@/lib/lnk-chronology-checks'
import { assertValidLnkResultValue } from '@/lib/lnk-result-draft'
import { assertLnkResultAllowed } from '@/lib/lnk-result-policy'
import { loadControlProcessSettings } from '@/lib/control-process-settings'
import { formatCustomDocumentName } from '@/lib/report-request-naming'
import { hasText } from '@/lib/report-value-utils'
import { loadSaveCheckSettings } from '@/lib/save-check-settings'
import { loadOtherSettings } from '@/lib/other-settings'
import { applyRkExposureResultTransition } from '@/lib/rk-exposure'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import { transitionLnkDefectDescription } from '@/lib/lnk-defect-description'
import { assertUnofficialLnkGoodResultAllowed, assertUnofficialLastRejectionRetained } from './unofficial-lnk-result-guard'

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
  assertUnofficialLnkGoodResultAllowed(record, result, record[method.resultKey], method.code)
  assertLnkResultAllowed(record, method.code, result, { pvkGoodOnly: loadControlProcessSettings().pvkGoodOnly })
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
      : {
          [method.defectDescriptionKey]: transitionLnkDefectDescription({
            currentResult: record[method.resultKey],
            nextResult: result,
            currentDescription: record[method.defectDescriptionKey],
          }),
        }),
  } as RowWithId
  const nextRecord = withTouchedLnkFinalStatus(proposedRecord)
  assertUnofficialLastRejectionRetained(nextRecord, record)
  assertNoNewLnkChronologyIssues([nextRecord], [record], saveCheckSettings)
  return nextRecord
}

export function buildLnkResultReplacementRows({
  updates,
  rkExposureTable: suppliedRkExposureTable,
}: {
  updates: Array<{ record: RowWithId; methodKey: WeldFieldKey; result: string | null }>
  rkExposureTable?: RkExposureTableSettings | null
}) {
  const saveCheckSettings = loadSaveCheckSettings()
  const rkExposureTable = suppliedRkExposureTable === undefined
    ? loadOtherSettings().rkExposureTable
    : suppliedRkExposureTable
  const updatedById = new Map<number, RowWithId>()
  const { pvkGoodOnly } = loadControlProcessSettings()
  for (const { record, methodKey, result } of updates) {
    const method = getLnkMethodByRequestKey(methodKey)
    if (!method) throw new Error('Выберите метод контроля')
    if (result === null) {
      const reason = getLnkResultRemovalBlockReason(record, methodKey, saveCheckSettings)
      if (reason) throw new Error(reason)
    }
    if (result !== null) assertValidLnkResultValue(result)
    assertUnofficialLnkGoodResultAllowed(record, result, record[method.resultKey], method.code)
    const currentRecord = updatedById.get(record.id) ?? record
    assertLnkResultAllowed(currentRecord, method.code, result, { pvkGoodOnly })
    const exposureRecord = method.code === 'РК'
      ? applyRkExposureResultTransition(currentRecord, result, rkExposureTable)
      : currentRecord
    updatedById.set(record.id, {
      ...currentRecord,
      [method.resultKey]: result,
      ...(result === null ? { [method.conclusionKey]: null, [method.conclusionDateKey]: null } : {}),
      ...(method.code === 'РК'
        ? {
            lnkDefectDescription: exposureRecord.lnkDefectDescription,
            rkExposureConfirmedDiameter: exposureRecord.rkExposureConfirmedDiameter,
          }
        : {
            [method.defectDescriptionKey]: transitionLnkDefectDescription({
              currentResult: currentRecord[method.resultKey],
              nextResult: result,
              currentDescription: currentRecord[method.defectDescriptionKey],
            }),
          }),
    } as RowWithId)
  }
  const proposedRecords = [...updatedById.values()].map((record) => withTouchedLnkFinalStatus(record))
  const previousById = new Map(updates.map(({ record }) => [record.id, record]))
  for (const record of proposedRecords) assertUnofficialLastRejectionRetained(record, previousById.get(record.id)!)
  assertNoNewLnkChronologyIssues(
    proposedRecords,
    [...new Map(updates.map(({ record }) => [record.id, record])).values()],
    saveCheckSettings,
  )
  return proposedRecords
}

export function buildLnkConclusionCorrectionRows({
  records,
  methodKey,
  conclusionName,
  conclusionDate,
}: {
  records: RowWithId[]
  methodKey: WeldFieldKey
  conclusionName: string
  conclusionDate?: string
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
      // An unnamed legacy result has no document to edit. Repair both facts
      // atomically on that result; ordinary dated documents keep the date editor.
      if (conclusionDate !== undefined && String(record[method.conclusionKey] ?? '').trim()) {
        throw new Error('Измените дату именованного документа через действие «Изменить дату».')
      }
      const date = conclusionDate === undefined ? record[method.conclusionDateKey] : conclusionDate
      assertDocumentRequisites({ name: customConclusionName, date })
      const proposedRecord = {
        ...record,
        [method.conclusionKey]: customConclusionName,
        ...(conclusionDate !== undefined ? { [method.conclusionDateKey]: normalizeDateLikeForStorage(date) } : {}),
      } as RowWithId
      return withTouchedLnkFinalStatus(proposedRecord)
    })
  assertNoNewLnkChronologyIssues(proposedRecords, records, saveCheckSettings)
  return proposedRecords
}
