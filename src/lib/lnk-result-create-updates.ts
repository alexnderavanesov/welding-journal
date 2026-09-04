import { LNK_EMPTY_RESULT_VALUE } from '@/lib/report-config'
import { getDateInputValidationReason, normalizeDateLikeForStorage } from '@/lib/date-format'
import { getLnkMethodByRequestKey } from '@/lib/lnk-status'
import { withLnkFinalStatus } from '@/lib/lnk-field-updates'
import { assertNoLnkChronologyIssues } from '@/lib/lnk-chronology-checks'
import {
  assertLnkRepairAllowed,
  isValidLnkResultDraftValue,
} from '@/lib/lnk-result-draft'
import { formatDateBeforeWeldDateSaveReason, isDateBeforeWeldDate } from '@/lib/report-date-rules'
import { loadSaveCheckSettings, type SaveCheckSettings } from '@/lib/save-check-settings'
import { loadOtherSettings } from '@/lib/other-settings'
import { applyRkExposureResultTransition } from '@/lib/rk-exposure'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { RowWithId } from '@/lib/lnk-report-mutation-types'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import { getPrimaryLnkStageBlockReason } from '@/lib/lnk-control-stage'
import { transitionLnkDefectDescription } from '@/lib/lnk-defect-description'

export function buildLnkResultRows({
  records,
  methodKey,
  controlDate,
  resultById,
  conclusionName,
  rkExposureTable: suppliedRkExposureTable,
  saveCheckSettings = loadSaveCheckSettings(),
}: {
  records: RowWithId[]
  methodKey: WeldFieldKey
  controlDate: string
  resultById: Record<number, string>
  conclusionName: string
  rkExposureTable?: RkExposureTableSettings | null
  saveCheckSettings?: SaveCheckSettings
}) {
  const rkExposureTable = suppliedRkExposureTable === undefined
    ? loadOtherSettings().rkExposureTable
    : suppliedRkExposureTable
  const method = getLnkMethodByRequestKey(methodKey)
  if (!method) throw new Error('Выберите метод контроля')
  const results = records.map((record) => resultById[record.id] ?? '')
  const hasNonEmptyResult = results.some((result) => result !== LNK_EMPTY_RESULT_VALUE)
  if (results.some((result) => !isValidLnkResultDraftValue(result))) throw new Error('Укажите результат для каждого выбранного стыка')
  if (saveCheckSettings.lnkResultControlDateRequired && hasNonEmptyResult && !controlDate) throw new Error('Укажите дату контроля')
  const controlDateReason = hasNonEmptyResult ? getDateInputValidationReason(controlDate, 'Дата контроля') : ''
  if (controlDateReason) throw new Error(controlDateReason)
  if (saveCheckSettings.lnkResultDateAfterWeldDate && hasNonEmptyResult) {
    const dateIssueRecord = records.find((record) => isDateBeforeWeldDate(controlDate, record.weldDate))
    if (dateIssueRecord) throw new Error(formatDateBeforeWeldDateSaveReason(dateIssueRecord, controlDate, `Дата контроля ${method.code}`))
  }
  if (saveCheckSettings.lnkResultConclusionRequired && hasNonEmptyResult && !conclusionName.trim()) throw new Error('Укажите наименование заключения')
  if (hasNonEmptyResult) {
    const blockedRecord = records.find((record) => getPrimaryLnkStageBlockReason(record, method.code))
    if (blockedRecord) throw new Error(getPrimaryLnkStageBlockReason(blockedRecord, method.code))
  }
  records.forEach((record) => assertLnkRepairAllowed(record, resultById[record.id] ?? '', saveCheckSettings))
  const normalizedControlDate = normalizeDateLikeForStorage(controlDate) ?? (controlDate.trim() || null)

  const lnkUpdatedAt = new Date().toISOString()
  const proposedRecords = records.map((record) => {
    const result = resultById[record.id] ?? ''
    const shouldClearResult = result === LNK_EMPTY_RESULT_VALUE
    let proposedRecord = {
      ...record,
      [method.resultKey]: shouldClearResult ? null : result,
      [method.conclusionDateKey]: shouldClearResult ? null : normalizedControlDate,
      [method.conclusionKey]: shouldClearResult ? null : conclusionName.trim(),
      lnkCreatedAt: record.lnkCreatedAt ?? lnkUpdatedAt,
      lnkUpdatedAt,
    } as RowWithId
    if (method.code === 'РК') {
      const exposureRecord = applyRkExposureResultTransition(
        record,
        shouldClearResult ? null : result,
        rkExposureTable,
      )
      proposedRecord = {
        ...proposedRecord,
        lnkDefectDescription: exposureRecord.lnkDefectDescription,
        rkExposureConfirmedDiameter: exposureRecord.rkExposureConfirmedDiameter,
      }
    } else {
      proposedRecord = {
        ...proposedRecord,
        [method.defectDescriptionKey]: transitionLnkDefectDescription({
          currentResult: record[method.resultKey],
          nextResult: shouldClearResult ? null : result,
          currentDescription: record[method.defectDescriptionKey],
        }),
      }
    }
    return withLnkFinalStatus(proposedRecord)
  })
  assertNoLnkChronologyIssues(proposedRecords, saveCheckSettings)
  return proposedRecords
}
